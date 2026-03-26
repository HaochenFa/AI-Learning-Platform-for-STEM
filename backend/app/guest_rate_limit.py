from __future__ import annotations

from typing import Any

import httpx

from app.config import Settings

_FEATURE_COLUMNS = {
    "chat": "chat_messages_used",
    "quiz": "quiz_generations_used",
    "flashcards": "flashcard_generations_used",
    "blueprint": "blueprint_regenerations_used",
    "embedding": "embedding_operations_used",
}


def _feature_limit(settings: Settings, feature: str) -> int:
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
    return _FEATURE_COLUMNS.get(feature)


def check_guest_ai_access(
    settings: Settings,
    sandbox: dict[str, Any],
    feature: str,
) -> tuple[bool, str | None]:
    limit = _feature_limit(settings, feature)
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
    await _service_rpc(
        settings,
        "release_guest_ai_slot_service",
        {
            "p_sandbox_id": sandbox_id,
        },
        "Failed to release guest concurrency slot.",
    )


async def increment_guest_ai_usage(settings: Settings, sandbox_id: str, feature: str) -> None:
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
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase service credentials are not configured on Python backend.")

    rpc_url = f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/{function_name}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }

    try:
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
    try:
        return response.json()
    except ValueError:
        return None


def _extract_error_message(payload: Any) -> str | None:
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
