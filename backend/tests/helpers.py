from __future__ import annotations

from dataclasses import replace
from typing import Any

from app.config import Settings


def make_settings(**overrides: Any) -> Settings:
    base = Settings(
        python_backend_api_key="test-key",
        python_backend_allow_unauthenticated_requests=False,
        ai_provider_default="openrouter",
        ai_request_timeout_ms=30000,
        ai_embedding_timeout_ms=30000,
        openrouter_api_key="or-key",
        openrouter_model="or-model",
        openrouter_embedding_model="or-embed",
        openrouter_base_url="https://openrouter.ai/api/v1",
        openrouter_site_url=None,
        openrouter_app_name=None,
        openai_api_key=None,
        openai_model=None,
        openai_embedding_model=None,
        gemini_api_key=None,
        gemini_model=None,
        gemini_embedding_model=None,
        log_provider_failures=True,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="publishable-key",
        supabase_service_role_key="service-role",
        material_worker_token=None,
        material_worker_batch=3,
        material_worker_function_url=None,
    )
    return replace(base, **overrides)
