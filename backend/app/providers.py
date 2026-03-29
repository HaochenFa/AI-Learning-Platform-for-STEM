from __future__ import annotations

import time
from typing import Any

import httpx

from app.config import Settings
from app.schemas import AiProvider, AiUsage, EmbeddingsRequest, EmbeddingsResult, GenerateRequest, GenerateResult

# Default provider try-order when no explicit order is configured.
# Providers are attempted left-to-right until one succeeds; this order
# reflects production preference (OpenRouter provides model routing
# flexibility, OpenAI is the direct fallback, Gemini is a secondary option).
PROVIDER_ORDER: tuple[AiProvider, ...] = ("openrouter", "openai", "gemini")


def generate_with_fallback(settings: Settings, request: GenerateRequest) -> GenerateResult:
    """Call the configured AI providers in priority order, falling back on error.

    Deadline-based timeout: a single wall-clock deadline is computed once from
    ``timeout_ms`` so that the total time spent across all provider attempts
    (including retries) never exceeds the configured limit.  Each attempt
    receives only the remaining milliseconds at the time it is dispatched,
    ensuring the aggregate latency stays within the budget.

    Args:
        settings: Application settings carrying provider API keys and timeouts.
        request: The generation request including system/user prompts, temperature,
            token limit, and optional provider ordering hints.

    Returns:
        A ``GenerateResult`` from the first provider that succeeds.

    Raises:
        RuntimeError: If no providers are configured, if the deadline is exceeded
            before any provider is tried, or if all providers fail.
    """
    # --- 1. Deadline setup ---
    timeout_ms = _resolve_timeout(
        request.timeout_ms, settings.ai_request_timeout_ms)
    deadline = _deadline(timeout_ms)

    # --- 2. Provider resolution ---
    providers = _resolve_provider_order(
        settings=settings,
        requested_order=request.provider_order,
        requested_default=request.default_provider,
        for_embeddings=False,
    )
    if not providers:
        raise RuntimeError("No AI providers are configured.")

    # --- 3. Provider dispatch with fallback ---
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
    """Call the configured embedding providers in priority order, falling back on error.

    Uses the same deadline-based timeout strategy as ``generate_with_fallback``
    but selects providers that have an embedding model configured (checked via
    ``_is_provider_configured`` with ``for_embeddings=True``).

    Args:
        settings: Application settings.
        request: Embedding request with input texts and optional provider hints.

    Returns:
        An ``EmbeddingsResult`` from the first provider that succeeds.

    Raises:
        RuntimeError: If no embedding providers are configured, if the deadline
            expires, or if all providers fail.
    """
    # --- 1. Deadline setup ---
    timeout_ms = _resolve_timeout(
        request.timeout_ms, settings.ai_embedding_timeout_ms)
    deadline = _deadline(timeout_ms)

    # --- 2. Provider resolution ---
    providers = _resolve_provider_order(
        settings=settings,
        requested_order=request.provider_order,
        requested_default=request.default_provider,
        for_embeddings=True,
    )
    if not providers:
        raise RuntimeError("No embedding providers are configured.")

    # --- 3. Provider dispatch with fallback ---
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
    """Determine the ordered list of providers to attempt for this request.

    Priority algorithm (applied in order):
    1. Start with ``configured``: providers that have the required API key and
       model in ``settings``, filtered from ``PROVIDER_ORDER``.
    2. If the caller supplies a ``requested_order`` list, use it as the base
       order (filtering out any unconfigured providers).  Otherwise use
       ``configured`` directly.
    3. If ``requested_default`` is set (caller-level override) or
       ``settings.ai_provider_default`` is set (environment-driven default),
       move that provider to the front of the list.

    "Override" in step 3 means: the caller (or the environment) can declare
    a preferred provider that jumps to the front of the attempt queue.  This
    is environment-driven (``ai_provider_default`` in settings) rather than
    user-controlled at the HTTP layer — it allows operators to route traffic
    to a preferred provider without code changes.

    Args:
        settings: Application settings.
        requested_order: Optional explicit provider order from the request.
        requested_default: Optional preferred provider from the request.
        for_embeddings: When ``True``, checks embedding-specific model config.

    Returns:
        An ordered list of configured providers to attempt.
    """
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
        # Move the preferred provider to position 0, preserving relative order
        # of the remaining providers.
        prioritized: list[AiProvider] = [default_provider]
        for provider in order:
            if provider != default_provider:
                prioritized.append(provider)
        return prioritized
    return order


def _normalize_provider(value: str | None) -> AiProvider | None:
    """Validate and normalise a raw provider string to a known ``AiProvider`` literal.

    Args:
        value: Any string value (e.g. from an env var or config field).

    Returns:
        The matching ``AiProvider`` literal, or ``None`` for unknown / empty values.
    """
    if value == "openrouter":
        return "openrouter"
    if value == "openai":
        return "openai"
    if value == "gemini":
        return "gemini"
    return None


def _is_provider_configured(settings: Settings, provider: AiProvider, for_embeddings: bool) -> bool:
    """Return ``True`` if the provider has the necessary API key and model configured.

    For embeddings, a separate model name field is required (e.g.
    ``openai_embedding_model``) because the chat model and embedding model may
    differ or be hosted at different endpoints.

    Args:
        settings: Application settings.
        provider: The provider to check.
        for_embeddings: When ``True``, checks the embedding model field instead
            of the chat model field.

    Returns:
        ``True`` only when both the API key and the appropriate model name are
        non-empty in settings.
    """
    if provider == "openrouter":
        model = settings.openrouter_embedding_model if for_embeddings else settings.openrouter_model
        return bool(settings.openrouter_api_key and model)
    if provider == "openai":
        model = settings.openai_embedding_model if for_embeddings else settings.openai_model
        return bool(settings.openai_api_key and model)
    model = settings.gemini_embedding_model if for_embeddings else settings.gemini_model
    return bool(settings.gemini_api_key and model)


def _resolve_timeout(candidate: int | None, fallback: int) -> int:
    """Return ``candidate`` when valid, otherwise the fallback timeout.

    Args:
        candidate: Optional timeout in milliseconds from the request.
        fallback: Default timeout in milliseconds from settings.

    Returns:
        An integer millisecond timeout > 0.
    """
    if isinstance(candidate, int) and candidate > 0:
        return candidate
    return fallback


def _deadline(timeout_ms: int) -> float:
    """Compute an absolute deadline as a ``perf_counter`` timestamp.

    The deadline is stored as a ``perf_counter`` float (monotonic, high
    resolution) rather than a wall-clock datetime so that it is immune to
    system clock adjustments during a request.

    Args:
        timeout_ms: The total allowed time for this request in milliseconds.

    Returns:
        Absolute deadline as ``time.perf_counter() + timeout_ms / 1000``.
    """
    return time.perf_counter() + (timeout_ms / 1000)


def _remaining_timeout_ms(deadline: float) -> int:
    """Compute the remaining time budget in milliseconds from a deadline.

    Called immediately before each provider attempt so each attempt receives
    only the time left from the original budget, not a fresh full timeout.
    A non-positive return value means the budget is exhausted.

    Args:
        deadline: Absolute deadline float from ``_deadline``.

    Returns:
        Remaining milliseconds as a (possibly negative) integer.
    """
    return int((deadline - time.perf_counter()) * 1000)


def _generate_with_provider(
    settings: Settings,
    provider: AiProvider,
    request: GenerateRequest,
    timeout_ms: int,
) -> GenerateResult:
    """Dispatch a generation request to the concrete provider implementation.

    Args:
        settings: Application settings.
        provider: The target provider.
        request: The generation request.
        timeout_ms: Remaining timeout budget in milliseconds.

    Returns:
        A ``GenerateResult`` from the provider.

    Raises:
        RuntimeError: On provider error or timeout.
    """
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
    """Dispatch an embeddings request to the concrete provider implementation.

    Args:
        settings: Application settings.
        provider: The target provider.
        inputs: List of text strings to embed.
        timeout_ms: Remaining timeout budget in milliseconds.

    Returns:
        An ``EmbeddingsResult`` from the provider.

    Raises:
        RuntimeError: On provider error or timeout.
    """
    if provider == "openrouter":
        return _call_openrouter_embeddings(settings, inputs, timeout_ms)
    if provider == "openai":
        return _call_openai_embeddings(settings, inputs, timeout_ms)
    return _call_gemini_embeddings(settings, inputs, timeout_ms)


def _call_openrouter_generate(
    settings: Settings, request: GenerateRequest, timeout_ms: int
) -> GenerateResult:
    """Call the OpenRouter chat completions API and return a normalised result.

    Sends a ``response_format: {type: "json_object"}`` hint to encourage
    structured output.  Optional OpenRouter metadata headers (``HTTP-Referer``,
    ``X-Title``) are included when configured to improve routing attribution.

    Args:
        settings: Application settings.
        request: The generation request.
        timeout_ms: Remaining timeout in milliseconds.

    Returns:
        A ``GenerateResult`` with the assistant message content.

    Raises:
        RuntimeError: If OpenRouter is not configured or the request fails.
    """
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

    # --- 4. Model call + response normalisation ---
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
    """Call the OpenAI chat completions API and return a normalised result.

    Uses the ``/v1/chat/completions`` endpoint directly.  Response shape is
    identical to OpenRouter's, so the same ``_normalize_chat_content`` and
    ``_normalize_usage`` helpers apply.

    Args:
        settings: Application settings.
        request: The generation request.
        timeout_ms: Remaining timeout in milliseconds.

    Returns:
        A ``GenerateResult`` with the assistant message content.

    Raises:
        RuntimeError: If OpenAI is not configured or the request fails.
    """
    if not settings.openai_api_key or not settings.openai_model:
        raise RuntimeError("OpenAI is not configured.")

    # --- 4. Model call + response normalisation ---
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
    """Call the Gemini generateContent API and return a normalised result.

    Gemini's request and response shapes differ from OpenAI/OpenRouter:
    - Request: ``systemInstruction`` (not ``messages[0].role="system"``),
      ``contents`` with ``parts`` arrays, ``generationConfig`` for temperature
      and token limits.
    - Response: ``candidates[0].content.parts[*].text`` (array of part objects
      rather than a single ``message.content`` string), and
      ``usageMetadata.candidatesTokenCount`` (not ``usage.completion_tokens``).

    Content extraction joins all ``text`` parts from the first candidate.

    Args:
        settings: Application settings.
        request: The generation request.
        timeout_ms: Remaining timeout in milliseconds.

    Returns:
        A ``GenerateResult`` with the generated content.

    Raises:
        RuntimeError: If Gemini is not configured or the request fails.
    """
    if not settings.gemini_api_key or not settings.gemini_model:
        raise RuntimeError("Gemini is not configured.")

    # --- 4. Model call ---
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

    # --- 5. Response normalisation ---
    # Gemini returns an array of ``parts`` objects; concatenate all text parts.
    content = "".join(
        [part.get("text", "") for part in ((data.get("candidates") or [{}])[
            0].get("content", {}).get("parts") or [])]
    )

    return GenerateResult(
        provider="gemini",
        model=settings.gemini_model,
        content=content,
        # _normalize_gemini_usage maps Gemini's candidatesTokenCount field
        # to the OpenAI-compatible completion_tokens key.
        usage=_normalize_gemini_usage(data.get("usageMetadata")),
        latency_ms=int((time.perf_counter() - started_at) * 1000),
    )


def _call_openai_embeddings(settings: Settings, inputs: list[str], timeout_ms: int) -> EmbeddingsResult:
    """Call the OpenAI embeddings API and return a normalised result.

    Uses the ``/v1/embeddings`` endpoint.  The response shape differs from
    the chat completions endpoint: ``data[*].embedding`` arrays (not
    ``choices[*].message.content``), and ``usage.prompt_tokens`` /
    ``usage.total_tokens`` (no ``completion_tokens`` for embeddings).

    Args:
        settings: Application settings.
        inputs: List of strings to embed.
        timeout_ms: Remaining timeout in milliseconds.

    Returns:
        An ``EmbeddingsResult`` with one embedding vector per input string.

    Raises:
        RuntimeError: If OpenAI embeddings are not configured or the request fails.
    """
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
    """Call the OpenRouter embeddings API and return a normalised result.

    OpenRouter's embeddings endpoint follows the OpenAI ``/v1/embeddings``
    shape (``data[*].embedding`` arrays), so the same ``_normalize_usage``
    helper applies.

    Args:
        settings: Application settings.
        inputs: List of strings to embed.
        timeout_ms: Remaining timeout in milliseconds.

    Returns:
        An ``EmbeddingsResult`` with one embedding vector per input string.

    Raises:
        RuntimeError: If OpenRouter embeddings are not configured or the request fails.
    """
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
    """Call the Gemini batchEmbedContents API and return a normalised result.

    Gemini's embedding API differs from OpenAI's in two ways:
    - Endpoint: ``batchEmbedContents`` (not ``/v1/embeddings``).
    - Request shape: each input is wrapped in a ``{"content": {"parts": [{"text": ...}]}}``
      object inside a ``"requests"`` array.
    - Response shape: ``embeddings[*].values`` (not ``data[*].embedding``).

    The usage metadata uses ``usageMetadata`` (shared with the generate API)
    rather than a top-level ``usage`` key.

    Args:
        settings: Application settings.
        inputs: List of strings to embed.
        timeout_ms: Remaining timeout in milliseconds.

    Returns:
        An ``EmbeddingsResult`` with one embedding vector per input string.

    Raises:
        RuntimeError: If Gemini embeddings are not configured or the request fails.
    """
    if not settings.gemini_api_key or not settings.gemini_embedding_model:
        raise RuntimeError("Gemini embeddings are not configured.")

    started_at = time.perf_counter()
    data = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_embedding_model}:batchEmbedContents?key={settings.gemini_api_key}",
        payload={
            # batchEmbedContents wraps each input text in a content/parts structure
            # rather than accepting a flat list of strings like the OpenAI API.
            "requests": [{"content": {"parts": [{"text": input_text}]}} for input_text in inputs]
        },
        headers={"Content-Type": "application/json"},
        timeout_ms=timeout_ms,
        label="Gemini embeddings request",
    )
    # Gemini returns "embeddings[*].values", unlike OpenAI's "data[*].embedding".
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
    """POST a JSON payload and return the parsed response dict.

    Wraps ``httpx.Client`` with ``trust_env=False`` to prevent the client from
    picking up HTTP proxy environment variables (``http_proxy``, ``HTTPS_PROXY``,
    etc.) that may be set in the deployment environment.  Picking up those
    proxies causes silent connection failures in production. See CLAUDE.md
    Lessons Learned.

    Args:
        url: Fully-qualified endpoint URL.
        payload: Request body to serialise as JSON.
        headers: HTTP headers (must include ``Content-Type: application/json``
            and any auth headers).
        timeout_ms: Request timeout in milliseconds.
        label: Human-readable label used in error messages.

    Returns:
        Parsed JSON response as a dict.

    Raises:
        RuntimeError: On ``httpx.TimeoutException``, ``httpx.HTTPError``, or
            when the response status is >= 400.
    """
    timeout_seconds = timeout_ms / 1000
    try:
        # trust_env=False: prevents httpx picking up proxy env vars in
        # production, which causes silent connection failures. See CLAUDE.md.
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
    """Parse the response body as JSON, returning ``{}`` on failure.

    Guards against responses with non-JSON bodies (e.g. plain-text error pages)
    or responses whose body is a JSON array rather than an object.

    Args:
        response: The ``httpx.Response`` to parse.

    Returns:
        The parsed dict, or ``{}`` when parsing fails or the result is not a dict.
    """
    try:
        parsed = response.json()
    except ValueError:
        return {}
    if isinstance(parsed, dict):
        return parsed
    return {}


def _extract_provider_error_message(data: dict[str, Any]) -> str | None:
    """Extract a human-readable error message from a provider error response.

    Handles two common shapes:
    - ``{"error": {"message": "..."}}`` (OpenAI / OpenRouter style).
    - ``{"error": "..."}`` (simple string error).

    Args:
        data: Parsed JSON response body.

    Returns:
        The stripped error message string, or ``None`` if none found.
    """
    error = data.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    if isinstance(error, str) and error.strip():
        return error.strip()
    return None


def _normalize_usage(raw: Any) -> AiUsage | None:
    """Normalise an OpenAI-compatible usage dict to an ``AiUsage`` object.

    OpenAI and OpenRouter both use ``prompt_tokens`` / ``completion_tokens`` /
    ``total_tokens`` field names, so this helper applies to both providers.

    Args:
        raw: The ``usage`` field from the provider response, or any non-dict value.

    Returns:
        An ``AiUsage`` instance, or ``None`` if the input is not a dict.
    """
    if not isinstance(raw, dict):
        return None
    return AiUsage(
        prompt_tokens=_to_int(raw.get("prompt_tokens")),
        completion_tokens=_to_int(raw.get("completion_tokens")),
        total_tokens=_to_int(raw.get("total_tokens")),
    )


def _normalize_gemini_usage(raw: Any) -> AiUsage | None:
    """Normalise Gemini's ``usageMetadata`` dict to an ``AiUsage`` object.

    Gemini uses different field names from OpenAI:
    - ``promptTokenCount`` → ``prompt_tokens``
    - ``candidatesTokenCount`` → ``completion_tokens`` (the tokens in the
      generated candidate(s), analogous to OpenAI's completion tokens)
    - ``totalTokenCount`` → ``total_tokens``

    Args:
        raw: The ``usageMetadata`` field from the Gemini response, or any
            non-dict value.

    Returns:
        An ``AiUsage`` instance, or ``None`` if the input is not a dict.
    """
    if not isinstance(raw, dict):
        return None
    return AiUsage(
        prompt_tokens=_to_int(raw.get("promptTokenCount")),
        # candidatesTokenCount = tokens in generated output; maps to completion_tokens
        completion_tokens=_to_int(raw.get("candidatesTokenCount")),
        total_tokens=_to_int(raw.get("totalTokenCount")),
    )


def _to_int(value: Any) -> int | None:
    """Coerce a numeric value to ``int``, returning ``None`` for non-numerics.

    Handles the case where a provider returns token counts as floats (e.g.
    ``1024.0`` instead of ``1024``).

    Args:
        value: Any value; only ``int`` and ``float`` are converted.

    Returns:
        An integer, or ``None`` for non-numeric inputs.
    """
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def _normalize_chat_content(content: Any) -> str:
    """Normalise the ``content`` field from a chat completion message to a string.

    Input formats handled:
    - ``str``: returned directly.
    - ``dict``: expected to have a ``"text"`` key (some provider variants wrap
      the text in a single-key object).
    - ``list``: the multi-modal / tool-use content-block format where each item
      is either a bare string or a dict with a ``"text"`` key.  All text chunks
      are concatenated in order.  Non-text block types (e.g. ``"image_url"``)
      are silently skipped.
    - Anything else: returns ``""``.

    Output: a single stripped string ready for downstream JSON parsing.

    Args:
        content: The raw ``content`` value from the provider response message.

    Returns:
        A concatenated, stripped string.
    """
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
