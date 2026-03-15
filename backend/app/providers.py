from __future__ import annotations

import time
from typing import Any

import httpx

from app.config import Settings
from app.schemas import AiProvider, AiUsage, EmbeddingsRequest, EmbeddingsResult, GenerateRequest, GenerateResult

PROVIDER_ORDER: tuple[AiProvider, ...] = ("openrouter", "openai", "gemini")


def generate_with_fallback(settings: Settings, request: GenerateRequest) -> GenerateResult:
    timeout_ms = _resolve_timeout(
        request.timeout_ms, settings.ai_request_timeout_ms)
    deadline = _deadline(timeout_ms)
    providers = _resolve_provider_order(
        settings=settings,
        requested_order=request.provider_order,
        requested_default=request.default_provider,
        for_embeddings=False,
    )
    if not providers:
        raise RuntimeError("No AI providers are configured.")

    last_error: RuntimeError | None = None
    for provider in providers:
        try:
            remaining_ms = _remaining_timeout_ms(deadline)
            if remaining_ms <= 0:
                raise RuntimeError(
                    f"AI request timed out after {timeout_ms}ms.")
            return _generate_with_provider(settings, provider, request, remaining_ms)
        except RuntimeError as error:
            last_error = error
            if settings.log_provider_failures:
                print(
                    f"[python-backend] generate provider={provider} failed: {error}")
            continue

    raise last_error or RuntimeError("AI request failed.")


def generate_embeddings_with_fallback(
    settings: Settings, request: EmbeddingsRequest
) -> EmbeddingsResult:
    timeout_ms = _resolve_timeout(
        request.timeout_ms, settings.ai_embedding_timeout_ms)
    deadline = _deadline(timeout_ms)
    providers = _resolve_provider_order(
        settings=settings,
        requested_order=request.provider_order,
        requested_default=request.default_provider,
        for_embeddings=True,
    )
    if not providers:
        raise RuntimeError("No embedding providers are configured.")

    last_error: RuntimeError | None = None
    for provider in providers:
        try:
            remaining_ms = _remaining_timeout_ms(deadline)
            if remaining_ms <= 0:
                raise RuntimeError(
                    f"Embedding request timed out after {timeout_ms}ms.")
            return _embed_with_provider(settings, provider, request.inputs, remaining_ms)
        except RuntimeError as error:
            last_error = error
            if settings.log_provider_failures:
                print(
                    f"[python-backend] embeddings provider={provider} failed: {error}")
            continue

    raise last_error or RuntimeError("Embedding request failed.")


def _resolve_provider_order(
    settings: Settings,
    requested_order: list[AiProvider] | None,
    requested_default: AiProvider | None,
    for_embeddings: bool,
) -> list[AiProvider]:
    configured: list[AiProvider] = [
        provider
        for provider in PROVIDER_ORDER
        if _is_provider_configured(settings, provider, for_embeddings)
    ]
    if not configured:
        return []

    base_order = requested_order if requested_order is not None else configured
    order: list[AiProvider] = [
        provider for provider in base_order if provider in configured]
    if not order:
        order = configured

    default_provider = requested_default or _normalize_provider(
        settings.ai_provider_default)
    if default_provider and default_provider in order:
        prioritized: list[AiProvider] = [default_provider]
        for provider in order:
            if provider != default_provider:
                prioritized.append(provider)
        return prioritized
    return order


def _normalize_provider(value: str | None) -> AiProvider | None:
    if value == "openrouter":
        return "openrouter"
    if value == "openai":
        return "openai"
    if value == "gemini":
        return "gemini"
    return None


def _is_provider_configured(settings: Settings, provider: AiProvider, for_embeddings: bool) -> bool:
    if provider == "openrouter":
        model = settings.openrouter_embedding_model if for_embeddings else settings.openrouter_model
        return bool(settings.openrouter_api_key and model)
    if provider == "openai":
        model = settings.openai_embedding_model if for_embeddings else settings.openai_model
        return bool(settings.openai_api_key and model)
    model = settings.gemini_embedding_model if for_embeddings else settings.gemini_model
    return bool(settings.gemini_api_key and model)


def _resolve_timeout(candidate: int | None, fallback: int) -> int:
    if isinstance(candidate, int) and candidate > 0:
        return candidate
    return fallback


def _deadline(timeout_ms: int) -> float:
    return time.perf_counter() + (timeout_ms / 1000)


def _remaining_timeout_ms(deadline: float) -> int:
    return int((deadline - time.perf_counter()) * 1000)


def _generate_with_provider(
    settings: Settings,
    provider: AiProvider,
    request: GenerateRequest,
    timeout_ms: int,
) -> GenerateResult:
    if provider == "openrouter":
        return _call_openrouter_generate(settings, request, timeout_ms)
    if provider == "openai":
        return _call_openai_generate(settings, request, timeout_ms)
    return _call_gemini_generate(settings, request, timeout_ms)


def _embed_with_provider(
    settings: Settings,
    provider: AiProvider,
    inputs: list[str],
    timeout_ms: int,
) -> EmbeddingsResult:
    if provider == "openrouter":
        return _call_openrouter_embeddings(settings, inputs, timeout_ms)
    if provider == "openai":
        return _call_openai_embeddings(settings, inputs, timeout_ms)
    return _call_gemini_embeddings(settings, inputs, timeout_ms)


def _call_openrouter_generate(
    settings: Settings, request: GenerateRequest, timeout_ms: int
) -> GenerateResult:
    if not settings.openrouter_api_key or not settings.openrouter_model:
        raise RuntimeError("OpenRouter is not configured.")

    payload: dict[str, Any] = {
        "model": settings.openrouter_model,
        "messages": [
            {"role": "system", "content": request.system},
            {"role": "user", "content": request.user},
        ],
        "temperature": request.temperature if request.temperature is not None else 0.2,
        "max_tokens": request.max_tokens if request.max_tokens is not None else 1200,
        "response_format": {"type": "json_object"},
    }
    if request.session_id:
        payload["session_id"] = request.session_id
    if request.transforms:
        payload["transforms"] = request.transforms

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    started_at = time.perf_counter()
    data = _post_json(
        f"{settings.openrouter_base_url.rstrip('/')}/chat/completions",
        payload=payload,
        headers=headers,
        timeout_ms=timeout_ms,
        label="OpenRouter generation request",
    )

    return GenerateResult(
        provider="openrouter",
        model=settings.openrouter_model,
        content=_normalize_chat_content((data.get("choices") or [{}])[
                                        0].get("message", {}).get("content")),
        usage=_normalize_usage(data.get("usage")),
        latency_ms=int((time.perf_counter() - started_at) * 1000),
    )


def _call_openai_generate(settings: Settings, request: GenerateRequest, timeout_ms: int) -> GenerateResult:
    if not settings.openai_api_key or not settings.openai_model:
        raise RuntimeError("OpenAI is not configured.")

    started_at = time.perf_counter()
    data = _post_json(
        "https://api.openai.com/v1/chat/completions",
        payload={
            "model": settings.openai_model,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
            "temperature": request.temperature if request.temperature is not None else 0.2,
            "max_tokens": request.max_tokens if request.max_tokens is not None else 1200,
            "response_format": {"type": "json_object"},
        },
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        timeout_ms=timeout_ms,
        label="OpenAI generation request",
    )

    return GenerateResult(
        provider="openai",
        model=settings.openai_model,
        content=_normalize_chat_content((data.get("choices") or [{}])[
                                        0].get("message", {}).get("content")),
        usage=_normalize_usage(data.get("usage")),
        latency_ms=int((time.perf_counter() - started_at) * 1000),
    )


def _call_gemini_generate(settings: Settings, request: GenerateRequest, timeout_ms: int) -> GenerateResult:
    if not settings.gemini_api_key or not settings.gemini_model:
        raise RuntimeError("Gemini is not configured.")

    started_at = time.perf_counter()
    data = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent?key={settings.gemini_api_key}",
        payload={
            "systemInstruction": {"parts": [{"text": request.system}]},
            "contents": [{"role": "user", "parts": [{"text": request.user}]}],
            "generationConfig": {
                "temperature": request.temperature if request.temperature is not None else 0.2,
                "maxOutputTokens": request.max_tokens if request.max_tokens is not None else 1200,
            },
        },
        headers={"Content-Type": "application/json"},
        timeout_ms=timeout_ms,
        label="Gemini generation request",
    )

    content = "".join(
        [part.get("text", "") for part in ((data.get("candidates") or [{}])[
            0].get("content", {}).get("parts") or [])]
    )

    return GenerateResult(
        provider="gemini",
        model=settings.gemini_model,
        content=content,
        usage=_normalize_gemini_usage(data.get("usageMetadata")),
        latency_ms=int((time.perf_counter() - started_at) * 1000),
    )


def _call_openai_embeddings(settings: Settings, inputs: list[str], timeout_ms: int) -> EmbeddingsResult:
    if not settings.openai_api_key or not settings.openai_embedding_model:
        raise RuntimeError("OpenAI embeddings are not configured.")

    started_at = time.perf_counter()
    data = _post_json(
        "https://api.openai.com/v1/embeddings",
        payload={"model": settings.openai_embedding_model, "input": inputs},
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        timeout_ms=timeout_ms,
        label="OpenAI embeddings request",
    )
    embeddings = [item.get("embedding", [])
                  for item in (data.get("data") or [])]

    return EmbeddingsResult(
        provider="openai",
        model=settings.openai_embedding_model,
        embeddings=embeddings,
        usage=_normalize_usage(data.get("usage")),
        latency_ms=int((time.perf_counter() - started_at) * 1000),
    )


def _call_openrouter_embeddings(
    settings: Settings, inputs: list[str], timeout_ms: int
) -> EmbeddingsResult:
    if not settings.openrouter_api_key or not settings.openrouter_embedding_model:
        raise RuntimeError("OpenRouter embeddings are not configured.")

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name

    started_at = time.perf_counter()
    data = _post_json(
        f"{settings.openrouter_base_url.rstrip('/')}/embeddings",
        payload={"model": settings.openrouter_embedding_model, "input": inputs},
        headers=headers,
        timeout_ms=timeout_ms,
        label="OpenRouter embeddings request",
    )
    embeddings = [item.get("embedding", [])
                  for item in (data.get("data") or [])]

    return EmbeddingsResult(
        provider="openrouter",
        model=settings.openrouter_embedding_model,
        embeddings=embeddings,
        usage=_normalize_usage(data.get("usage")),
        latency_ms=int((time.perf_counter() - started_at) * 1000),
    )


def _call_gemini_embeddings(settings: Settings, inputs: list[str], timeout_ms: int) -> EmbeddingsResult:
    if not settings.gemini_api_key or not settings.gemini_embedding_model:
        raise RuntimeError("Gemini embeddings are not configured.")

    started_at = time.perf_counter()
    data = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_embedding_model}:batchEmbedContents?key={settings.gemini_api_key}",
        payload={
            "requests": [{"content": {"parts": [{"text": input_text}]}} for input_text in inputs]
        },
        headers={"Content-Type": "application/json"},
        timeout_ms=timeout_ms,
        label="Gemini embeddings request",
    )
    embeddings = [item.get("values", [])
                  for item in (data.get("embeddings") or [])]

    return EmbeddingsResult(
        provider="gemini",
        model=settings.gemini_embedding_model,
        embeddings=embeddings,
        usage=_normalize_gemini_usage(data.get("usageMetadata")),
        latency_ms=int((time.perf_counter() - started_at) * 1000),
    )


def _post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout_ms: int,
    label: str,
) -> dict[str, Any]:
    timeout_seconds = timeout_ms / 1000
    try:
        with httpx.Client(timeout=timeout_seconds, trust_env=False) as client:
            response = client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as error:
        raise RuntimeError(
            f"{label} timed out after {timeout_ms}ms.") from error
    except httpx.HTTPError as error:
        raise RuntimeError(f"{label} failed.") from error

    data = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_provider_error_message(data) or f"{label} failed."
        raise RuntimeError(message)
    return data


def _safe_json(response: httpx.Response) -> dict[str, Any]:
    try:
        parsed = response.json()
    except ValueError:
        return {}
    if isinstance(parsed, dict):
        return parsed
    return {}


def _extract_provider_error_message(data: dict[str, Any]) -> str | None:
    error = data.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    if isinstance(error, str) and error.strip():
        return error.strip()
    return None


def _normalize_usage(raw: Any) -> AiUsage | None:
    if not isinstance(raw, dict):
        return None
    return AiUsage(
        prompt_tokens=_to_int(raw.get("prompt_tokens")),
        completion_tokens=_to_int(raw.get("completion_tokens")),
        total_tokens=_to_int(raw.get("total_tokens")),
    )


def _normalize_gemini_usage(raw: Any) -> AiUsage | None:
    if not isinstance(raw, dict):
        return None
    return AiUsage(
        prompt_tokens=_to_int(raw.get("promptTokenCount")),
        completion_tokens=_to_int(raw.get("candidatesTokenCount")),
        total_tokens=_to_int(raw.get("totalTokenCount")),
    )


def _to_int(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def _normalize_chat_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, str):
                chunks.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        return "".join(chunks).strip()
    return ""
