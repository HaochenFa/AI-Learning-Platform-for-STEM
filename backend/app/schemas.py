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


class MaterialProcessRequest(BaseModel):
    batch_size: int | None = Field(default=None, ge=1, le=25)


class MaterialProcessResult(BaseModel):
    triggered: bool
    processed: int
    succeeded: int
    failed: int
    retried: int
    errors: list[str] = Field(default_factory=list)


class ClassCreateRequest(BaseModel):
    user_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    subject: str | None = None
    level: str | None = None
    description: str | None = None
    join_code: str = Field(min_length=1)


class ClassCreateResult(BaseModel):
    class_id: str = Field(min_length=1)


class ClassJoinRequest(BaseModel):
    user_id: str = Field(min_length=1)
    join_code: str = Field(min_length=1)


class ClassJoinResult(BaseModel):
    class_id: str = Field(min_length=1)


class ChatWorkspaceParticipantsRequest(BaseModel):
    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)


class ChatWorkspaceSessionsListRequest(BaseModel):
    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    owner_user_id: str | None = None


class ChatWorkspaceSessionCreateRequest(BaseModel):
    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    title: str | None = None


class ChatWorkspaceSessionRenameRequest(BaseModel):
    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    title: str = Field(min_length=1)


class ChatWorkspaceSessionArchiveRequest(BaseModel):
    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)


class ChatWorkspaceMessagesListRequest(BaseModel):
    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    owner_user_id: str | None = None
    before_cursor: str | None = None
    limit: int | None = Field(default=None, ge=1, le=200)


class ChatWorkspaceMessageSendRequest(BaseModel):
    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    timeout_ms: int | None = None
    max_tokens: int | None = Field(default=None, ge=1, le=16000)
    tool_mode: Literal["off", "plan", "auto"] = "off"
    tool_catalog: list[str] | None = None
    orchestration_hints: dict[str, Any] | None = None


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


class FlashcardsGenerateRequest(BaseModel):
    class_title: str = Field(min_length=1)
    card_count: int = Field(ge=1, le=30)
    instructions: str = Field(min_length=1)
    blueprint_context: str
    material_context: str
    timeout_ms: int | None = None


class FlashcardsGeneratedCard(BaseModel):
    front: str
    back: str


class FlashcardsGenerateResult(BaseModel):
    payload: dict[str, Any]
    provider: AiProvider
    model: str
    usage: AiUsage | None = None
    latency_ms: int


class ChatTranscriptTurn(BaseModel):
    role: Literal["student", "assistant"]
    message: str
    created_at: str


class ChatGenerateRequest(BaseModel):
    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    class_title: str = Field(min_length=1)
    user_message: str = Field(min_length=1)
    transcript: list[ChatTranscriptTurn] = Field(default_factory=list)
    blueprint_context: str
    material_context: str
    compacted_memory_context: str | None = None
    assignment_instructions: str | None = None
    purpose: str | None = None
    session_id: str | None = None
    timeout_ms: int | None = None
    max_tokens: int | None = Field(default=None, ge=1, le=16000)
    tool_mode: Literal["off", "plan", "auto"] = "off"
    tool_catalog: list[str] | None = None
    orchestration_hints: dict[str, Any] | None = None


class ChatGenerateResult(BaseModel):
    payload: dict[str, Any]
    provider: AiProvider
    model: str
    usage: AiUsage | None = None
    latency_ms: int
    orchestration: dict[str, Any]


class ApiError(BaseModel):
    message: str
    code: str | None = None


class ApiEnvelope(BaseModel):
    ok: bool
    data: Any | None = None
    error: ApiError | None = None
    meta: dict[str, Any] | None = None
