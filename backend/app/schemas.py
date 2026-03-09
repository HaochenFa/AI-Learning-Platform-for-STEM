from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

AiProvider = Literal["openrouter", "openai", "gemini"]


class AiUsage(BaseModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


class GenerateRequest(BaseModel):
    system: str = Field(min_length=1)
    user: str = Field(min_length=1)
    temperature: float | None = None
    max_tokens: int | None = None
    timeout_ms: int | None = None
    session_id: str | None = None
    transforms: list[str] | None = None
    provider_order: list[AiProvider] | None = None
    default_provider: AiProvider | None = None


class GenerateResult(BaseModel):
    provider: AiProvider
    model: str
    content: str
    usage: AiUsage | None = None
    latency_ms: int


class EmbeddingsRequest(BaseModel):
    inputs: list[str]
    timeout_ms: int | None = None
    provider_order: list[AiProvider] | None = None
    default_provider: AiProvider | None = None


class EmbeddingsResult(BaseModel):
    provider: AiProvider
    model: str
    embeddings: list[list[float]]
    usage: AiUsage | None = None
    latency_ms: int


class MaterialDispatchRequest(BaseModel):
    class_id: str = Field(min_length=1)
    material_id: str = Field(min_length=1)
    trigger_worker: bool = True


class MaterialDispatchResult(BaseModel):
    enqueued: bool
    triggered: bool


class BlueprintGenerateRequest(BaseModel):
    class_title: str = Field(min_length=1)
    subject: str | None = None
    level: str | None = None
    material_count: int = Field(ge=1)
    material_text: str = Field(min_length=1)
    timeout_ms: int | None = None


class BlueprintGenerateResult(BaseModel):
    payload: dict[str, Any]
    provider: AiProvider
    model: str
    usage: AiUsage | None = None
    latency_ms: int


class QuizGenerateRequest(BaseModel):
    class_title: str = Field(min_length=1)
    question_count: int = Field(ge=1, le=20)
    instructions: str = Field(min_length=1)
    blueprint_context: str
    material_context: str
    timeout_ms: int | None = None


class QuizGeneratedQuestion(BaseModel):
    question: str
    choices: list[str]
    answer: str
    explanation: str


class QuizGenerateResult(BaseModel):
    payload: dict[str, Any]
    provider: AiProvider
    model: str
    usage: AiUsage | None = None
    latency_ms: int


class ApiError(BaseModel):
    message: str
    code: str | None = None


class ApiEnvelope(BaseModel):
    ok: bool
    data: Any | None = None
    error: ApiError | None = None
    meta: dict[str, Any] | None = None
