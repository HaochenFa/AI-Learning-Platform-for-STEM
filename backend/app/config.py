from __future__ import annotations

import os
from dataclasses import dataclass


def _get_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _get_int(name: str, fallback: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return fallback
    try:
        value = int(raw)
    except ValueError:
        return fallback
    return value if value > 0 else fallback


@dataclass(frozen=True)
class Settings:
    python_backend_api_key: str | None
    python_backend_allow_unauthenticated_requests: bool
    ai_provider_default: str
    ai_request_timeout_ms: int
    ai_embedding_timeout_ms: int
    openrouter_api_key: str | None
    openrouter_model: str | None
    openrouter_embedding_model: str | None
    openrouter_base_url: str
    openrouter_site_url: str | None
    openrouter_app_name: str | None
    openai_api_key: str | None
    openai_model: str | None
    openai_embedding_model: str | None
    gemini_api_key: str | None
    gemini_model: str | None
    gemini_embedding_model: str | None
    log_provider_failures: bool
    supabase_url: str | None
    supabase_publishable_key: str | None
    supabase_service_role_key: str | None
    material_worker_token: str | None
    material_worker_batch: int
    material_worker_function_url: str | None


def get_settings() -> Settings:
    return Settings(
        python_backend_api_key=os.getenv("PYTHON_BACKEND_API_KEY"),
        python_backend_allow_unauthenticated_requests=_get_bool(
            "PYTHON_BACKEND_ALLOW_UNAUTHENTICATED_REQUESTS",
            False,
        ),
        ai_provider_default=os.getenv(
            "AI_PROVIDER_DEFAULT", "openrouter").strip().lower(),
        ai_request_timeout_ms=_get_int("AI_REQUEST_TIMEOUT_MS", 30000),
        ai_embedding_timeout_ms=_get_int("AI_EMBEDDING_TIMEOUT_MS", 30000),
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY"),
        openrouter_model=os.getenv("OPENROUTER_MODEL"),
        openrouter_embedding_model=os.getenv("OPENROUTER_EMBEDDING_MODEL"),
        openrouter_base_url=os.getenv(
            "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        openrouter_site_url=os.getenv("OPENROUTER_SITE_URL"),
        openrouter_app_name=os.getenv("OPENROUTER_APP_NAME"),
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        openai_model=os.getenv("OPENAI_MODEL"),
        openai_embedding_model=os.getenv("OPENAI_EMBEDDING_MODEL"),
        gemini_api_key=os.getenv("GEMINI_API_KEY"),
        gemini_model=os.getenv("GEMINI_MODEL"),
        gemini_embedding_model=os.getenv("GEMINI_EMBEDDING_MODEL"),
        log_provider_failures=_get_bool(
            "PYTHON_BACKEND_LOG_PROVIDER_FAILURES", True),
        supabase_url=os.getenv("SUPABASE_URL") or os.getenv(
            "NEXT_PUBLIC_SUPABASE_URL"),
        supabase_publishable_key=os.getenv(
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SECRET_KEY"),
        material_worker_token=os.getenv("MATERIAL_WORKER_TOKEN"),
        material_worker_batch=_get_int("MATERIAL_WORKER_BATCH", 3),
        material_worker_function_url=os.getenv("MATERIAL_WORKER_FUNCTION_URL"),
    )
