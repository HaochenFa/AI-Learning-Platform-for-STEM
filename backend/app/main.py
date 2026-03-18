from __future__ import annotations

from typing import Any, TypeVar, cast
from uuid import uuid4

import httpx
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.analytics import analytics_router
from app.blueprints import generate_blueprint
from app.canvas import generate_canvas_spec
from app.chat import generate_chat
from app.chat_workspace import (
    ChatWorkspaceError,
    archive_session,
    create_session,
    list_messages,
    list_participants,
    list_sessions,
    rename_session,
    send_message,
)
from app.classes import ClassDomainError, create_class, join_class
from app.config import Settings, get_settings
from app.flashcards import generate_flashcards
from app.materials import dispatch_material_job, process_material_jobs
from app.providers import generate_embeddings_with_fallback, generate_with_fallback
from app.quiz import generate_quiz
from app.schemas import (
    ApiEnvelope,
    ApiError,
    BlueprintGenerateRequest,
    ClassCreateRequest,
    ClassJoinRequest,
    ChatWorkspaceMessageSendRequest,
    ChatWorkspaceMessagesListRequest,
    ChatWorkspaceParticipantsRequest,
    ChatWorkspaceSessionArchiveRequest,
    ChatWorkspaceSessionCreateRequest,
    ChatWorkspaceSessionRenameRequest,
    ChatWorkspaceSessionsListRequest,
    ChatGenerateRequest,
    CanvasRequest,
    EmbeddingsRequest,
    FlashcardsGenerateRequest,
    GenerateRequest,
    MaterialDispatchRequest,
    MaterialProcessRequest,
    QuizGenerateRequest,
)

app = FastAPI(title="STEM Learning Python Backend", version="0.1.0")
app.include_router(analytics_router)
USER_TOKEN_VERIFY_TIMEOUT_SECONDS = 8.0
UserBoundPayload = TypeVar("UserBoundPayload", bound=BaseModel)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    return JSONResponse(
        status_code=500,
        content=ApiEnvelope(
            ok=False,
            error=ApiError(message="An unexpected error occurred.", code="internal_error"),
            meta={"request_id": request_id},
        ).model_dump(),
    )


def _error_response(request: Request, *, status_code: int, message: str, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ApiEnvelope(
            ok=False,
            error=ApiError(message=message, code=code),
            meta={"request_id": request.state.request_id},
        ).model_dump(),
    )


def _auth_error_response(request: Request, settings: Settings) -> JSONResponse | None:
    expected_api_key = settings.python_backend_api_key
    if not expected_api_key:
        if settings.python_backend_allow_unauthenticated_requests:
            return None
        return _error_response(
            request,
            status_code=503,
            message="Python backend authentication is misconfigured.",
            code="backend_auth_misconfigured",
        )

    header_key = request.headers.get("x-api-key")
    bearer = _parse_bearer_token(request.headers.get("authorization"))
    if header_key == expected_api_key or bearer == expected_api_key:
        return None

    return _error_response(
        request,
        status_code=401,
        message="Unauthorized",
        code="unauthorized",
    )


async def _authorize_request(
    request: Request,
    *,
    require_actor_user: bool = False,
) -> tuple[Settings, str | None, JSONResponse | None]:
    settings = get_settings()
    unauthorized = _auth_error_response(request, settings)
    if unauthorized:
        return settings, None, unauthorized
    if not require_actor_user:
        return settings, None, None

    user_id, user_error = await _resolve_actor_user_id(request, settings)
    if user_error:
        return settings, None, user_error
    return settings, user_id, None


async def _resolve_actor_user_id(
    request: Request,
    settings: Settings,
) -> tuple[str | None, JSONResponse | None]:
    token = _parse_bearer_token(request.headers.get("authorization"))
    if not token or token == settings.python_backend_api_key:
        return None, _error_response(
            request,
            status_code=401,
            message="A valid user bearer token is required.",
            code="user_token_required",
        )

    supabase_url = settings.supabase_url
    auth_api_key = settings.supabase_publishable_key or settings.supabase_service_role_key
    if not supabase_url or not auth_api_key:
        return None, _error_response(
            request,
            status_code=503,
            message="Python backend user authentication is misconfigured.",
            code="backend_user_auth_misconfigured",
        )

    try:
        async with httpx.AsyncClient(timeout=USER_TOKEN_VERIFY_TIMEOUT_SECONDS, trust_env=False) as client:
            response = await client.get(
                f"{supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": auth_api_key,
                },
            )
    except httpx.TimeoutException:
        return None, _error_response(
            request,
            status_code=504,
            message="Timed out while validating user token.",
            code="user_auth_timeout",
        )
    except httpx.HTTPError:
        return None, _error_response(
            request,
            status_code=502,
            message="Failed to validate user token.",
            code="user_auth_unavailable",
        )

    if response.status_code >= 400:
        return None, _error_response(
            request,
            status_code=401,
            message="Invalid user token.",
            code="invalid_user_token",
        )

    payload = _safe_json_dict(response)
    user_id = payload.get("id")
    if not isinstance(user_id, str) or not user_id.strip():
        return None, _error_response(
            request,
            status_code=401,
            message="Invalid user token.",
            code="invalid_user_token",
        )
    return user_id.strip(), None


def _safe_json_dict(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    if isinstance(payload, dict):
        return payload
    return {}


def _bind_actor_user_id(
    request: Request,
    payload: UserBoundPayload,
    actor_user_id: str,
) -> tuple[UserBoundPayload | None, JSONResponse | None]:
    payload_user_id = getattr(payload, "user_id", None)
    if isinstance(payload_user_id, str) and payload_user_id.strip() and payload_user_id != actor_user_id:
        return None, _error_response(
            request,
            status_code=403,
            message="Payload user_id does not match authenticated user.",
            code="user_id_mismatch",
        )
    return cast(UserBoundPayload, payload.model_copy(update={"user_id": actor_user_id})), None


@app.get("/healthz")
async def healthz(request: Request):
    return ApiEnvelope(
        ok=True,
        data={"status": "ok"},
        meta={"request_id": request.state.request_id},
    ).model_dump()


@app.post("/v1/llm/generate")
async def generate(request: Request, payload: GenerateRequest):
    settings, _, unauthorized = await _authorize_request(request)
    if unauthorized:
        return unauthorized

    try:
        result = await run_in_threadpool(generate_with_fallback, settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="provider_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/llm/embeddings")
async def embeddings(request: Request, payload: EmbeddingsRequest):
    settings, _, unauthorized = await _authorize_request(request)
    if unauthorized:
        return unauthorized

    try:
        result = await run_in_threadpool(generate_embeddings_with_fallback, settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="provider_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/materials/dispatch")
async def dispatch_materials(request: Request, payload: MaterialDispatchRequest):
    settings, _, unauthorized = await _authorize_request(request)
    if unauthorized:
        return unauthorized

    try:
        result = await run_in_threadpool(dispatch_material_job, settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="dispatch_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/materials/process")
async def process_materials(request: Request, payload: MaterialProcessRequest):
    settings, _, unauthorized = await _authorize_request(request)
    if unauthorized:
        return unauthorized

    try:
        result = await run_in_threadpool(process_material_jobs, settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error),
                               code="material_process_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/classes/create")
async def create_class_route(request: Request, payload: ClassCreateRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(create_class, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ClassDomainError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="class_create_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/classes/join")
async def join_class_route(request: Request, payload: ClassJoinRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(join_class, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ClassDomainError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="class_join_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/blueprints/generate")
async def generate_blueprints(request: Request, payload: BlueprintGenerateRequest):
    settings, _, unauthorized = await _authorize_request(request)
    if unauthorized:
        return unauthorized

    try:
        result = await run_in_threadpool(generate_blueprint, settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="blueprint_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/quiz/generate")
async def generate_quizzes(request: Request, payload: QuizGenerateRequest):
    settings, _, unauthorized = await _authorize_request(request)
    if unauthorized:
        return unauthorized

    try:
        result = await run_in_threadpool(generate_quiz, settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="quiz_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/flashcards/generate")
async def generate_flashcards_route(request: Request, payload: FlashcardsGenerateRequest):
    settings, _, unauthorized = await _authorize_request(request)
    if unauthorized:
        return unauthorized

    try:
        result = await run_in_threadpool(generate_flashcards, settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="flashcards_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/generate")
async def generate_chat_route(request: Request, payload: ChatGenerateRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(generate_chat, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="chat_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/canvas")
async def generate_canvas_route(request: Request, payload: CanvasRequest):
    # API-key-only auth (no user JWT): canvas is called from server actions
    # that are already user-authenticated. The route is stateless and does
    # not store or attribute any data to a user.
    settings, _, unauthorized = await _authorize_request(request)
    if unauthorized:
        return unauthorized

    try:
        spec = await run_in_threadpool(generate_canvas_spec, settings, payload)
        return ApiEnvelope(
            ok=True,
            data={"spec": spec},
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="canvas_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/participants")
async def list_chat_workspace_participants_route(request: Request, payload: ChatWorkspaceParticipantsRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(list_participants, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error),
                               code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/sessions/list")
async def list_chat_workspace_sessions_route(request: Request, payload: ChatWorkspaceSessionsListRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(list_sessions, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error),
                               code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/sessions/create")
async def create_chat_workspace_session_route(request: Request, payload: ChatWorkspaceSessionCreateRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(create_session, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error),
                               code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/sessions/rename")
async def rename_chat_workspace_session_route(request: Request, payload: ChatWorkspaceSessionRenameRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(rename_session, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error),
                               code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/sessions/archive")
async def archive_chat_workspace_session_route(request: Request, payload: ChatWorkspaceSessionArchiveRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(archive_session, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error),
                               code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/messages/list")
async def list_chat_workspace_messages_route(request: Request, payload: ChatWorkspaceMessagesListRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(list_messages, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error),
                               code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/messages/send")
async def send_chat_workspace_message_route(request: Request, payload: ChatWorkspaceMessageSendRequest):
    settings, actor_user_id, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    bound_payload, payload_error = _bind_actor_user_id(
        request, payload, actor_user_id or "")
    if payload_error:
        return payload_error
    assert bound_payload is not None

    try:
        result = await run_in_threadpool(send_message, settings, bound_payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error),
                               code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


def _parse_bearer_token(header: str | None) -> str | None:
    if not header:
        return None
    prefix = "bearer "
    if not header.lower().startswith(prefix):
        return None
    return header[len(prefix):].strip() or None
