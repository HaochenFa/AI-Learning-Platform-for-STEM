from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import sys
import unittest
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.chat_workspace import (  # noqa: E402
    _build_compaction_decision,
    _build_compaction_memory_text,
    _build_compaction_result,
    _collect_compaction_candidates,
    send_message,
)
from app.config import Settings  # noqa: E402
from app.schemas import ChatGenerateResult, ChatWorkspaceMessageSendRequest  # noqa: E402


def _make_settings() -> Settings:
    return Settings(
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


def _make_message(index: int, *, content: str, author_kind: str = "student") -> dict[str, object]:
    created_at = (datetime(2026, 3, 10, tzinfo=UTC) +
                  timedelta(minutes=index)).isoformat()
    return {
        "id": f"m{index:04d}",
        "session_id": "session-1",
        "class_id": "class-1",
        "author_user_id": "user-1" if author_kind != "assistant" else None,
        "author_kind": author_kind,
        "content": content,
        "citations": [{"sourceLabel": "Blueprint Context"}] if author_kind == "assistant" else [],
        "created_at": created_at,
    }


class ChatWorkspaceCompactionTests(unittest.TestCase):
    def test_compaction_decision_below_trigger(self) -> None:
        messages = [_make_message(i, content="short context")
                    for i in range(10)]
        decision = _build_compaction_decision(
            messages=messages,
            existing_summary=None,
            pending_user_message="help me",
        )

        self.assertFalse(decision["should_compact"])
        self.assertEqual(decision["reason"], "below_trigger")

    def test_compaction_decision_token_pressure(self) -> None:
        long_chunk = "x" * 1400
        messages = [_make_message(i, content=long_chunk) for i in range(30)]
        decision = _build_compaction_decision(
            messages=messages,
            existing_summary=None,
            pending_user_message=long_chunk,
        )

        self.assertTrue(decision["should_compact"])
        self.assertEqual(decision["reason"], "token_pressure")

    def test_compaction_decision_message_count_trigger(self) -> None:
        messages = [_make_message(i, content="short") for i in range(60)]
        decision = _build_compaction_decision(
            messages=messages,
            existing_summary=None,
            pending_user_message="quick check",
        )

        self.assertTrue(decision["should_compact"])
        self.assertEqual(decision["reason"], "message_count_trigger")

    def test_collect_candidates_respects_anchor(self) -> None:
        messages = [_make_message(i, content=f"turn {i}") for i in range(25)]
        anchor = messages[5]
        existing_summary = {
            "compactedThrough": {
                "createdAt": anchor["created_at"],
                "messageId": anchor["id"],
                "turnCount": 6,
            }
        }

        candidates = _collect_compaction_candidates(
            messages, recent_turns=4, existing_summary=existing_summary)
        self.assertGreater(len(candidates), 0)
        for candidate in candidates:
            created_at = str(candidate["created_at"])
            if created_at == str(anchor["created_at"]):
                self.assertGreater(str(candidate["id"]), str(anchor["id"]))
            else:
                self.assertGreater(created_at, str(anchor["created_at"]))

    def test_compaction_result_and_memory_text_shape(self) -> None:
        messages: list[dict[str, object]] = []
        for i in range(36):
            if i % 2 == 0:
                content = f"I am stuck on limit proof step {i}?"
                author = "student"
            else:
                content = f"Therefore use epsilon-delta reasoning at step {i}."
                author = "assistant"
            messages.append(_make_message(
                i, content=content, author_kind=author))

        result = _build_compaction_result(
            messages=messages,
            existing_summary=None,
            latest_user_message="how to prove limit with epsilon delta",
        )

        self.assertIsNotNone(result)
        assert result is not None
        summary = result["summary"]
        self.assertEqual(summary["version"], "v1")
        self.assertGreater(summary["compactedThrough"]["turnCount"], 0)
        self.assertLessEqual(len(summary["keyTerms"]), 12)

        memory_text = _build_compaction_memory_text(summary)
        self.assertIn("Compacted conversation memory", memory_text)
        self.assertIn("Key terms:", memory_text)

    def test_send_message_uses_compacted_memory_and_reports_context_meta(self) -> None:
        settings = _make_settings()
        request = ChatWorkspaceMessageSendRequest(
            class_id="class-1",
            user_id="user-1",
            session_id="session-1",
            message="Can you help me with this proof?",
        )

        context_rows = [_make_message(i, content="prior turn")
                        for i in range(35)]
        compaction_summary = {
            "version": "v1",
            "generatedAt": "2026-03-10T00:40:00+00:00",
            "compactedThrough": {
                "createdAt": "2026-03-10T00:30:00+00:00",
                "messageId": "m0030",
                "turnCount": 20,
            },
            "keyTerms": [{"term": "epsilon", "weight": 1, "occurrences": 1, "lastSeen": "2026-03-10T00:30:00+00:00"}],
            "resolvedFacts": ["Use definition first."],
            "openQuestions": ["How to set delta?"],
            "studentNeeds": ["Needs step-by-step plan."],
            "timeline": {
                "from": "2026-03-10T00:00:00+00:00",
                "to": "2026-03-10T00:30:00+00:00",
                "highlights": ["Student asked about epsilon-delta."],
            },
        }

        with (
            patch("app.chat_workspace._client",
                  return_value=nullcontext(object())),
            patch("app.chat_workspace._resolve_access", return_value={
                  "is_member": True, "is_teacher": False, "class_title": "Calculus"}),
            patch(
                "app.chat_workspace._query_maybe_single",
                side_effect=[
                    {
                        "id": "session-1",
                        "class_id": "class-1",
                        "owner_user_id": "user-1",
                        "title": "Session",
                        "is_pinned": False,
                        "archived_at": None,
                        "last_message_at": "2026-03-10T00:00:00+00:00",
                        "created_at": "2026-03-10T00:00:00+00:00",
                        "updated_at": "2026-03-10T00:00:00+00:00",
                    },
                    None,
                ],
            ),
            patch("app.chat_workspace._query_list", return_value=context_rows),
            patch("app.chat_workspace._build_compaction_decision", return_value={
                  "should_compact": True, "reason": "token_pressure"}),
            patch(
                "app.chat_workspace._build_compaction_result",
                return_value={"summary": compaction_summary,
                              "summary_text": "memory text"},
            ),
            patch("app.chat_workspace._build_compaction_memory_text",
                  return_value="memory text"),
            patch("app.chat_workspace._load_published_blueprint_context",
                  return_value="blueprint context"),
            patch("app.chat_workspace._retrieve_material_context",
                  return_value="material context"),
            patch(
                "app.chat_workspace.generate_chat",
                return_value=ChatGenerateResult(
                    payload={
                        "safety": "ok",
                        "answer": "Use the epsilon-delta definition first.",
                        "citations": [{"sourceLabel": "Blueprint Context", "rationale": "Published objective."}],
                    },
                    provider="openrouter",
                    model="model-a",
                    usage=None,
                    latency_ms=123,
                    orchestration={},
                ),
            ) as generate_chat_mock,
            patch("app.chat_workspace._insert_rows") as insert_rows_mock,
            patch("app.chat_workspace._update_rows"),
        ):
            result = send_message(settings, request)

        self.assertTrue(result["context_meta"]["compacted"])
        self.assertEqual(result["context_meta"]["reason"], "token_pressure")
        self.assertEqual(
            result["context_meta"]["compacted_at"], compaction_summary["generatedAt"])

        chat_request = generate_chat_mock.call_args[0][1]
        self.assertEqual(chat_request.compacted_memory_context, "memory text")
        self.assertEqual(insert_rows_mock.call_count, 2)


if __name__ == "__main__":
    unittest.main()
