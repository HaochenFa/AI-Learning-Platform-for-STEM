from __future__ import annotations

from typing import Any

import httpx

from app.config import Settings
from app.schemas import (
    MaterialDispatchRequest,
    MaterialDispatchResult,
    MaterialProcessRequest,
    MaterialProcessResult,
)


def dispatch_material_job(settings: Settings, request: MaterialDispatchRequest) -> MaterialDispatchResult:
    """Enqueue a material for background processing and optionally wake the worker.

    Material ingestion is queue-driven: this function calls the
    ``enqueue_material_job`` Postgres RPC to insert the job into the
    ``pgmq``-backed queue.  If ``request.trigger_worker`` is True, it also
    fires an HTTP POST to the Supabase Edge Function ``material-worker`` so
    the job is picked up immediately rather than waiting for the next
    scheduled invocation.

    Args:
        settings: Application settings with Supabase credentials, worker URL,
            and timeout configuration.
        request: Validated payload containing ``material_id``, ``class_id``,
            and a ``trigger_worker`` flag.

    Returns:
        A ``MaterialDispatchResult`` with ``enqueued=True`` and a ``triggered``
        flag indicating whether the Edge Function was invoked.

    Raises:
        RuntimeError: If Supabase credentials are missing, if the enqueue RPC
            fails, or if the worker trigger returns an error status.
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "Supabase service credentials are not configured on Python backend.")

    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    timeout_seconds = max(5, settings.ai_request_timeout_ms / 1000)

    with httpx.Client(timeout=timeout_seconds, trust_env=False) as client:
        # --- 1. Enqueue the material job via Postgres RPC ---
        # The RPC inserts a message into the pgmq queue.  Using an RPC rather
        # than a direct INSERT allows the Postgres function to enforce ownership
        # checks and set queue metadata atomically.
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
            message = _extract_error_message(
                enqueue_payload) or "Failed to enqueue material job."
            raise RuntimeError(message)

        # --- 2. Optionally trigger the Edge Function worker immediately ---
        # When trigger_worker is True, we wake the worker so processing begins
        # at once.  When False, the job will be picked up on the next scheduled
        # worker run (e.g. a cron-triggered invocation).
        triggered = False
        if request.trigger_worker:
            trigger_material_worker(settings, client=client)
            triggered = True

    return MaterialDispatchResult(
        enqueued=True,
        triggered=triggered,
    )


def process_material_jobs(settings: Settings, request: MaterialProcessRequest) -> MaterialProcessResult:
    """Trigger the material worker and return a summary of processed jobs.

    Intended for use by admin/cron endpoints that need to drive the worker
    directly and inspect results.  Unlike ``dispatch_material_job``, this
    function always triggers the worker and returns batch-level metrics
    (processed, succeeded, failed, retried) from the worker's response body.

    Args:
        settings: Application settings with worker URL and timeout configuration.
        request: Validated payload containing an optional ``batch_size``.

    Returns:
        A ``MaterialProcessResult`` with counts from the worker run.

    Raises:
        RuntimeError: If the worker trigger fails or returns an error status.
    """
    with httpx.Client(timeout=max(5, settings.ai_request_timeout_ms / 1000), trust_env=False) as client:
        payload = trigger_material_worker(
            settings, request.batch_size, client=client)

    return MaterialProcessResult(
        triggered=True,
        processed=_coerce_non_negative_int(payload.get("processed")),
        succeeded=_coerce_non_negative_int(payload.get("succeeded")),
        failed=_coerce_non_negative_int(payload.get("failed")),
        retried=_coerce_non_negative_int(payload.get("retried")),
        errors=_coerce_errors(payload.get("errors")),
    )


def trigger_material_worker(
    settings: Settings,
    batch_size: int | None = None,
    *,
    client: httpx.Client,
) -> dict[str, Any]:
    """POST to the Supabase Edge Function that dequeues and processes materials.

    Resolves the worker URL from ``settings.material_worker_function_url`` if
    set, falling back to the conventional Supabase Edge Function path derived
    from ``settings.supabase_url``.  The batch size is clamped to [1, 25] to
    avoid overwhelming the worker with a single oversized request.

    Args:
        settings: Application settings with worker URL, auth token, and batch
            size defaults.
        batch_size: Optional override for the number of jobs to process in this
            run.  Clamped to [1, 25].
        client: Caller-supplied httpx client so that the connection can be
            reused within a larger request context.

    Returns:
        The parsed JSON response body from the worker, expected to contain
        ``processed``, ``succeeded``, ``failed``, ``retried``, and ``errors``
        fields.

    Raises:
        RuntimeError: If Supabase URL is absent, if the worker returns an error
            status, or if the response cannot be parsed.
    """
    worker_url = settings.material_worker_function_url
    if not worker_url:
        # Fall back to the canonical Supabase Edge Function URL pattern when no
        # custom worker URL is configured (common in local development).
        if not settings.supabase_url:
            raise RuntimeError(
                "Supabase URL is not configured on Python backend.")
        worker_url = f"{settings.supabase_url.rstrip('/')}/functions/v1/material-worker"

    # Clamp batch size to a safe range to prevent the worker from being flooded.
    clamped_batch = max(
        1, min(25, batch_size or settings.material_worker_batch))
    worker_headers = {"Content-Type": "application/json"}
    token = settings.material_worker_token
    if token:
        # The Edge Function validates this bearer token to reject unauthenticated
        # trigger calls.  In local dev the token is typically absent and the
        # function allows unauthenticated access.
        worker_headers["Authorization"] = f"Bearer {token}"

    worker_response = client.post(
        worker_url,
        headers=worker_headers,
        json={"batchSize": clamped_batch},
    )
    worker_payload = _safe_json(worker_response)
    if worker_response.status_code >= 400:
        message = _extract_error_message(
            worker_payload) or "Failed to trigger material worker."
        raise RuntimeError(message)
    return worker_payload


def _safe_json(response: httpx.Response) -> dict[str, Any]:
    """Parse the response body as JSON, returning an empty dict on failure.

    Always returns a dict (never a list or scalar) so callers can use
    ``.get()`` safely without type checks.

    Args:
        response: httpx response to parse.

    Returns:
        Parsed JSON dict, or ``{}`` if parsing fails or the root value is not
        a dict.
    """
    try:
        parsed = response.json()
    except ValueError:
        return {}
    if isinstance(parsed, dict):
        return parsed
    return {}


def _extract_error_message(payload: dict[str, Any]) -> str | None:
    """Extract a human-readable error string from a worker or RPC error payload.

    Args:
        payload: Parsed JSON response body.

    Returns:
        The first non-empty error string found, or ``None``.
    """
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


def _coerce_non_negative_int(value: Any) -> int:
    """Coerce an arbitrary value to a non-negative integer.

    Defensive conversion for metric counters returned by the worker JSON body,
    which may be int, float, or numeric string depending on the Edge Function
    runtime's JSON serialiser.

    Args:
        value: Raw counter value from the worker response.

    Returns:
        Non-negative integer, defaulting to ``0`` on any conversion failure.
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


def _coerce_errors(value: Any) -> list[str]:
    """Coerce the ``errors`` field from the worker response to a list of strings.

    The worker may return ``null``, a non-list, or a list containing non-string
    items.  This function normalises all cases to a clean list of stripped
    strings.

    Args:
        value: Raw ``errors`` value from the worker response body.

    Returns:
        List of non-empty error strings, or an empty list if the input is
        absent or malformed.
    """
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]
