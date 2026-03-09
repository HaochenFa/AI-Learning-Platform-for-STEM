from __future__ import annotations

from typing import Any

import httpx

from app.config import Settings
from app.schemas import MaterialDispatchRequest, MaterialDispatchResult


def dispatch_material_job(settings: Settings, request: MaterialDispatchRequest) -> MaterialDispatchResult:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase service credentials are not configured on Python backend.")

    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    timeout_seconds = max(5, settings.ai_request_timeout_ms / 1000)

    with httpx.Client(timeout=timeout_seconds) as client:
        enqueue_url = f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/enqueue_material_job"
        enqueue_response = client.post(
            enqueue_url,
            headers=headers,
            json={
                "p_material_id": request.material_id,
                "p_class_id": request.class_id,
            },
        )

        enqueue_payload = _safe_json(enqueue_response)
        if enqueue_response.status_code >= 400:
            message = _extract_error_message(enqueue_payload) or "Failed to enqueue material job."
            raise RuntimeError(message)

        triggered = False
        if request.trigger_worker:
            worker_url = settings.material_worker_function_url or (
                f"{settings.supabase_url.rstrip('/')}/functions/v1/material-worker"
            )
            worker_headers = {"Content-Type": "application/json"}
            token = settings.material_worker_token
            if token:
                worker_headers["Authorization"] = f"Bearer {token}"
            worker_response = client.post(
                worker_url,
                headers=worker_headers,
                json={"batchSize": max(1, min(25, settings.material_worker_batch))},
            )
            if worker_response.status_code >= 400:
                worker_payload = _safe_json(worker_response)
                message = _extract_error_message(worker_payload) or "Failed to trigger material worker."
                raise RuntimeError(message)
            triggered = True

    return MaterialDispatchResult(
        enqueued=True,
        triggered=triggered,
    )


def _safe_json(response: httpx.Response) -> dict[str, Any]:
    try:
        parsed = response.json()
    except ValueError:
        return {}
    if isinstance(parsed, dict):
        return parsed
    return {}


def _extract_error_message(payload: dict[str, Any]) -> str | None:
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
    return None
