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
    sandbox_id = (sandbox_id or "").strip()
    if not sandbox_id:
        return None

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
    if not guest_sandbox or guest_sandbox.get("class_id") != class_id:
        return None

    guest_role = str(guest_sandbox.get("guest_role") or "").strip().lower()
    return {
        "class_title": str(class_row.get("title") or ""),
        "is_teacher": guest_role == "teacher",
    }


def _rest_url(settings: Settings, table: str) -> str:
    if not settings.supabase_url:
        raise RuntimeError("Supabase URL is not configured.")
    return f"{settings.supabase_url.rstrip('/')}/rest/v1/{table}"


def _service_headers(settings: Settings) -> dict[str, str]:
    service_key = settings.supabase_service_role_key
    if not service_key:
        raise RuntimeError("Supabase service credentials are not configured.")
    return {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }


def _safe_json(response: httpx.Response) -> Any:
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
