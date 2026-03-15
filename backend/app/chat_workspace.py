from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from urllib.parse import quote
from uuid import uuid4

import httpx

from app.chat import generate_chat
from app.config import Settings
from app.providers import generate_embeddings_with_fallback
from app.schemas import (
    ChatGenerateRequest,
    ChatTranscriptTurn,
    ChatWorkspaceMessageSendRequest,
    ChatWorkspaceMessagesListRequest,
    ChatWorkspaceParticipantsRequest,
    ChatWorkspaceSessionArchiveRequest,
    ChatWorkspaceSessionCreateRequest,
    ChatWorkspaceSessionRenameRequest,
    ChatWorkspaceSessionsListRequest,
    EmbeddingsRequest,
)


CHAT_HISTORY_PAGE_SIZE = 120
CHAT_CONTEXT_RECENT_TURNS = 12
CHAT_CONTEXT_FETCH_LIMIT = 180
CHAT_COMPACTION_TRIGGER_TURNS = 30
CHAT_COMPACTION_MIN_NEW_TURNS = 6
CHAT_CONTEXT_WINDOW_TOKENS = 12000
CHAT_OUTPUT_TOKEN_RESERVE = 1400
CHAT_COMPACTION_CONTEXT_PRESSURE = 0.8
MAX_KEY_TERMS = 12
MAX_LIST_ITEMS = 8
MAX_HIGHLIGHTS = 8
DEFAULT_RAG_CONTEXT_TOKENS = 24000
DEFAULT_RAG_MATCH_COUNT = 24
DEFAULT_RAG_MAX_PER_MATERIAL = 6
BLUEPRINT_SOURCE_LABEL = "Blueprint Context"
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_ISO_TS_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$",
)
STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "how",
    "i",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "their",
    "this",
    "to",
    "was",
    "we",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "you",
    "your",
}


@dataclass
class ChatWorkspaceError(RuntimeError):
    message: str
    code: str
    status_code: int = 400

    def __str__(self) -> str:
        return self.message


def list_participants(settings: Settings, request: ChatWorkspaceParticipantsRequest) -> dict[str, Any]:
    _require_supabase_credentials(settings)
    with _client(settings) as client:
        access = _resolve_access(
            client, settings, request.class_id, request.user_id)
        if not access["is_member"]:
            raise ChatWorkspaceError(
                "Class access required.", "class_access_required", 403)
        if not access["is_teacher"]:
            raise ChatWorkspaceError(
                "Teacher access is required to monitor student chats.",
                "teacher_access_required",
                403,
            )

        enrollments = _query_list(
            client,
            _rest_url(settings, "enrollments"),
            params={
                "select": "user_id",
                "class_id": f"eq.{request.class_id}",
                "role": "eq.student",
                "order": "joined_at.asc",
            },
            settings=settings,
            failure_message="Failed to load class enrollments.",
        )

        user_ids: list[str] = []
        for row in enrollments:
            user_id = row.get("user_id")
            if isinstance(user_id, str):
                user_ids.append(user_id)
        if not user_ids:
            return {"participants": []}

        profile_rows = _query_list(
            client,
            _rest_url(settings, "profiles"),
            params={
                "select": "id,display_name",
                "id": f"in.({','.join(user_ids)})",
            },
            settings=settings,
            failure_message="Failed to load class participant profiles.",
        )

        profile_by_id = {
            row.get("id"): (row.get("display_name") or "").strip()
            for row in profile_rows
            if isinstance(row.get("id"), str)
        }

        participants = []
        for index, user_id in enumerate(user_ids):
            display_name = profile_by_id.get(user_id) or f"Student {index + 1}"
            participants.append(
                {
                    "user_id": user_id,
                    "display_name": display_name,
                }
            )
        return {"participants": participants}


def list_sessions(settings: Settings, request: ChatWorkspaceSessionsListRequest) -> dict[str, Any]:
    _require_supabase_credentials(settings)
    with _client(settings) as client:
        access = _resolve_access(
            client, settings, request.class_id, request.user_id)
        if not access["is_member"]:
            raise ChatWorkspaceError(
                "Class access required.", "class_access_required", 403)

        owner_user_id = _resolve_owner_user_id(
            client=client,
            settings=settings,
            class_id=request.class_id,
            current_user_id=request.user_id,
            requested_owner_user_id=request.owner_user_id,
            is_teacher=access["is_teacher"],
        )

        sessions = _query_list(
            client,
            _rest_url(settings, "class_chat_sessions"),
            params={
                "select": "id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at",
                "class_id": f"eq.{request.class_id}",
                "owner_user_id": f"eq.{owner_user_id}",
                "archived_at": "is.null",
                "order": "is_pinned.desc,last_message_at.desc",
                "limit": "100",
            },
            settings=settings,
            failure_message="Failed to list chat sessions.",
        )
        return {"sessions": sessions}


def create_session(settings: Settings, request: ChatWorkspaceSessionCreateRequest) -> dict[str, Any]:
    _require_supabase_credentials(settings)
    with _client(settings) as client:
        access = _resolve_access(
            client, settings, request.class_id, request.user_id)
        if not access["is_member"]:
            raise ChatWorkspaceError(
                "Class access required.", "class_access_required", 403)

        normalized_title = (request.title or "").strip() or "New chat"
        safe_title = normalized_title[:120]
        created = _insert_and_return_single(
            client,
            _rest_url(settings, "class_chat_sessions"),
            payload={
                "class_id": request.class_id,
                "owner_user_id": request.user_id,
                "title": safe_title,
                "last_message_at": datetime.now(UTC).isoformat(),
            },
            settings=settings,
            failure_message="Failed to create chat session.",
        )
        return {"session": created}


def rename_session(settings: Settings, request: ChatWorkspaceSessionRenameRequest) -> dict[str, Any]:
    _require_supabase_credentials(settings)
    with _client(settings) as client:
        access = _resolve_access(
            client, settings, request.class_id, request.user_id)
        if not access["is_member"]:
            raise ChatWorkspaceError(
                "Class access required.", "class_access_required", 403)

        normalized_title = request.title.strip()
        if not normalized_title:
            raise ChatWorkspaceError(
                "Session title is required.", "validation_error", 400)

        updated = _update_and_return_single(
            client,
            _rest_url(settings, "class_chat_sessions"),
            payload={"title": normalized_title[:120]},
            filters={
                "class_id": f"eq.{request.class_id}",
                "id": f"eq.{request.session_id}",
                "owner_user_id": f"eq.{request.user_id}",
                "archived_at": "is.null",
            },
            settings=settings,
            failure_message="Unable to rename chat session.",
            not_found_message="Unable to rename chat session.",
        )
        return {"session": updated}


def archive_session(settings: Settings, request: ChatWorkspaceSessionArchiveRequest) -> dict[str, Any]:
    _require_supabase_credentials(settings)
    with _client(settings) as client:
        access = _resolve_access(
            client, settings, request.class_id, request.user_id)
        if not access["is_member"]:
            raise ChatWorkspaceError(
                "Class access required.", "class_access_required", 403)

        _update_and_return_single(
            client,
            _rest_url(settings, "class_chat_sessions"),
            payload={"archived_at": datetime.now(UTC).isoformat()},
            filters={
                "class_id": f"eq.{request.class_id}",
                "id": f"eq.{request.session_id}",
                "owner_user_id": f"eq.{request.user_id}",
                "archived_at": "is.null",
            },
            settings=settings,
            failure_message="Failed to archive chat session.",
            not_found_message="Failed to archive chat session.",
        )
        return {"session_id": request.session_id}


def list_messages(settings: Settings, request: ChatWorkspaceMessagesListRequest) -> dict[str, Any]:
    _require_supabase_credentials(settings)
    with _client(settings) as client:
        access = _resolve_access(
            client, settings, request.class_id, request.user_id)
        if not access["is_member"]:
            raise ChatWorkspaceError(
                "Class access required.", "class_access_required", 403)

        owner_user_id = _resolve_owner_user_id(
            client=client,
            settings=settings,
            class_id=request.class_id,
            current_user_id=request.user_id,
            requested_owner_user_id=request.owner_user_id,
            is_teacher=access["is_teacher"],
        )

        session = _query_maybe_single(
            client,
            _rest_url(settings, "class_chat_sessions"),
            params={
                "select": "id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at",
                "class_id": f"eq.{request.class_id}",
                "id": f"eq.{request.session_id}",
                "limit": "1",
            },
            settings=settings,
            failure_message="Failed to load chat session.",
        )
        if not session:
            raise ChatWorkspaceError(
                "Chat session not found.", "session_not_found", 404)
        if session.get("owner_user_id") != owner_user_id:
            raise ChatWorkspaceError(
                "Chat session does not belong to the selected user.",
                "session_owner_mismatch",
                403,
            )

        page_size = request.limit or CHAT_HISTORY_PAGE_SIZE
        page_size = max(1, min(200, int(page_size)))
        query_limit = page_size + 1

        params: dict[str, str] = {
            "select": "id,session_id,class_id,author_user_id,author_kind,content,citations,safety,provider,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,created_at",
            "class_id": f"eq.{request.class_id}",
            "session_id": f"eq.{request.session_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(query_limit),
        }
        cursor = _decode_cursor(request.before_cursor)
        if cursor:
            params["or"] = (
                f"(created_at.lt.{cursor['created_at']},"
                f"and(created_at.eq.{cursor['created_at']},id.lt.{cursor['id']}))"
            )

        rows = _query_list(
            client,
            _rest_url(settings, "class_chat_messages"),
            params=params,
            settings=settings,
            failure_message="Failed to load chat messages.",
        )
        normalized = [row for row in rows if isinstance(row, dict)]
        normalized.sort(key=lambda item: (
            str(item.get("created_at") or ""), str(item.get("id") or "")))
        descending = list(reversed(normalized))
        page_slice = descending[:page_size]
        has_more = len(descending) > page_size
        oldest_in_page = page_slice[-1] if page_slice else None

        messages = list(reversed(page_slice))
        next_cursor = _encode_cursor(
            oldest_in_page) if has_more and oldest_in_page else None

        return {
            "session": session,
            "messages": messages,
            "page_info": {
                "has_more": has_more,
                "next_cursor": next_cursor,
            },
        }


def send_message(settings: Settings, request: ChatWorkspaceMessageSendRequest) -> dict[str, Any]:
    _require_supabase_credentials(settings)
    with _client(settings) as client:
        access = _resolve_access(
            client, settings, request.class_id, request.user_id)
        if not access["is_member"]:
            raise ChatWorkspaceError(
                "Class access required.", "class_access_required", 403)

        session = _query_maybe_single(
            client,
            _rest_url(settings, "class_chat_sessions"),
            params={
                "select": "id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at",
                "class_id": f"eq.{request.class_id}",
                "id": f"eq.{request.session_id}",
                "limit": "1",
            },
            settings=settings,
            failure_message="Failed to load chat session.",
        )
        if not session:
            raise ChatWorkspaceError(
                "Chat session not found.", "session_not_found", 404)
        if session.get("owner_user_id") != request.user_id:
            raise ChatWorkspaceError(
                "You can only send messages in your own chat sessions.",
                "send_session_owner_mismatch",
                403,
            )

        context_rows = _query_list(
            client,
            _rest_url(settings, "class_chat_messages"),
            params={
                "select": "id,session_id,class_id,author_user_id,author_kind,content,citations,safety,provider,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,created_at",
                "class_id": f"eq.{request.class_id}",
                "session_id": f"eq.{request.session_id}",
                "order": "created_at.desc,id.desc",
                "limit": str(CHAT_CONTEXT_FETCH_LIMIT),
            },
            settings=settings,
            failure_message="Failed to load chat context.",
        )
        chronological_messages = _normalize_messages_chronological(
            context_rows)
        cleaned_message = request.message.strip()
        if not cleaned_message:
            raise ChatWorkspaceError(
                "Message is invalid.", "validation_error", 400)

        compaction_row = _query_maybe_single(
            client,
            _rest_url(settings, "class_chat_session_compactions"),
            params={
                "select": "session_id,class_id,owner_user_id,summary_text,summary_json,compacted_through_created_at,compacted_through_message_id,compacted_turn_count,last_compacted_at,created_at,updated_at",
                "session_id": f"eq.{request.session_id}",
                "class_id": f"eq.{request.class_id}",
                "owner_user_id": f"eq.{request.user_id}",
                "limit": "1",
            },
            settings=settings,
            failure_message="Failed to load chat compaction summary.",
        )
        existing_compaction = _normalize_compaction_summary(compaction_row)
        compaction_decision = _build_compaction_decision(
            messages=chronological_messages,
            existing_summary=existing_compaction,
            pending_user_message=cleaned_message,
        )
        effective_compaction = existing_compaction
        context_compacted = False
        compaction_reason: str | None = None
        compacted_at: str | None = None
        if compaction_decision["should_compact"]:
            compaction_result = _build_compaction_result(
                messages=chronological_messages,
                existing_summary=existing_compaction,
                latest_user_message=cleaned_message,
            )
            if compaction_result:
                effective_compaction = compaction_result["summary"]
                context_compacted = True
                compaction_reason = str(compaction_decision["reason"])
                compacted_at = str(effective_compaction.get(
                    "generatedAt") or "") or None
                summary_payload = {
                    "session_id": request.session_id,
                    "class_id": request.class_id,
                    "owner_user_id": request.user_id,
                    "summary_text": compaction_result["summary_text"],
                    "summary_json": effective_compaction,
                    "compacted_through_created_at": effective_compaction.get("compactedThrough", {}).get(
                        "createdAt"
                    ),
                    "compacted_through_message_id": effective_compaction.get("compactedThrough", {}).get(
                        "messageId"
                    ),
                    "compacted_turn_count": effective_compaction.get("compactedThrough", {}).get(
                        "turnCount"
                    ),
                    "last_compacted_at": effective_compaction.get("generatedAt"),
                }
                try:
                    if compaction_row:
                        _update_rows(
                            client,
                            _rest_url(
                                settings, "class_chat_session_compactions"),
                            payload=summary_payload,
                            filters={
                                "session_id": f"eq.{request.session_id}",
                                "class_id": f"eq.{request.class_id}",
                                "owner_user_id": f"eq.{request.user_id}",
                            },
                            settings=settings,
                            failure_message="Failed to update class chat compaction summary.",
                        )
                    else:
                        _insert_rows(
                            client,
                            _rest_url(
                                settings, "class_chat_session_compactions"),
                            payload=[summary_payload],
                            settings=settings,
                            failure_message="Failed to insert class chat compaction summary.",
                        )
                except RuntimeError as error:
                    print(
                        "[python-backend] chat_workspace compaction persistence failed",
                        {
                            "class_id": request.class_id,
                            "session_id": request.session_id,
                            "user_id": request.user_id,
                            "error": str(error),
                        },
                    )

        transcript = _messages_to_transcript(
            chronological_messages, CHAT_CONTEXT_RECENT_TURNS)
        compacted_memory_context = _build_compaction_memory_text(
            effective_compaction)

        blueprint_context = _load_published_blueprint_context(
            client=client,
            settings=settings,
            class_id=request.class_id,
        )
        material_context = _retrieve_material_context(
            client=client,
            settings=settings,
            class_id=request.class_id,
            query=cleaned_message,
        )

        try:
            chat_result = generate_chat(
                settings,
                ChatGenerateRequest(
                    class_id=request.class_id,
                    user_id=request.user_id,
                    class_title=access.get("class_title") or "Class",
                    user_message=cleaned_message,
                    transcript=transcript,
                    blueprint_context=blueprint_context,
                    material_context=material_context,
                    compacted_memory_context=compacted_memory_context,
                    assignment_instructions=None,
                    purpose=(
                        "teacher_chat_always_on_v1"
                        if access.get("is_teacher")
                        else "student_chat_always_on_v1"
                    ),
                    session_id=f"class-chat-{request.session_id}",
                    timeout_ms=request.timeout_ms,
                    max_tokens=request.max_tokens,
                    tool_mode=request.tool_mode,
                    tool_catalog=request.tool_catalog,
                    orchestration_hints=request.orchestration_hints,
                ),
            )
        except RuntimeError as error:
            raise ChatWorkspaceError(
                "Sorry, I couldn't generate a response right now. Please try again.",
                "response_generation_failed",
                502,
            ) from error

        user_ts = datetime.now(UTC)
        assistant_ts = user_ts + timedelta(milliseconds=1)
        user_ts_iso = user_ts.isoformat()
        assistant_ts_iso = assistant_ts.isoformat()
        author_kind = "teacher" if access.get("is_teacher") else "student"
        payload = chat_result.payload if isinstance(
            chat_result.payload, dict) else {}
        answer = str(payload.get("answer") or "").strip()
        if not answer:
            raise ChatWorkspaceError(
                "Sorry, I couldn't generate a response right now. Please try again.",
                "response_generation_failed",
                502,
            )

        citations = _normalize_model_citations(payload.get("citations"))
        safety_raw = payload.get("safety")
        safety = safety_raw if safety_raw in {"ok", "refusal"} else None
        usage = chat_result.usage

        user_row = {
            "id": str(uuid4()),
            "session_id": request.session_id,
            "class_id": request.class_id,
            "author_user_id": request.user_id,
            "author_kind": author_kind,
            "content": cleaned_message,
            "citations": [],
            "safety": None,
            "provider": None,
            "model": None,
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "latency_ms": None,
            "created_at": user_ts_iso,
        }
        assistant_row = {
            "id": str(uuid4()),
            "session_id": request.session_id,
            "class_id": request.class_id,
            "author_user_id": None,
            "author_kind": "assistant",
            "content": answer,
            "citations": citations,
            "safety": safety,
            "provider": chat_result.provider,
            "model": chat_result.model,
            "prompt_tokens": usage.prompt_tokens if usage else None,
            "completion_tokens": usage.completion_tokens if usage else None,
            "total_tokens": usage.total_tokens if usage else None,
            "latency_ms": chat_result.latency_ms,
            "created_at": assistant_ts_iso,
        }

        _insert_rows(
            client,
            _rest_url(settings, "class_chat_messages"),
            payload=[user_row, assistant_row],
            settings=settings,
            failure_message="Failed to save assistant response.",
        )
        _update_rows(
            client,
            _rest_url(settings, "class_chat_sessions"),
            payload={"last_message_at": assistant_ts_iso},
            filters={
                "id": f"eq.{request.session_id}",
                "class_id": f"eq.{request.class_id}",
                "owner_user_id": f"eq.{request.user_id}",
            },
            settings=settings,
            failure_message="Failed to update chat session timestamp.",
        )

        return {
            "response": payload,
            "user_message": user_row,
            "assistant_message": assistant_row,
            "context_meta": {
                "compacted": context_compacted,
                "compacted_at": compacted_at,
                "reason": compaction_reason,
            },
        }


def _resolve_access(
    client: httpx.Client,
    settings: Settings,
    class_id: str,
    user_id: str,
) -> dict[str, Any]:
    class_row = _query_maybe_single(
        client,
        _rest_url(settings, "classes"),
        params={
            "select": "id,owner_id,title",
            "id": f"eq.{class_id}",
            "limit": "1",
        },
        settings=settings,
        failure_message="Failed to load class access context.",
    )
    if not class_row:
        return {"is_member": False, "is_teacher": False, "class_title": ""}

    if class_row.get("owner_id") == user_id:
        return {
            "is_member": True,
            "is_teacher": True,
            "class_title": class_row.get("title") or "",
        }

    enrollment = _query_maybe_single(
        client,
        _rest_url(settings, "enrollments"),
        params={
            "select": "role",
            "class_id": f"eq.{class_id}",
            "user_id": f"eq.{user_id}",
            "limit": "1",
        },
        settings=settings,
        failure_message="Failed to load class enrollment context.",
    )
    if not enrollment:
        return {"is_member": False, "is_teacher": False, "class_title": class_row.get("title") or ""}

    role = str(enrollment.get("role") or "")
    return {
        "is_member": True,
        "is_teacher": role in {"teacher", "ta"},
        "class_title": class_row.get("title") or "",
    }


def _resolve_owner_user_id(
    *,
    client: httpx.Client,
    settings: Settings,
    class_id: str,
    current_user_id: str,
    requested_owner_user_id: str | None,
    is_teacher: bool,
) -> str:
    requested = (requested_owner_user_id or "").strip()
    if not requested or requested == current_user_id:
        return current_user_id

    if not is_teacher:
        raise ChatWorkspaceError(
            "Teacher access is required to view another student's chat.",
            "teacher_access_required",
            403,
        )

    enrollment = _query_maybe_single(
        client,
        _rest_url(settings, "enrollments"),
        params={
            "select": "user_id",
            "class_id": f"eq.{class_id}",
            "user_id": f"eq.{requested}",
            "limit": "1",
        },
        settings=settings,
        failure_message="Failed to validate class owner context.",
    )
    if not enrollment:
        raise ChatWorkspaceError(
            "Selected user is not enrolled in this class.",
            "owner_user_not_enrolled",
            404,
        )
    return requested


def _normalize_messages_chronological(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = [row for row in rows if isinstance(row, dict)]
    normalized.sort(key=lambda item: (
        str(item.get("created_at") or ""),
        1 if str(item.get("author_kind") or "") == "assistant" else 0,  # 0 = human turn (student or teacher), 1 = assistant — ensures human-before-assistant on same timestamp
        str(item.get("id") or "")))
    return normalized


def _messages_to_transcript(rows: list[dict[str, Any]], max_turns: int) -> list[ChatTranscriptTurn]:
    if max_turns <= 0:
        return []

    transcript: list[ChatTranscriptTurn] = []
    for row in rows[-max_turns:]:
        author_kind = str(row.get("author_kind") or "")
        content = str(row.get("content") or "").strip()
        created_at = str(row.get("created_at") or "").strip()
        if not content:
            continue
        transcript.append(
            ChatTranscriptTurn(
                role="assistant" if author_kind == "assistant" else "student",
                message=content,
                created_at=created_at or datetime.now(UTC).isoformat(),
            )
        )
    return transcript


def _load_published_blueprint_context(
    *,
    client: httpx.Client,
    settings: Settings,
    class_id: str,
) -> str:
    blueprint = _query_maybe_single(
        client,
        _rest_url(settings, "blueprints"),
        params={
            "select": "id,summary,content_json",
            "class_id": f"eq.{class_id}",
            "status": "eq.published",
            "order": "version.desc",
            "limit": "1",
        },
        settings=settings,
        failure_message="Failed to load published blueprint context.",
    )
    if not blueprint:
        raise RuntimeError(
            "A published blueprint is required before using AI chat.")

    canonical = _parse_canonical_blueprint(blueprint.get("content_json"))
    if canonical:
        return _build_canonical_blueprint_context(canonical)

    blueprint_id = str(blueprint.get("id") or "").strip()
    if not blueprint_id:
        raise RuntimeError("Published blueprint context is invalid.")

    topics = _query_list(
        client,
        _rest_url(settings, "topics"),
        params={
            "select": "id,title,description,sequence",
            "blueprint_id": f"eq.{blueprint_id}",
            "order": "sequence.asc",
        },
        settings=settings,
        failure_message="Failed to load blueprint topics.",
    )
    topic_ids = [str(topic.get("id") or "").strip()
                 for topic in topics if str(topic.get("id") or "").strip()]
    objectives: list[dict[str, Any]] = []
    if topic_ids:
        objectives = _query_list(
            client,
            _rest_url(settings, "objectives"),
            params={
                "select": "topic_id,statement,level",
                "topic_id": f"in.({','.join(topic_ids)})",
            },
            settings=settings,
            failure_message="Failed to load blueprint objectives.",
        )

    objectives_by_topic: dict[str, list[dict[str, str]]] = defaultdict(list)
    for objective in objectives:
        topic_id = str(objective.get("topic_id") or "").strip()
        statement = str(objective.get("statement") or "").strip()
        if not topic_id or not statement:
            continue
        objectives_by_topic[topic_id].append(
            {
                "statement": statement,
                "level": str(objective.get("level") or "").strip(),
            }
        )

    topic_lines: list[str] = []
    for index, topic in enumerate(topics):
        topic_id = str(topic.get("id") or "").strip()
        title = str(topic.get("title") or "").strip() or f"Topic {index + 1}"
        description = str(topic.get("description") or "").strip()
        objective_lines = []
        for objective in objectives_by_topic.get(topic_id, []):
            level = objective.get("level") or ""
            if level:
                objective_lines.append(
                    f"  - {objective['statement']} ({level})")
            else:
                objective_lines.append(f"  - {objective['statement']}")

        parts = [f"Topic {index + 1}: {title}"]
        if description:
            parts.append(f"Description: {description}")
        if objective_lines:
            parts.append("Objectives:\n" + "\n".join(objective_lines))
        topic_lines.append("\n".join(parts))

    summary = str(blueprint.get("summary")
                  or "").strip() or "No summary provided."
    return "\n\n".join(
        [f"{BLUEPRINT_SOURCE_LABEL} | Published blueprint context",
            f"Summary: {summary}", *topic_lines]
    )


def _parse_canonical_blueprint(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    summary = raw.get("summary")
    topics = raw.get("topics")
    if not isinstance(summary, str) or not isinstance(topics, list):
        return None
    return raw


def _build_canonical_blueprint_context(payload: dict[str, Any]) -> str:
    topics = payload.get("topics")
    if not isinstance(topics, list):
        topics = []

    topic_lines: list[str] = []
    for index, topic in enumerate(topics):
        if not isinstance(topic, dict):
            continue
        title = str(topic.get("title") or "").strip() or f"Topic {index + 1}"
        section = str(topic.get("section") or "").strip()
        description = str(topic.get("description") or "").strip()
        prerequisites = topic.get("prerequisites")
        objectives = topic.get("objectives")
        assessment_ideas = topic.get("assessmentIdeas")

        objective_lines: list[str] = []
        if isinstance(objectives, list):
            for objective in objectives:
                if not isinstance(objective, dict):
                    continue
                statement = str(objective.get("statement") or "").strip()
                level = str(objective.get("level") or "").strip()
                if not statement:
                    continue
                objective_lines.append(
                    f"  - {statement} ({level})" if level else f"  - {statement}"
                )

        assessment_lines: list[str] = []
        if isinstance(assessment_ideas, list):
            for idea in assessment_ideas:
                value = str(idea or "").strip()
                if value:
                    assessment_lines.append(f"  - {value}")

        prereq_line = ""
        if isinstance(prerequisites, list):
            flattened = [str(item or "").strip()
                         for item in prerequisites if str(item or "").strip()]
            if flattened:
                prereq_line = f"Prerequisites: {', '.join(flattened)}"

        parts = [f"Topic {index + 1}: {title}"]
        if section:
            parts.append(f"Section: {section}")
        if description:
            parts.append(f"Description: {description}")
        if prereq_line:
            parts.append(prereq_line)
        if objective_lines:
            parts.append("Objectives:\n" + "\n".join(objective_lines))
        if assessment_lines:
            parts.append("Assessment ideas:\n" + "\n".join(assessment_lines))
        topic_lines.append("\n".join(parts))

    assumptions = payload.get("assumptions")
    uncertainty_notes = payload.get("uncertaintyNotes")
    assumptions_block = ""
    uncertainty_block = ""
    if isinstance(assumptions, list):
        values = [str(item or "").strip()
                  for item in assumptions if str(item or "").strip()]
        if values:
            assumptions_block = "Assumptions:\n" + \
                "\n".join([f"- {item}" for item in values])
    if isinstance(uncertainty_notes, list):
        values = [str(item or "").strip()
                  for item in uncertainty_notes if str(item or "").strip()]
        if values:
            uncertainty_block = "Uncertainty notes:\n" + \
                "\n".join([f"- {item}" for item in values])

    summary = str(payload.get("summary")
                  or "").strip() or "No summary provided."
    parts = [
        f"{BLUEPRINT_SOURCE_LABEL} | Published blueprint context",
        f"Summary: {summary}",
        assumptions_block or None,
        uncertainty_block or None,
        *topic_lines,
    ]
    return "\n\n".join([part for part in parts if part])


def _retrieve_material_context(
    *,
    client: httpx.Client,
    settings: Settings,
    class_id: str,
    query: str,
) -> str:
    embeddings_result = generate_embeddings_with_fallback(
        settings,
        EmbeddingsRequest(inputs=[query]),
    )
    if not embeddings_result.embeddings:
        return ""
    query_embedding = embeddings_result.embeddings[0]
    if not isinstance(query_embedding, list) or not query_embedding:
        return ""

    response = client.post(
        _rest_url(settings, "rpc/match_material_chunks"),
        headers=_service_headers(settings),
        json={
            "p_class_id": class_id,
            "query_embedding": query_embedding,
            "match_count": DEFAULT_RAG_MATCH_COUNT,
        },
    )
    payload = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_error_message(
            payload) or "Failed to retrieve material context."
        raise RuntimeError(message)

    rows = payload if isinstance(payload, list) else []
    chunks = [row for row in rows if isinstance(row, dict)]
    selected: list[dict[str, Any]] = []
    usage_by_material: dict[str, int] = defaultdict(int)
    used_tokens = 0

    for chunk in chunks:
        material_id = str(chunk.get("material_id") or "").strip()
        if not material_id:
            continue
        if usage_by_material[material_id] >= DEFAULT_RAG_MAX_PER_MATERIAL:
            continue
        text = str(chunk.get("text") or "").strip()
        if not text:
            continue
        token_count_raw = chunk.get("token_count")
        token_count = _coerce_token_count(
            token_count_raw) or _estimate_token_count(text)
        if used_tokens + token_count > DEFAULT_RAG_CONTEXT_TOKENS:
            break

        usage_by_material[material_id] += 1
        used_tokens += token_count
        selected.append(chunk)

    return _build_material_context(selected)


def _coerce_token_count(value: Any) -> int:
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


def _estimate_token_count(text: str) -> int:
    normalized = text.strip()
    if not normalized:
        return 0
    return max(1, math.ceil(len(normalized) / 4))


def _build_material_context(chunks: list[dict[str, Any]]) -> str:
    if not chunks:
        return ""

    sections: list[str] = []
    for index, chunk in enumerate(chunks):
        title = str(chunk.get("material_title") or "Untitled material").strip()
        source_type = str(chunk.get("source_type") or "chunk").strip()
        source_index = str(chunk.get("source_index") or "").strip() or "0"
        text = str(chunk.get("text") or "").strip()
        if not text:
            continue
        header = f"Source {index + 1} | {title} | {source_type} {source_index}"
        sections.append(f"{header}\n{text}".strip())
    return "\n\n---\n\n".join(sections)


def _normalize_model_citations(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    citations: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        source_label = str(item.get("sourceLabel") or "").strip()
        rationale = str(item.get("rationale") or "").strip()
        if not source_label:
            continue
        snippet = rationale or None
        citation: dict[str, str] = {"sourceLabel": source_label}
        if snippet:
            citation["snippet"] = snippet
        citations.append(citation)
    return citations


def _normalize_compaction_summary(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    summary = row.get("summary_json")
    if not isinstance(summary, dict):
        return None
    compacted_through = summary.get("compactedThrough")
    if not isinstance(compacted_through, dict):
        return None
    generated_at = str(summary.get("generatedAt") or "").strip()
    created_at = str(row.get("compacted_through_created_at")
                     or compacted_through.get("createdAt") or "").strip()
    message_id = str(row.get("compacted_through_message_id")
                     or compacted_through.get("messageId") or "").strip()
    turn_count = _coerce_token_count(
        row.get("compacted_turn_count") or compacted_through.get("turnCount"))
    if not generated_at or not created_at or not message_id:
        return None

    normalized = dict(summary)
    normalized["generatedAt"] = generated_at
    normalized["compactedThrough"] = {
        "createdAt": created_at,
        "messageId": message_id,
        "turnCount": turn_count,
    }
    return normalized


def _build_compaction_decision(
    *,
    messages: list[dict[str, Any]],
    existing_summary: dict[str, Any] | None,
    pending_user_message: str,
) -> dict[str, Any]:
    candidates = _collect_compaction_candidates(
        messages, CHAT_CONTEXT_RECENT_TURNS, existing_summary)
    estimated_prompt_tokens = _estimate_token_count(
        "\n".join([pending_user_message, *[str(item.get("content") or "")
                  for item in messages]])
    )
    usable_budget = max(1, CHAT_CONTEXT_WINDOW_TOKENS -
                        CHAT_OUTPUT_TOKEN_RESERVE)
    pressure_ratio = estimated_prompt_tokens / usable_budget

    if len(messages) < CHAT_COMPACTION_TRIGGER_TURNS:
        return {
            "should_compact": False,
            "reason": "below_trigger",
            "estimated_prompt_tokens": estimated_prompt_tokens,
            "pressure_ratio": pressure_ratio,
            "unsummarized_turn_count": len(candidates),
        }
    if len(candidates) < CHAT_COMPACTION_MIN_NEW_TURNS:
        return {
            "should_compact": False,
            "reason": "no_new_turns",
            "estimated_prompt_tokens": estimated_prompt_tokens,
            "pressure_ratio": pressure_ratio,
            "unsummarized_turn_count": len(candidates),
        }
    if pressure_ratio >= CHAT_COMPACTION_CONTEXT_PRESSURE:
        return {
            "should_compact": True,
            "reason": "token_pressure",
            "estimated_prompt_tokens": estimated_prompt_tokens,
            "pressure_ratio": pressure_ratio,
            "unsummarized_turn_count": len(candidates),
        }
    if len(messages) >= CHAT_COMPACTION_TRIGGER_TURNS * 2:
        return {
            "should_compact": True,
            "reason": "message_count_trigger",
            "estimated_prompt_tokens": estimated_prompt_tokens,
            "pressure_ratio": pressure_ratio,
            "unsummarized_turn_count": len(candidates),
        }
    return {
        "should_compact": False,
        "reason": "low_context_pressure",
        "estimated_prompt_tokens": estimated_prompt_tokens,
        "pressure_ratio": pressure_ratio,
        "unsummarized_turn_count": len(candidates),
    }


def _build_compaction_result(
    *,
    messages: list[dict[str, Any]],
    existing_summary: dict[str, Any] | None,
    latest_user_message: str,
) -> dict[str, Any] | None:
    candidates = _collect_compaction_candidates(
        messages, CHAT_CONTEXT_RECENT_TURNS, existing_summary)
    if not candidates:
        return None
    latest_terms = _extract_terms(latest_user_message)
    scored = []
    total = len(candidates)
    for index, message in enumerate(candidates):
        scored.append(
            {
                "message": message,
                "score": _score_turn(
                    message=message,
                    index=index,
                    total=total,
                    latest_query_terms=latest_terms,
                ),
            }
        )
    selected = _select_chronological_highlights(scored)
    if not selected:
        return None
    compacted_through = selected[-1]
    compacted_index = next(
        (
            index
            for index, candidate in enumerate(candidates)
            if str(candidate.get("id") or "") == str(compacted_through.get("id") or "")
            and str(candidate.get("created_at") or "") == str(compacted_through.get("created_at") or "")
        ),
        -1,
    )
    compacted_turn_delta = compacted_index + \
        1 if compacted_index >= 0 else len(candidates)
    summary = _merge_summary(
        existing_summary=existing_summary,
        selected=selected,
        compacted_through=compacted_through,
        compacted_turn_delta=compacted_turn_delta,
        latest_query_terms=latest_terms,
    )
    return {
        "summary": summary,
        "summary_text": _build_compaction_memory_text(summary),
    }


def _build_compaction_memory_text(summary: dict[str, Any] | None) -> str:
    if not isinstance(summary, dict):
        return ""
    lines = ["Compacted conversation memory (older turns):"]
    timeline = summary.get("timeline")
    if isinstance(timeline, dict):
        highlights = timeline.get("highlights")
        if isinstance(highlights, list):
            normalized = [str(item or "").strip()
                          for item in highlights if str(item or "").strip()]
            if normalized:
                lines.append(f"Timeline highlights: {' | '.join(normalized)}")

    key_terms = summary.get("keyTerms")
    if isinstance(key_terms, list):
        terms = []
        for item in key_terms:
            if isinstance(item, dict):
                value = str(item.get("term") or "").strip()
                if value:
                    terms.append(value)
        if terms:
            lines.append(f"Key terms: {', '.join(terms)}")

    for field_name, label in [
        ("resolvedFacts", "Resolved points"),
        ("openQuestions", "Open questions"),
        ("studentNeeds", "Student needs"),
    ]:
        value = summary.get(field_name)
        if isinstance(value, list):
            normalized = [str(item or "").strip()
                          for item in value if str(item or "").strip()]
            if normalized:
                lines.append(f"{label}: {' | '.join(normalized)}")

    lines.append(
        "If this memory conflicts with recent transcript turns, prefer the recent transcript.")
    return "\n".join(lines)


def _collect_compaction_candidates(
    chronological_messages: list[dict[str, Any]],
    recent_turns: int,
    existing_summary: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if len(chronological_messages) <= recent_turns:
        return []
    compactable = chronological_messages[: len(
        chronological_messages) - recent_turns]
    anchor = existing_summary.get("compactedThrough") if isinstance(
        existing_summary, dict) else None
    if not isinstance(anchor, dict):
        return compactable
    anchor_created_at = str(anchor.get("createdAt") or "").strip()
    anchor_message_id = str(anchor.get("messageId") or "").strip()
    if not anchor_created_at or not anchor_message_id:
        return compactable

    filtered: list[dict[str, Any]] = []
    for message in compactable:
        created_at = str(message.get("created_at") or "").strip()
        message_id = str(message.get("id") or "").strip()
        if not created_at or not message_id:
            continue
        if created_at > anchor_created_at or (created_at == anchor_created_at and message_id > anchor_message_id):
            filtered.append(message)
    return filtered


def _score_turn(
    *,
    message: dict[str, Any],
    index: int,
    total: int,
    latest_query_terms: list[str],
) -> float:
    content = str(message.get("content") or "")
    lower = content.lower()
    message_terms = _extract_terms(content)
    overlap_count = len(
        [term for term in message_terms if term in latest_query_terms])
    recency_factor = (index + 1) / max(1, total)
    author_kind = str(message.get("author_kind") or "")
    asks_question = "?" in content
    has_confusion_signal = bool(
        re.search(r"(stuck|confused|not sure|don't understand|help)", lower)
    )
    has_resolution_signal = bool(
        re.search(r"(therefore|so the answer|this means|remember)", lower))
    citations = message.get("citations")
    citation_count = len(citations) if isinstance(citations, list) else 0

    score = 1 + recency_factor
    score += overlap_count * 0.8
    if asks_question and author_kind != "assistant":
        score += 1.5
    if has_confusion_signal and author_kind != "assistant":
        score += 1.3
    if author_kind == "assistant" and citation_count > 0:
        score += 1.1
    if has_resolution_signal and author_kind == "assistant":
        score += 0.7
    return score


def _select_chronological_highlights(scored_turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected_count = min(18, len(scored_turns))
    top = sorted(scored_turns, key=lambda item: float(
        item.get("score") or 0), reverse=True)[:selected_count]
    top.sort(
        key=lambda item: (
            str((item.get("message") or {}).get("created_at") or ""),
            str((item.get("message") or {}).get("id") or ""),
        )
    )
    highlights: list[dict[str, Any]] = []
    for item in top:
        message = item.get("message")
        if isinstance(message, dict):
            highlights.append(cast(dict[str, Any], message))
    return highlights


def _merge_summary(
    *,
    existing_summary: dict[str, Any] | None,
    selected: list[dict[str, Any]],
    compacted_through: dict[str, Any],
    compacted_turn_delta: int,
    latest_query_terms: list[str],
) -> dict[str, Any]:
    previous = existing_summary if isinstance(existing_summary, dict) else {}
    generated_at = datetime.now(UTC).isoformat()

    merged_terms: dict[str, dict[str, Any]] = {}
    for term in previous.get("keyTerms", []) if isinstance(previous.get("keyTerms"), list) else []:
        if isinstance(term, dict):
            key = str(term.get("term") or "").strip()
            if not key:
                continue
            merged_terms[key] = {
                "weight": float(term.get("weight") or 0),
                "occurrences": _coerce_token_count(term.get("occurrences")),
                "lastSeen": str(term.get("lastSeen") or "").strip() or generated_at,
            }

    latest_query_set = set(latest_query_terms)
    for message in selected:
        created_at = str(message.get("created_at")
                         or "").strip() or generated_at
        for term in _extract_terms(str(message.get("content") or "")):
            if term not in latest_query_set and len(term) < 4:
                continue
            existing = merged_terms.get(term)
            previous_weight = float(existing.get(
                "weight") or 0.0) if existing else 0.0
            previous_occurrences = _coerce_token_count(
                existing.get("occurrences")) if existing else 0
            merged_terms[term] = {
                "weight": previous_weight + 1.0,
                "occurrences": previous_occurrences + 1,
                "lastSeen": created_at,
            }

    key_terms = sorted(
        [
            {
                "term": term,
                "weight": round(float(value.get("weight") or 0), 2),
                "occurrences": _coerce_token_count(value.get("occurrences")),
                "lastSeen": str(value.get("lastSeen") or "").strip() or generated_at,
            }
            for term, value in merged_terms.items()
        ],
        key=lambda item: (-cast(float,
                          item["weight"]), -cast(int, item["occurrences"])),
    )[:MAX_KEY_TERMS]

    resolved_facts = _uniq(
        [
            *(_as_string_list(previous.get("resolvedFacts"))),
            *[
                _first_sentence(str(message.get("content") or ""))
                for message in selected
                if str(message.get("author_kind") or "") == "assistant"
            ],
        ]
    )[-MAX_LIST_ITEMS:]

    open_questions = _uniq(
        [
            *(_as_string_list(previous.get("openQuestions"))),
            *[
                _first_sentence(str(message.get("content") or ""))
                for message in selected
                if str(message.get("author_kind") or "") != "assistant"
                and "?" in str(message.get("content") or "")
            ],
        ]
    )[-MAX_LIST_ITEMS:]

    student_needs = _uniq(
        [
            *(_as_string_list(previous.get("studentNeeds"))),
            *[
                _first_sentence(str(message.get("content") or ""))
                for message in selected
                if str(message.get("author_kind") or "") != "assistant"
                and re.search(r"(stuck|confused|not sure|don't understand|help)", str(message.get("content") or ""), re.I)
            ],
        ]
    )[-MAX_LIST_ITEMS:]

    previous_timeline_raw = previous.get("timeline")
    previous_timeline: dict[str, Any] = (
        cast(dict[str, Any], previous_timeline_raw) if isinstance(
            previous_timeline_raw, dict) else {}
    )
    highlights = _uniq(
        [
            *(_as_string_list(previous_timeline.get("highlights"))),
            *[_compact_line(str(message.get("content") or ""))
              for message in selected],
        ]
    )[-MAX_HIGHLIGHTS:]

    compacted_through_created_at = str(compacted_through.get(
        "created_at") or "").strip() or generated_at
    compacted_through_message_id = str(
        compacted_through.get("id") or "").strip()
    prior_turn_count = 0
    prior_compacted = previous.get("compactedThrough")
    if isinstance(prior_compacted, dict):
        prior_turn_count = _coerce_token_count(
            prior_compacted.get("turnCount"))

    return {
        "version": "v1",
        "generatedAt": generated_at,
        "compactedThrough": {
            "createdAt": compacted_through_created_at,
            "messageId": compacted_through_message_id,
            "turnCount": prior_turn_count + compacted_turn_delta,
        },
        "keyTerms": key_terms,
        "resolvedFacts": resolved_facts,
        "openQuestions": open_questions,
        "studentNeeds": student_needs,
        "timeline": {
            "from": (
                str(previous_timeline.get("from") or "").strip()
                or str(selected[0].get("created_at") or "").strip()
                or compacted_through_created_at
            ),
            "to": compacted_through_created_at,
            "highlights": highlights,
        },
    }


def _extract_terms(text: str) -> list[str]:
    return [
        term
        for term in re.split(r"[^a-z0-9_]+", text.lower())
        if term and len(term) >= 3 and term not in STOP_WORDS
    ]


def _first_sentence(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", stripped)
    sentence = parts[0] if parts else stripped
    return _compact_line(sentence)


def _compact_line(text: str) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    if len(clean) <= 160:
        return clean
    return clean[:157].strip() + "..."


def _uniq(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _as_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item or "").strip() for item in value if str(item or "").strip()]


def _require_supabase_credentials(settings: Settings) -> None:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "Supabase service credentials are not configured on Python backend.")


def _client(settings: Settings) -> httpx.Client:
    return httpx.Client(timeout=max(5, settings.ai_request_timeout_ms / 1000))


def _rest_url(settings: Settings, table: str) -> str:
    if not settings.supabase_url:
        raise RuntimeError(
            "Supabase service URL is not configured on Python backend.")
    return f"{settings.supabase_url.rstrip('/')}/rest/v1/{table}"


def _service_headers(settings: Settings, *, prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": settings.supabase_service_role_key or "",
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _query_list(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, str],
    settings: Settings,
    failure_message: str,
) -> list[dict[str, Any]]:
    response = client.get(
        url, headers=_service_headers(settings), params=params)
    payload = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_error_message(payload) or failure_message
        raise RuntimeError(message)
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    return []


def _query_maybe_single(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, str],
    settings: Settings,
    failure_message: str,
) -> dict[str, Any] | None:
    rows = _query_list(client, url, params=params,
                       settings=settings, failure_message=failure_message)
    if not rows:
        return None
    return rows[0]


def _insert_and_return_single(
    client: httpx.Client,
    url: str,
    *,
    payload: dict[str, Any],
    settings: Settings,
    failure_message: str,
) -> dict[str, Any]:
    response = client.post(
        url,
        headers=_service_headers(settings, prefer="return=representation"),
        json=payload,
    )
    body = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_error_message(body) or failure_message
        raise RuntimeError(message)
    if isinstance(body, list) and body and isinstance(body[0], dict):
        return body[0]
    raise RuntimeError(failure_message)


def _update_and_return_single(
    client: httpx.Client,
    url: str,
    *,
    payload: dict[str, Any],
    filters: dict[str, str],
    settings: Settings,
    failure_message: str,
    not_found_message: str,
) -> dict[str, Any]:
    response = client.patch(
        url,
        headers=_service_headers(settings, prefer="return=representation"),
        params=filters,
        json=payload,
    )
    body = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_error_message(body) or failure_message
        raise RuntimeError(message)
    if isinstance(body, list) and body and isinstance(body[0], dict):
        return body[0]
    raise ChatWorkspaceError(not_found_message, "not_found", 404)


def _insert_rows(
    client: httpx.Client,
    url: str,
    *,
    payload: list[dict[str, Any]],
    settings: Settings,
    failure_message: str,
) -> None:
    response = client.post(
        url,
        headers=_service_headers(settings, prefer="return=minimal"),
        json=payload,
    )
    body = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_error_message(body) or failure_message
        raise RuntimeError(message)


def _update_rows(
    client: httpx.Client,
    url: str,
    *,
    payload: dict[str, Any],
    filters: dict[str, str],
    settings: Settings,
    failure_message: str,
) -> None:
    response = client.patch(
        url,
        headers=_service_headers(settings, prefer="return=minimal"),
        params=filters,
        json=payload,
    )
    body = _safe_json(response)
    if response.status_code >= 400:
        message = _extract_error_message(body) or failure_message
        raise RuntimeError(message)


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return {}


def _extract_error_message(payload: Any) -> str | None:
    if isinstance(payload, dict):
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
        details = payload.get("details")
        if isinstance(details, str) and details.strip():
            return details.strip()
    return None


def _decode_cursor(cursor: str | None) -> dict[str, str] | None:
    if not cursor or not cursor.strip():
        return None
    split_index = cursor.rfind("|")
    if split_index <= 0 or split_index >= len(cursor) - 1:
        return None
    created_at = cursor[:split_index].strip()
    message_id = cursor[split_index + 1:].strip()
    if not created_at or not message_id:
        return None
    if not _ISO_TS_RE.match(created_at):
        return None
    if not _UUID_RE.match(message_id):
        return None
    return {"created_at": created_at, "id": message_id}


def _encode_cursor(message_row: dict[str, Any]) -> str | None:
    created_at = str(message_row.get("created_at") or "").strip()
    message_id = str(message_row.get("id") or "").strip()
    if not created_at or not message_id:
        return None
    return f"{created_at}|{message_id}"
