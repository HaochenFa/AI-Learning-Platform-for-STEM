from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings


def resolve_guest_class_access(
    client: httpx.Client,
    settings: Settings,
    *,
    class_id: str,
    user_id: str,
    sandbox_id: str | None,
) -> dict[str, Any] | None:
    """Verify that a guest user is authorised to access a specific class.

    Performs a two-step ownership check against Supabase:

      1. Load the class row and confirm that its ``sandbox_id`` matches the
         caller-supplied ``sandbox_id``.  This binds a guest session to the
         single class it was created for, preventing cross-class access.
      2. Load the guest sandbox row and confirm that it is ``active``, belongs
         to the ``user_id``, and references the same ``class_id``.

    Both checks must pass for access to be granted.  Either check returning
    ``None`` (no matching row) causes the function to return ``None``, which
    the caller should treat as "access denied".

    Possible access levels returned:
      - Teacher-guest (``is_teacher=True``): can view class management views.
      - Student-guest (``is_teacher=False``): standard read-only student access.

    Args:
        client: Shared ``httpx.Client`` for the current request; kept alive
            across both Supabase queries to reuse the TCP connection.
        settings: Application settings with Supabase URL and service-role key.
        class_id: UUID of the class the guest is trying to access.
        user_id: UUID of the authenticated guest user (from Supabase Anon Auth).
        sandbox_id: UUID of the guest sandbox, passed by the client.  Empty or
            missing values are treated as "no sandbox" and return ``None`` immediately.

    Returns:
        A dict with ``class_title`` (str) and ``is_teacher`` (bool), or
        ``None`` if access cannot be granted.

    Raises:
        RuntimeError: If either Supabase query returns an HTTP error status.
    """
    # --- 1. Reject immediately if no sandbox_id was provided ---
    # Guests without a sandbox cannot have a valid session; skip DB lookups.
    sandbox_id = (sandbox_id or "").strip()
    if not sandbox_id:
        return None

    # --- 2. Load the class row and verify sandbox ownership ---
    # The class row stores the ``sandbox_id`` that was used when the guest
    # session was originally created.  Comparing it here ensures that a guest
    # cannot supply an arbitrary class_id from a different session.
    class_row = _query_maybe_single(
        client,
        _rest_url(settings, "classes"),
        params={
            "select": "id,title,sandbox_id",
            "id": f"eq.{quote(class_id, safe='')}",
            "limit": "1",
        },
        settings=settings,
        failure_message="Failed to load guest class access context.",
    )
    if not class_row or class_row.get("sandbox_id") != sandbox_id:
        return None

    # --- 3. Load the guest sandbox row and verify it is active ---
    # Filter on ``user_id`` and ``status=active`` in the query rather than
    # in Python so that Supabase can use indexes and we never load inactive
    # or foreign sandbox rows into memory.
    guest_sandbox = _query_maybe_single(
        client,
        _rest_url(settings, "guest_sandboxes"),
        params={
            "select": "id,class_id,guest_role,status",
            "id": f"eq.{quote(sandbox_id, safe='')}",
            "user_id": f"eq.{quote(user_id, safe='')}",
            "status": "eq.active",
            "limit": "1",
        },
        settings=settings,
        failure_message="Failed to load guest sandbox access context.",
    )
    # Cross-check: the sandbox must reference the same class_id the caller provided.
    if not guest_sandbox or guest_sandbox.get("class_id") != class_id:
        return None

    # --- 4. Derive the access level from guest_role ---
    guest_role = str(guest_sandbox.get("guest_role") or "").strip().lower()
    return {
        "class_title": str(class_row.get("title") or ""),
        "is_teacher": guest_role == "teacher",
    }


def _rest_url(settings: Settings, table: str) -> str:
    """Build a fully-qualified PostgREST table URL.

    Args:
        settings: Application settings containing the Supabase project URL.
        table: Name of the Supabase table (e.g. ``"classes"``).

    Returns:
        Full URL string for the PostgREST table endpoint.

    Raises:
        RuntimeError: If the Supabase URL is not configured.
    """
    if not settings.supabase_url:
        raise RuntimeError("Supabase URL is not configured.")
    return f"{settings.supabase_url.rstrip('/')}/rest/v1/{table}"


def _service_headers(settings: Settings) -> dict[str, str]:
    """Build HTTP headers that authenticate as the Supabase service role.

    The service-role key bypasses RLS so that the backend can read sandbox and
    class rows regardless of which user is currently authenticated.

    Args:
        settings: Application settings containing the service-role key.

    Returns:
        Dict with ``Authorization`` and ``apikey`` headers.

    Raises:
        RuntimeError: If the service-role key is not configured.
    """
    service_key = settings.supabase_service_role_key
    if not service_key:
        raise RuntimeError("Supabase service credentials are not configured.")
    return {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }


def _safe_json(response: httpx.Response) -> Any:
    """Parse the response body as JSON, returning ``None`` on failure.

    Args:
        response: httpx response to parse.

    Returns:
        Parsed JSON value, or ``None`` if the body is not valid JSON.
    """
    try:
        payload = response.json()
    except ValueError:
        return None
    return payload


def _query_maybe_single(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, str],
    settings: Settings,
    failure_message: str,
) -> dict[str, Any] | None:
    """Execute a PostgREST GET query and return at most one row.

    Wraps the common pattern of issuing a filtered SELECT, checking for HTTP
    errors, and safely extracting the first row from the response list.

    Args:
        client: Shared httpx client.
        url: PostgREST table endpoint URL.
        params: Query parameters (filters, select clause, limit).
        settings: Application settings for building auth headers.
        failure_message: Error message raised if Supabase returns a 4xx/5xx.

    Returns:
        The first dict row from the response list, or ``None`` if the list is
        empty or the first element is not a dict.

    Raises:
        RuntimeError: If Supabase returns an HTTP error status.
    """
    response = client.get(url, headers=_service_headers(settings), params=params)
    payload = _safe_json(response)
    if response.status_code >= 400:
        raise RuntimeError(failure_message)
    if not isinstance(payload, list) or not payload:
        return None
    row = payload[0]
    if not isinstance(row, dict):
        return None
    return row
