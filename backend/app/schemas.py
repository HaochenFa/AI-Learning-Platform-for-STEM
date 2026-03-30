from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

AiProvider = Literal["openrouter", "openai", "gemini"]


class AiUsage(BaseModel):
    """Token consumption reported by the AI provider for a single generation call."""

    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


class GenerateRequest(BaseModel):
    """Low-level request to the /generate endpoint; used by all feature modules."""

    system: str = Field(min_length=1)
    user: str = Field(min_length=1)
    temperature: float | None = None
    max_tokens: int | None = None
    timeout_ms: int | None = None
    session_id: str | None = None  # opaque token forwarded to the provider for tracing
    transforms: list[str] | None = None  # optional post-processing transforms (e.g. strip-markdown)
    provider_order: list[AiProvider] | None = None  # override fallback priority for this call
    default_provider: AiProvider | None = None  # first provider to attempt before fallback list


class GenerateResult(BaseModel):
    """Response envelope from the /generate endpoint, wrapping the raw model output."""

    provider: AiProvider
    model: str
    content: str
    usage: AiUsage | None = None
    latency_ms: int


class EmbeddingsRequest(BaseModel):
    """Request to the /embeddings endpoint; used for semantic search over class materials."""

    inputs: list[str]
    sandbox_id: str | None = None  # restricts retrieval to a guest sandbox when set
    timeout_ms: int | None = None
    provider_order: list[AiProvider] | None = None
    default_provider: AiProvider | None = None


class EmbeddingsResult(BaseModel):
    """Response from the /embeddings endpoint; one vector per input string."""

    provider: AiProvider
    model: str
    embeddings: list[list[float]]  # parallel to inputs; each inner list is a dense vector
    usage: AiUsage | None = None
    latency_ms: int


class MaterialDispatchRequest(BaseModel):
    """Request to enqueue a material for background AI processing; used by POST /materials/dispatch."""

    class_id: str = Field(min_length=1)
    material_id: str = Field(min_length=1)
    trigger_worker: bool = True  # if True, immediately wake the Edge Function worker after enqueue


class MaterialDispatchResult(BaseModel):
    """Outcome of a material dispatch; used by POST /materials/dispatch."""

    enqueued: bool   # True when the pgmq message was successfully inserted
    triggered: bool  # True when the Edge Function worker was invoked after enqueue


class MaterialProcessRequest(BaseModel):
    """Request to process a batch of queued materials; used by POST /materials/process."""

    batch_size: int | None = Field(default=None, ge=1, le=25)  # max 25 to stay within Edge Function time limit


class MaterialProcessResult(BaseModel):
    """Outcome summary after a processing run; used by POST /materials/process."""

    triggered: bool
    processed: int  # total messages dequeued and attempted
    succeeded: int
    failed: int
    retried: int    # messages requeued for a later attempt after transient error
    errors: list[str] = Field(default_factory=list)


class ClassCreateRequest(BaseModel):
    """Request body for teacher-initiated class creation; used by POST /classes."""

    user_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    subject: str | None = None
    level: str | None = None
    description: str | None = None
    join_code: str = Field(min_length=1)  # short alphanumeric code students use to enroll


class ClassCreateResult(BaseModel):
    """Result of a successful class creation; used by POST /classes."""

    class_id: str = Field(min_length=1)


class ClassJoinRequest(BaseModel):
    """Request body for a student joining a class via join code; used by POST /classes/join."""

    user_id: str = Field(min_length=1)
    join_code: str = Field(min_length=1)


class ClassJoinResult(BaseModel):
    """Result of a successful class join; used by POST /classes/join."""

    class_id: str = Field(min_length=1)


class ChatWorkspaceParticipantsRequest(BaseModel):
    """Request to list participants in a chat workspace; used by POST /chat-workspace/participants."""

    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    sandbox_id: str | None = None  # guest sandbox isolation token


class ChatWorkspaceSessionsListRequest(BaseModel):
    """Request to list chat sessions for a user; used by POST /chat-workspace/sessions/list."""

    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    sandbox_id: str | None = None
    owner_user_id: str | None = None  # teachers can view sessions belonging to another user


class ChatWorkspaceSessionCreateRequest(BaseModel):
    """Request to create a new chat session; used by POST /chat-workspace/sessions/create."""

    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    sandbox_id: str | None = None
    title: str | None = None  # auto-generated from first message if omitted


class ChatWorkspaceSessionRenameRequest(BaseModel):
    """Request to rename an existing chat session; used by POST /chat-workspace/sessions/rename."""

    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    sandbox_id: str | None = None
    session_id: str = Field(min_length=1)
    title: str = Field(min_length=1)


class ChatWorkspaceSessionArchiveRequest(BaseModel):
    """Request to archive (soft-delete) a chat session; used by POST /chat-workspace/sessions/archive."""

    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    sandbox_id: str | None = None
    session_id: str = Field(min_length=1)


class ChatWorkspaceMessagesListRequest(BaseModel):
    """Request to page through messages in a session; used by POST /chat-workspace/messages/list."""

    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    sandbox_id: str | None = None
    session_id: str = Field(min_length=1)
    owner_user_id: str | None = None  # teachers can read another user's session history
    before_cursor: str | None = None  # opaque cursor (UUID + ISO-8601) for keyset pagination
    limit: int | None = Field(default=None, ge=1, le=200)  # max 200 to keep response payloads manageable


class ChatWorkspaceMessageSendRequest(BaseModel):
    """Request to send a user message and receive an AI reply; used by POST /chat-workspace/messages/send."""

    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    sandbox_id: str | None = None
    timeout_ms: int | None = None
    max_tokens: int | None = Field(default=None, ge=1, le=16000)
    tool_mode: Literal["off", "plan", "auto"] = "off"  # controls agentic tool-use behaviour
    tool_catalog: list[str] | None = None  # explicit allowlist of tool names when tool_mode != "off"
    orchestration_hints: dict[str, Any] | None = None  # provider-specific pass-through metadata


class BlueprintGenerateRequest(BaseModel):
    """Request to generate a Course Blueprint from ingested materials; used by POST /blueprints/generate."""

    class_title: str = Field(min_length=1)
    subject: str | None = None
    level: str | None = None
    material_count: int = Field(ge=1)  # number of source materials being synthesised
    material_text: str = Field(min_length=1)  # concatenated extracted text of all materials
    sandbox_id: str | None = None
    timeout_ms: int | None = None


class BlueprintGenerateResult(BaseModel):
    """AI-generated blueprint payload plus provider metadata; used by POST /blueprints/generate."""

    payload: dict[str, Any]  # structured blueprint object (topics, objectives, etc.)
    provider: AiProvider
    model: str
    usage: AiUsage | None = None
    latency_ms: int


class QuizGenerateRequest(BaseModel):
    """Request to generate a multiple-choice quiz grounded in the class blueprint; used by POST /quiz/generate."""

    class_title: str = Field(min_length=1)
    question_count: int = Field(ge=1, le=20)  # hard cap of 20 to keep generation latency acceptable
    instructions: str = Field(min_length=1)   # teacher-authored guidance injected into the prompt
    blueprint_context: str  # serialised published blueprint used to scope question topics
    material_context: str   # retrieved material snippets for grounding explanations
    sandbox_id: str | None = None
    timeout_ms: int | None = None


class QuizGeneratedQuestion(BaseModel):
    """A single validated MCQ item; mirrors the JSON shape returned by the AI and persisted to DB."""

    question: str
    choices: list[str]  # always exactly 4 options
    answer: str         # must exactly match one element of choices
    explanation: str    # justifies the correct answer using class context


class QuizGenerateResult(BaseModel):
    """AI-generated quiz payload plus provider metadata; used by POST /quiz/generate."""

    payload: dict[str, Any]  # contains a "questions" list of QuizGeneratedQuestion-shaped dicts
    provider: AiProvider
    model: str
    usage: AiUsage | None = None
    latency_ms: int


class FlashcardsGenerateRequest(BaseModel):
    """Request to generate flashcards grounded in the class blueprint; used by POST /flashcards/generate."""

    class_title: str = Field(min_length=1)
    card_count: int = Field(ge=1, le=30)  # hard cap of 30; larger sets degrade quality
    instructions: str = Field(min_length=1)
    blueprint_context: str  # serialised published blueprint drives topic coverage
    material_context: str   # retrieved snippets anchor card backs to class content
    sandbox_id: str | None = None
    timeout_ms: int | None = None


class FlashcardsGeneratedCard(BaseModel):
    """A single validated flashcard; front is prompt-like, back is a grounded explanation."""

    front: str  # short question or term — intended to be shown alone
    back: str   # answer/explanation — must be at least 3 words


class FlashcardsGenerateResult(BaseModel):
    """AI-generated flashcard payload plus provider metadata; used by POST /flashcards/generate."""

    payload: dict[str, Any]  # contains a "cards" list of FlashcardsGeneratedCard-shaped dicts
    provider: AiProvider
    model: str
    usage: AiUsage | None = None
    latency_ms: int


class ChatTranscriptTurn(BaseModel):
    """A single turn in the conversation history sent to the AI for context."""

    role: Literal["student", "assistant"]
    message: str
    created_at: str  # ISO-8601 timestamp; used by the AI for temporal context in long sessions


class ChatGenerateRequest(BaseModel):
    """Request to generate an AI chat reply within a long-running session; used by POST /chat/generate."""

    class_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    class_title: str = Field(min_length=1)
    user_message: str = Field(min_length=1)
    transcript: list[ChatTranscriptTurn] = Field(default_factory=list)  # recent history for context window
    blueprint_context: str   # published blueprint limits the AI to approved topics
    material_context: str    # retrieved material snippets ground the response
    sandbox_id: str | None = None
    compacted_memory_context: str | None = None  # summarised older history when transcript is truncated
    assignment_instructions: str | None = None   # teacher-set constraints for homework/exam mode
    purpose: str | None = None   # activity type hint (e.g. "homework_help", "exam_review")
    session_id: str | None = None
    timeout_ms: int | None = None
    max_tokens: int | None = Field(default=None, ge=1, le=16000)
    tool_mode: Literal["off", "plan", "auto"] = "off"
    tool_catalog: list[str] | None = None
    orchestration_hints: dict[str, Any] | None = None


class ChatGenerateResult(BaseModel):
    """AI chat reply plus orchestration metadata; used by POST /chat/generate."""

    payload: dict[str, Any]        # contains the assistant reply text and any tool calls
    provider: AiProvider
    model: str
    usage: AiUsage | None = None
    latency_ms: int
    orchestration: dict[str, Any]  # tool-use decisions, plan steps, or other agentic state


class ApiError(BaseModel):
    """Structured error detail included in ApiEnvelope when ok=False."""

    message: str
    code: str | None = None  # machine-readable error code for client-side handling


class ApiEnvelope(BaseModel):
    """Standard response wrapper for all backend API responses; shape: {ok, data, error, meta}."""

    ok: bool
    data: Any | None = None
    error: ApiError | None = None
    meta: dict[str, Any] | None = None  # optional latency, pagination, or debug metadata


class CanvasHint(BaseModel):
    """Hint from the AI answer that instructs the canvas renderer what visualisation to draw."""

    type: Literal["chart", "diagram", "wave", "vector"]
    concept: str = Field(max_length=200)
    title: str = Field(max_length=200)


class CanvasRequest(BaseModel):
    """Request to generate a canvas visualisation spec for the current chat round; used by POST /canvas."""

    class_id: str = Field(min_length=1)
    canvas_hint: CanvasHint
    student_question: str = Field(max_length=500)   # current round only — no history for speed
    ai_answer: str = Field(max_length=2000)          # current round only


class CanvasResponse(BaseModel):
    """Canvas visualisation specification returned to the front-end renderer."""

    spec: dict  # validated against CanvasSpec union


class DataQueryRequest(BaseModel):
    """Request to run a natural-language analytics query over class data; used by POST /data/query."""

    user_id: str
    class_id: str
    sandbox_id: str | None = None
    query: str = Field(min_length=1, max_length=500)
