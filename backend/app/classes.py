from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings
from app.schemas import (
    ClassCreateRequest,
    ClassCreateResult,
    ClassJoinRequest,
    ClassJoinResult,
)


@dataclass
class ClassDomainError(RuntimeError):
    """Structured domain error for class operations.

    Carries a machine-readable ``code`` and an HTTP ``status_code`` so the
    FastAPI exception handler can surface the right response without catching
    generic ``RuntimeError`` instances.  Logic errors (wrong role, bad join
    code, duplicate join code) raise this; infrastructure failures (Supabase
    unreachable, bad response shape) raise plain ``RuntimeError``.
    """

    message: str
    code: str
    status_code: int = 400

    def __str__(self) -> str:
        return self.message


def create_class(settings: Settings, request: ClassCreateRequest) -> ClassCreateResult:
    """Create a new class and auto-enroll the creating teacher.

    The operation is a two-step REST sequence against Supabase:
      1. INSERT into ``classes`` (returns the new row via ``Prefer: return=representation``).
      2. UPSERT into ``enrollments`` with ``resolution=merge-duplicates`` so that
         a retry is idempotent — a duplicate enrollment is silently absorbed.

    If step 2 fails, the newly created class is deleted as a best-effort
    rollback to avoid orphaned class rows.

    Args:
        settings: Application settings carrying Supabase credentials and timeouts.
        request: Validated payload containing owner_id, title, subject, level,
            description, and a caller-generated join_code.

    Returns:
        A ``ClassCreateResult`` with the UUID of the newly created class.

    Raises:
        ClassDomainError: If the caller is not a teacher (403), or if the
            join_code already exists in another class (409, code
            ``join_code_conflict``), or if the user profile is missing (400,
            code ``profile_missing``).
        RuntimeError: On unexpected Supabase errors or if rollback itself fails.
    """
    _require_supabase_credentials(settings)
    timeout_seconds = max(5, settings.ai_request_timeout_ms / 1000)
    base_url = _supabase_base_url(settings)
    with httpx.Client(timeout=timeout_seconds, trust_env=False) as client:
        # --- 1. Guard: verify caller is a teacher ---
        account_type = _load_account_type(client, settings, request.user_id)
        if account_type != "teacher":
            raise ClassDomainError(
                message="Only teacher accounts can create classes.",
                code="forbidden_account_type",
                status_code=403,
            )

        # --- 2. Insert the class row ---
        # ``Prefer: return=representation`` makes PostgREST echo back the
        # inserted row so we can extract the server-generated ``id`` without
        # a separate SELECT round-trip.
        classes_url = f"{base_url}/rest/v1/classes"
        create_response = client.post(
            classes_url,
            headers={
                **_service_headers(settings),
                "Prefer": "return=representation",
            },
            json={
                "owner_id": request.user_id,
                "title": request.title,
                "subject": request.subject,
                "level": request.level,
                "description": request.description,
                "join_code": request.join_code,
            },
        )
        create_payload = _safe_json(create_response)
        if create_response.status_code >= 400:
            # PostgreSQL error code 23505 signals a UNIQUE constraint violation.
            # The join_code column has a unique index, so this is the expected
            # path when the caller supplies a code that is already taken.
            if _is_unique_violation(create_payload):
                raise ClassDomainError(
                    message="Join code already exists.",
                    code="join_code_conflict",
                    status_code=409,
                )
            message = _extract_error_message(
                create_payload) or "Failed to create class."
            raise RuntimeError(message)

        class_id = _extract_first_id(create_payload)
        if not class_id:
            raise RuntimeError(
                "Supabase create class response did not include class id.")

        # --- 3. Auto-enroll the teacher ---
        # ``on_conflict=class_id,user_id`` plus ``resolution=merge-duplicates``
        # makes this UPSERT idempotent: retried requests won't produce a
        # duplicate enrollment row.
        enrollments_url = f"{base_url}/rest/v1/enrollments?on_conflict=class_id,user_id"
        enrollment_response = client.post(
            enrollments_url,
            headers={
                **_service_headers(settings),
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json={
                "class_id": class_id,
                "user_id": request.user_id,
                "role": "teacher",
            },
        )
        if enrollment_response.status_code >= 400:
            enrollment_payload = _safe_json(enrollment_response)
            enrollment_message = _extract_error_message(
                enrollment_payload) or "Failed to create class enrollment."
            # --- 4. Best-effort rollback: delete the orphaned class row ---
            # Supabase PostgREST does not expose true multi-statement
            # transactions over REST, so we approximate atomicity with an
            # explicit compensating DELETE.  If rollback also fails, we surface
            # both errors so operators can clean up manually.
            try:
                _rollback_created_class(client, settings, class_id)
            except RuntimeError as rollback_error:
                raise RuntimeError(
                    f"{enrollment_message} Rollback failed: {rollback_error}"
                ) from rollback_error
            raise RuntimeError(enrollment_message)

        return ClassCreateResult(class_id=class_id)


def join_class(settings: Settings, request: ClassJoinRequest) -> ClassJoinResult:
    """Enroll an existing student in a class identified by a join code.

    The lookup uses a case-insensitive match (PostgREST ``ilike``) on the
    join code so that students can type the code in any case.  After the class
    is found, ``resolution=ignore-duplicates`` on the enrollment UPSERT makes
    the operation idempotent — joining a class the student is already in is a
    no-op rather than an error.

    Args:
        settings: Application settings carrying Supabase credentials and timeouts.
        request: Validated payload containing user_id and the raw join_code
            string typed by the student.

    Returns:
        A ``ClassJoinResult`` with the UUID of the class that was joined.

    Raises:
        ClassDomainError: If the caller is not a student (403), if the join
            code resolves to no class (404, code ``class_not_found``), or if
            the user profile is missing (400, code ``profile_missing``).
        RuntimeError: On unexpected Supabase errors.
    """
    _require_supabase_credentials(settings)
    timeout_seconds = max(5, settings.ai_request_timeout_ms / 1000)
    base_url = _supabase_base_url(settings)
    with httpx.Client(timeout=timeout_seconds, trust_env=False) as client:
        # --- 1. Guard: only students may join via join code ---
        account_type = _load_account_type(client, settings, request.user_id)
        if account_type != "student":
            raise ClassDomainError(
                message="Only student accounts can join classes via join code.",
                code="forbidden_account_type",
                status_code=403,
            )

        # --- 2. Normalise and validate the join code ---
        # Strip whitespace and uppercase so the ilike query and the in-memory
        # exact match in _extract_first_id_by_join_code agree on the format.
        normalized_join_code = request.join_code.strip().upper()
        if not normalized_join_code:
            raise ClassDomainError(
                message="Invalid join code.",
                code="class_not_found",
                status_code=404,
            )

        # --- 3. Look up the class by join code ---
        # Escape ILIKE metacharacters (%, _, \) before embedding the value in
        # the query string to prevent wildcard injection attacks.
        escaped_join_code = _escape_ilike_value(normalized_join_code)
        encoded_join_code = quote(escaped_join_code, safe="")
        classes_lookup_url = (
            f"{base_url}/rest/v1/classes"
            f"?select=id,join_code&join_code=ilike.{encoded_join_code}&limit=10"
        )
        class_lookup_response = client.get(
            classes_lookup_url,
            headers=_service_headers(settings),
        )
        class_lookup_payload = _safe_json(class_lookup_response)
        if class_lookup_response.status_code >= 400:
            message = _extract_error_message(
                class_lookup_payload) or "Failed to lookup class by join code."
            raise RuntimeError(message)

        # ilike may return multiple rows if two join codes differ only in case
        # (which the DB schema should prevent, but we defend against it here).
        # _extract_first_id_by_join_code performs a second exact-case match to
        # select the correct row.
        class_id = _extract_first_id_by_join_code(
            class_lookup_payload, normalized_join_code
        )
        if not class_id:
            raise ClassDomainError(
                message="Invalid join code.",
                code="class_not_found",
                status_code=404,
            )

        # --- 4. Enroll the student ---
        # ``resolution=ignore-duplicates`` means a student who has already
        # joined simply gets a 200 with an empty body rather than a conflict
        # error — the operation is safe to retry.
        enrollments_url = f"{base_url}/rest/v1/enrollments?on_conflict=class_id,user_id"
        enrollment_response = client.post(
            enrollments_url,
            headers={
                **_service_headers(settings),
                "Prefer": "resolution=ignore-duplicates,return=minimal",
            },
            json={
                "class_id": class_id,
                "user_id": request.user_id,
                "role": "student",
            },
        )
        if enrollment_response.status_code >= 400:
            enrollment_payload = _safe_json(enrollment_response)
            message = _extract_error_message(
                enrollment_payload) or "Failed to join class."
            raise RuntimeError(message)

        return ClassJoinResult(class_id=class_id)


def _require_supabase_credentials(settings: Settings) -> None:
    """Raise early if Supabase credentials are absent.

    Called at the top of every public function so that misconfigured
    environments produce a clear message rather than an obscure HTTP error
    later in the request.
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "Supabase service credentials are not configured on Python backend.")


def _supabase_base_url(settings: Settings) -> str:
    """Return the Supabase base URL with any trailing slash removed.

    Trailing-slash normalisation prevents double-slash URLs when constructing
    PostgREST endpoint paths.
    """
    if not settings.supabase_url:
        raise RuntimeError(
            "Supabase service URL is not configured on Python backend.")
    return settings.supabase_url.rstrip("/")


def _load_account_type(client: httpx.Client, settings: Settings, user_id: str) -> str:
    """Fetch the account_type field from the user's profile row.

    Uses the service-role key so that RLS does not filter out the row.
    ``account_type`` is immutable after account creation, making it safe to
    use as an authorisation gate here.

    Args:
        client: Shared httpx client (keeps the underlying TCP connection open
            across calls within a single request).
        settings: Application settings.
        user_id: UUID of the user whose profile is being fetched.

    Returns:
        The raw ``account_type`` string (e.g. ``"teacher"`` or ``"student"``).

    Raises:
        ClassDomainError: If no profile row is found (code ``profile_missing``).
        RuntimeError: On Supabase query failure.
    """
    base_url = _supabase_base_url(settings)
    profile_url = (
        f"{base_url}/rest/v1/profiles"
        f"?select=account_type&id=eq.{quote(user_id, safe='')}&limit=1"
    )
    response = client.get(
        profile_url,
        headers=_service_headers(settings),
    )
    payload = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_error_message(
            payload) or "Failed to load user profile."
        raise RuntimeError(message)

    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, dict):
            account_type = first.get("account_type")
            if isinstance(account_type, str) and account_type.strip():
                return account_type.strip()

    raise ClassDomainError(
        message="Profile with account_type is required before class actions.",
        code="profile_missing",
        status_code=400,
    )


def _rollback_created_class(client: httpx.Client, settings: Settings, class_id: str) -> None:
    """Delete a class row to compensate for a failed enrollment.

    This is a best-effort compensating action — PostgREST does not support
    multi-statement transactions over REST, so true atomicity is not possible.
    Callers should surface both the original error and any rollback failure so
    that operators can intervene manually if needed.

    Args:
        client: Shared httpx client.
        settings: Application settings.
        class_id: UUID of the class row to delete.

    Raises:
        RuntimeError: If the DELETE request itself fails or returns an error status.
    """
    base_url = _supabase_base_url(settings)
    delete_url = f"{base_url}/rest/v1/classes?id=eq.{quote(class_id, safe='')}"
    try:
        response = client.delete(
            delete_url,
            headers=_service_headers(settings),
        )
    except Exception as exc:
        raise RuntimeError(
            "Failed to rollback class creation after enrollment failure."
        ) from exc

    if response.status_code >= 400:
        payload = _safe_json(response)
        message = _extract_error_message(payload) or (
            "Failed to rollback class creation after enrollment failure."
        )
        raise RuntimeError(message)


def _extract_first_id(payload: Any) -> str | None:
    """Extract the ``id`` field from the first row of a PostgREST list response.

    PostgREST always returns arrays even for single-row inserts when
    ``Prefer: return=representation`` is set.

    Args:
        payload: Parsed JSON response body (expected to be a list of dicts).

    Returns:
        The ``id`` string from the first row, or ``None`` if absent or malformed.
    """
    if not isinstance(payload, list) or not payload:
        return None
    first = payload[0]
    if not isinstance(first, dict):
        return None
    value = first.get("id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _extract_first_id_by_join_code(payload: Any, join_code: str) -> str | None:
    """Find the class ``id`` whose join_code exactly matches the target.

    After a case-insensitive ``ilike`` query, we apply a second exact-case
    comparison here to guard against the (schema-prevented but possible)
    scenario where multiple join codes differ only in letter case.

    Args:
        payload: Parsed JSON list of class rows returned by PostgREST.
        join_code: Normalised (stripped, uppercased) join code to match against.

    Returns:
        The ``id`` of the matching class row, or ``None`` if no match is found.
    """
    if not isinstance(payload, list) or not payload:
        return None
    target_code = join_code.strip().upper()
    for row in payload:
        if not isinstance(row, dict):
            continue
        row_join_code = row.get("join_code")
        row_id = row.get("id")
        if not isinstance(row_join_code, str) or not isinstance(row_id, str):
            continue
        if row_join_code.strip().upper() == target_code and row_id.strip():
            return row_id.strip()
    return None


def _escape_ilike_value(value: str) -> str:
    """Escape PostgreSQL ILIKE metacharacters in a literal search string.

    Replaces ``\\``, ``%``, and ``_`` with their escaped equivalents so that a
    user-supplied join code is matched literally and cannot act as an SQL
    wildcard pattern.

    Args:
        value: Raw string to escape.

    Returns:
        Escaped string safe for embedding in a PostgREST ``ilike.`` filter.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _service_headers(settings: Settings) -> dict[str, str]:
    """Build HTTP headers that authenticate as the Supabase service role.

    The service-role key bypasses Row Level Security, which is intentional
    here: class creation and enrollment require access to rows the requesting
    user does not yet own.

    Args:
        settings: Application settings containing the service role key.

    Returns:
        Dict with ``apikey``, ``Authorization``, and ``Content-Type`` headers.
    """
    return {
        "apikey": settings.supabase_service_role_key or "",
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


def _safe_json(response: httpx.Response) -> Any:
    """Parse the response body as JSON, returning an empty dict on failure.

    Supabase error responses are sometimes not valid JSON (e.g. gateway
    timeouts), so falling back to ``{}`` lets callers use ``_extract_error_message``
    without raising.

    Args:
        response: The httpx response to parse.

    Returns:
        Parsed JSON value, or ``{}`` if parsing fails.
    """
    try:
        return response.json()
    except ValueError:
        return {}


def _extract_error_message(payload: Any) -> str | None:
    """Extract a human-readable error string from a Supabase error payload.

    Supabase PostgREST surfaces errors in several shapes depending on the
    version and the error origin:
      - ``{"error": "string message"}``
      - ``{"error": {"message": "string"}}``
      - ``{"message": "string"}``
      - ``{"details": "string"}`` (fallback)

    Args:
        payload: Parsed JSON response body.

    Returns:
        The first non-empty error string found, or ``None`` if none is present.
    """
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, str) and error.strip():
            return error.strip()
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        details = payload.get("details")
        if isinstance(details, str) and details.strip():
            return details.strip()
    return None


def _is_unique_violation(payload: Any) -> bool:
    """Return True if the Supabase error payload represents a UNIQUE constraint violation.

    PostgreSQL raises error code ``23505`` for unique violations.  As a
    secondary heuristic, the function also inspects the human-readable message
    for the phrases "duplicate key" and "unique constraint" to handle versions
    of PostgREST that do not forward the raw PG error code.

    Args:
        payload: Parsed JSON error body from a failed Supabase request.

    Returns:
        True if the error is a unique-key conflict, False otherwise.
    """
    if not isinstance(payload, dict):
        return False
    code = payload.get("code")
    # PostgreSQL SQLSTATE 23505 = unique_violation
    if code == "23505":
        return True

    message = _extract_error_message(payload)
    if not message:
        return False
    normalized = message.lower()
    return "duplicate key" in normalized or "unique constraint" in normalized
