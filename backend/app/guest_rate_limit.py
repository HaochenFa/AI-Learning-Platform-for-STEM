from __future__ import annotations

from typing import Any

import httpx

from app.config import Settings

# Dispatch table: maps each AI feature name to its usage-tracking column in the
# ``guest_sandboxes`` table.  Adding a new feature requires only a new entry
# here and a matching column in the DB schema — no branching logic needed.
_FEATURE_COLUMNS = {
    "chat": "chat_messages_used",
    "quiz": "quiz_generations_used",
    "flashcards": "flashcard_generations_used",
    "blueprint": "blueprint_regenerations_used",
    "embedding": "embedding_operations_used",
}


def _feature_limit(settings: Settings, feature: str) -> int:
    """Look up the per-session usage limit for a given AI feature.

    Limits are driven by environment-configured settings so they can be tuned
    per deployment without code changes.  An unknown feature name returns 0,
    which the caller treats as "access denied".

    Args:
        settings: Application settings containing per-feature limit values.
        feature: Feature key, one of ``chat``, ``quiz``, ``flashcards``,
            ``blueprint``, or ``embedding``.

    Returns:
        The maximum number of times a guest may use this feature in a session,
        or ``0`` if the feature is unrecognised.
    """
    if feature == "chat":
        return settings.guest_chat_limit
    if feature == "quiz":
        return settings.guest_quiz_limit
    if feature == "flashcards":
        return settings.guest_flashcards_limit
    if feature == "blueprint":
        return settings.guest_blueprint_limit
    if feature == "embedding":
        return settings.guest_embedding_limit
    return 0


def guest_usage_column(feature: str) -> str | None:
    """Return the ``guest_sandboxes`` column that tracks usage for a feature.

    Thin accessor over ``_FEATURE_COLUMNS`` so callers don't import the
    private constant directly.

    Args:
        feature: Feature key (e.g. ``"chat"``).

    Returns:
        Column name string, or ``None`` if the feature is unrecognised.
    """
    return _FEATURE_COLUMNS.get(feature)


def check_guest_ai_access(
    settings: Settings,
    sandbox: dict[str, Any],
    feature: str,
) -> tuple[bool, str | None]:
    """Determine whether a guest sandbox has remaining quota for a feature.

    This is a pure in-memory check against the sandbox snapshot already loaded
    by the caller — it does NOT call Supabase.  The actual increment happens
    later via ``increment_guest_ai_usage`` so that we only charge usage for
    requests that actually reach the AI provider.

    Args:
        settings: Application settings with per-feature limit configuration.
        sandbox: Row dict from the ``guest_sandboxes`` table, expected to
            contain usage columns (e.g. ``chat_messages_used``).
        feature: Feature key to check (``chat``, ``quiz``, etc.).

    Returns:
        A tuple of ``(allowed, error_message)``.  If allowed is ``True``,
        ``error_message`` is ``None``.  If ``False``, ``error_message`` is a
        human-readable string explaining why access was denied.
    """
    limit = _feature_limit(settings, feature)
    # A limit of 0 means the feature is disabled entirely for guests.
    if limit <= 0:
        return False, f"Guest {feature} limit reached."

    usage_column = guest_usage_column(feature)
    if not usage_column:
        return False, f"Guest {feature} limit reached."

    used = _coerce_non_negative_int(sandbox.get(usage_column))
    if used >= limit:
        return False, f"Guest {feature} limit reached."
    return True, None


async def acquire_guest_ai_slot(settings: Settings, sandbox_id: str) -> bool:
    """Atomically reserve a concurrent AI request slot for a guest sandbox.

    Calls the ``acquire_guest_ai_slot_service`` Postgres function via
    Supabase RPC.  Using an RPC (rather than a SELECT + UPDATE pair) is
    critical here: it ensures the check-and-increment is a single atomic
    operation in the database, preventing race conditions where two simultaneous
    requests both read a count below the limit and both proceed.

    Args:
        settings: Application settings with concurrency limit and Supabase
            credentials.
        sandbox_id: UUID of the guest sandbox row to lock a slot against.

    Returns:
        ``True`` if a slot was successfully acquired, ``False`` if the
        sandbox is already at the concurrency limit.

    Raises:
        RuntimeError: On Supabase RPC failure or network error.
    """
    payload = await _service_rpc(
        settings,
        "acquire_guest_ai_slot_service",
        {
            "p_sandbox_id": sandbox_id,
            "p_limit": settings.guest_max_concurrent_ai_requests,
        },
        "Failed to acquire guest concurrency slot.",
    )
    return payload is True


async def release_guest_ai_slot(settings: Settings, sandbox_id: str) -> None:
    """Release a previously acquired concurrent AI request slot.

    Should be called in a ``finally`` block so that a slot is always freed,
    even if the AI request itself raises an exception.

    Args:
        settings: Application settings with Supabase credentials.
        sandbox_id: UUID of the guest sandbox row to decrement.

    Raises:
        RuntimeError: On Supabase RPC failure or network error.
    """
    await _service_rpc(
        settings,
        "release_guest_ai_slot_service",
        {
            "p_sandbox_id": sandbox_id,
        },
        "Failed to release guest concurrency slot.",
    )


async def increment_guest_ai_usage(settings: Settings, sandbox_id: str, feature: str) -> None:
    """Persist a usage increment for a given feature against the guest sandbox.

    Called after a successful AI response is delivered so that failed or
    aborted requests are not charged against the guest's quota.

    Args:
        settings: Application settings with Supabase credentials.
        sandbox_id: UUID of the guest sandbox row to update.
        feature: Feature key (e.g. ``"chat"``) whose usage counter to increment.

    Raises:
        RuntimeError: On Supabase RPC failure or network error.
    """
    await _service_rpc(
        settings,
        "increment_guest_ai_usage_service",
        {
            "p_sandbox_id": sandbox_id,
            "p_feature": feature,
        },
        "Failed to persist guest usage.",
    )


async def _service_rpc(
    settings: Settings,
    function_name: str,
    payload: dict[str, Any],
    failure_message: str,
) -> Any:
    """Invoke a Supabase Postgres function via the PostgREST RPC endpoint.

    All guest rate-limit mutations route through this helper so that the
    service-role authentication and error-handling logic is centralised in one
    place.  The service-role key is used so that RLS policies on the
    ``guest_sandboxes`` table do not block the update — the backend is the
    trusted actor performing the write, not the guest user.

    Args:
        settings: Application settings with Supabase URL and service-role key.
        function_name: Name of the Postgres function to call (without schema).
        payload: JSON-serialisable dict of function arguments.
        failure_message: Fallback error message if Supabase does not return a
            descriptive one.

    Returns:
        The parsed JSON response body returned by the RPC function.

    Raises:
        RuntimeError: On connection timeout, HTTP error, or Supabase error
            response.
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase service credentials are not configured on Python backend.")

    rpc_url = f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/{function_name}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }

    try:
        # trust_env=False prevents httpx from picking up HTTP_PROXY / HTTPS_PROXY
        # environment variables set by some hosting platforms, which would
        # silently route traffic through an unintended proxy.
        async with httpx.AsyncClient(
            timeout=max(5, settings.ai_request_timeout_ms / 1000),
            trust_env=False,
        ) as client:
            response = await client.post(
                rpc_url,
                headers=headers,
                json=payload,
            )
    except httpx.TimeoutException as exc:
        raise RuntimeError(failure_message) from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(failure_message) from exc

    response_payload = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_error_message(response_payload) or failure_message
        raise RuntimeError(message)

    return response_payload


def _safe_json(response: httpx.Response) -> Any:
    """Parse the response body as JSON, returning ``None`` on failure.

    Args:
        response: httpx response to parse.

    Returns:
        Parsed JSON value, or ``None`` if the body is not valid JSON.
    """
    try:
        return response.json()
    except ValueError:
        return None


def _extract_error_message(payload: Any) -> str | None:
    """Extract a human-readable error string from a Supabase RPC error payload.

    Handles the two common shapes returned by PostgREST RPC errors:
      - ``{"error": {"message": "..."}}`` (structured error object)
      - ``{"error": "..."}`` (plain string error)
      - ``{"message": "..."}`` (top-level message field)

    Args:
        payload: Parsed JSON response body.

    Returns:
        The first non-empty error string found, or ``None``.
    """
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
        if isinstance(error, str) and error.strip():
            return error.strip()
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    return None


def _coerce_non_negative_int(value: Any) -> int:
    """Coerce an arbitrary value to a non-negative integer.

    Defensive conversion for usage counters read from the DB, which may arrive
    as int, float, or numeric strings depending on the JSON serialiser.

    Args:
        value: Raw value from a sandbox row field.

    Returns:
        Non-negative integer representation, defaulting to ``0`` on any
        conversion failure.
    """
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float):
        return max(0, int(value))
    if isinstance(value, str):
        try:
            return max(0, int(value.strip()))
        except ValueError:
            return 0
    return 0
