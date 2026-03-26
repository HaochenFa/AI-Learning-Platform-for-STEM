from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.guest_rate_limit import check_guest_ai_access
from app.main import app
from tests.helpers import make_settings


def _guest_sandbox_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "chat_messages_used": 0,
        "quiz_generations_used": 0,
        "flashcard_generations_used": 0,
        "blueprint_regenerations_used": 0,
        "embedding_operations_used": 0,
    }
    row.update(overrides)
    return row


class GuestRateLimitFunctionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = make_settings()

    def test_per_feature_limits_match_guest_mode_spec(self) -> None:
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(chat_messages_used=49), "chat"),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(chat_messages_used=50), "chat"),
            (False, "Guest chat limit reached."),
        )

        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(quiz_generations_used=4), "quiz"),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(quiz_generations_used=5), "quiz"),
            (False, "Guest quiz limit reached."),
        )

        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(flashcard_generations_used=9),
                "flashcards",
            ),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(flashcard_generations_used=10),
                "flashcards",
            ),
            (False, "Guest flashcards limit reached."),
        )

        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(blueprint_regenerations_used=2),
                "blueprint",
            ),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(blueprint_regenerations_used=3),
                "blueprint",
            ),
            (False, "Guest blueprint limit reached."),
        )

    def test_embedding_uses_guest_quota_limit(self) -> None:
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(embedding_operations_used=4),
                "embedding",
            ),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(embedding_operations_used=5),
                "embedding",
            ),
            (False, "Guest embedding limit reached."),
        )


class GuestRateLimitRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.settings = make_settings(
            python_backend_api_key="test-key",
            guest_max_concurrent_ai_requests=1,
        )

    def _guest_headers(self) -> dict[str, str]:
        return {
            "x-api-key": "test-key",
            "authorization": "Bearer guest-jwt",
        }

    def _guest_actor(self) -> dict[str, object]:
        return {
            "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "is_anonymous": True,
        }

    def _chat_payload(self) -> dict[str, object]:
        return {
            "user_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "class_id": "class-1",
            "class_title": "Guest Biology",
            "user_message": "Explain osmosis",
            "blueprint_context": "bp",
            "material_context": "materials",
            "sandbox_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        }

    def _quiz_payload(self) -> dict[str, object]:
        return {
            "class_title": "Guest Biology",
            "question_count": 5,
            "instructions": "Write a short quiz",
            "blueprint_context": "bp",
            "material_context": "materials",
            "sandbox_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        }

    def _embeddings_payload(self) -> dict[str, object]:
        return {
            "inputs": ["hello world"],
            "sandbox_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        }

    def test_guest_chat_requires_sandbox_id(self) -> None:
        payload = self._chat_payload()
        payload.pop("sandbox_id")

        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
        ):
            response = self.client.post(
                "/v1/chat/generate",
                headers=self._guest_headers(),
                json=payload,
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_required")

    def test_guest_quiz_requires_sandbox_id(self) -> None:
        payload = self._quiz_payload()
        payload.pop("sandbox_id")

        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
        ):
            response = self.client.post(
                "/v1/quiz/generate",
                headers=self._guest_headers(),
                json=payload,
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_required")

    def test_guest_embeddings_requires_sandbox_id(self) -> None:
        payload = {"inputs": ["hello world"]}

        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
        ):
            response = self.client.post(
                "/v1/llm/embeddings",
                headers=self._guest_headers(),
                json=payload,
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_required")

    def test_guest_chat_rejects_when_usage_limit_is_exhausted(self) -> None:
        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
            patch(
                "app.main._load_guest_sandbox_for_actor",
                return_value=(_guest_sandbox_row(), False),
            ),
            patch("app.main.check_guest_ai_access", return_value=(False, "Guest chat limit reached.")),
        ):
            response = self.client.post(
                "/v1/chat/generate",
                headers=self._guest_headers(),
                json=self._chat_payload(),
            )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "guest_rate_limit")

    def test_guest_chat_rejects_when_concurrency_limit_is_exhausted(self) -> None:
        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
            patch(
                "app.main._load_guest_sandbox_for_actor",
                return_value=(_guest_sandbox_row(), False),
            ),
            patch("app.main.check_guest_ai_access", return_value=(True, None)),
            patch("app.main.acquire_guest_ai_slot", new=AsyncMock(return_value=False)),
        ):
            response = self.client.post(
                "/v1/chat/generate",
                headers=self._guest_headers(),
                json=self._chat_payload(),
            )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "guest_concurrent_limit")

    def test_guest_embeddings_reject_when_guard_backend_is_unavailable(self) -> None:
        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
            patch(
                "app.main._load_guest_sandbox_for_actor",
                return_value=(None, True),
            ),
        ):
            response = self.client.post(
                "/v1/llm/embeddings",
                headers=self._guest_headers(),
                json=self._embeddings_payload(),
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_verification_unavailable")

    def test_guest_quiz_rejects_unowned_sandbox_id(self) -> None:
        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
            patch(
                "app.main._load_guest_sandbox_for_actor",
                return_value=(None, False),
            ),
        ):
            response = self.client.post(
                "/v1/quiz/generate",
                headers=self._guest_headers(),
                json=self._quiz_payload(),
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_forbidden")

    def test_guest_chat_increments_usage_and_releases_slot_after_success(self) -> None:
        release_mock = AsyncMock()
        increment_mock = AsyncMock()

        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
            patch(
                "app.main._load_guest_sandbox_for_actor",
                return_value=(_guest_sandbox_row(), False),
            ),
            patch("app.main.check_guest_ai_access", return_value=(True, None)),
            patch("app.main.acquire_guest_ai_slot", new=AsyncMock(return_value=True)),
            patch("app.main.release_guest_ai_slot", new=release_mock),
            patch("app.main.increment_guest_ai_usage", new=increment_mock),
            patch(
                "app.main.run_in_threadpool",
                return_value=type(
                    "ChatResult",
                    (),
                    {
                        "model_dump": lambda self: {
                            "payload": {"message": "Hello"},
                            "provider": "openrouter",
                            "model": "test-model",
                            "latency_ms": 10,
                            "orchestration": {},
                        }
                    },
                )(),
            ),
        ):
            response = self.client.post(
                "/v1/chat/generate",
                headers=self._guest_headers(),
                json=self._chat_payload(),
            )

        self.assertEqual(response.status_code, 200)
        increment_mock.assert_awaited_once_with(
            self.settings,
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "chat",
        )
        release_mock.assert_awaited_once_with(
            self.settings,
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        )

    def test_guest_embeddings_increments_usage_and_releases_slot_after_success(self) -> None:
        release_mock = AsyncMock()
        increment_mock = AsyncMock()

        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
            patch(
                "app.main._load_guest_sandbox_for_actor",
                return_value=(_guest_sandbox_row(), False),
            ),
            patch("app.main.check_guest_ai_access", return_value=(True, None)),
            patch("app.main.acquire_guest_ai_slot", new=AsyncMock(return_value=True)),
            patch("app.main.release_guest_ai_slot", new=release_mock),
            patch("app.main.increment_guest_ai_usage", new=increment_mock),
            patch(
                "app.main.run_in_threadpool",
                return_value=type(
                    "EmbeddingsResult",
                    (),
                    {
                        "model_dump": lambda self: {
                            "provider": "openrouter",
                            "model": "embed-model",
                            "embeddings": [[0.1, 0.2]],
                            "latency_ms": 10,
                        }
                    },
                )(),
            ),
        ):
            response = self.client.post(
                "/v1/llm/embeddings",
                headers=self._guest_headers(),
                json=self._embeddings_payload(),
            )

        self.assertEqual(response.status_code, 200)
        increment_mock.assert_awaited_once_with(
            self.settings,
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "embedding",
        )
        release_mock.assert_awaited_once_with(
            self.settings,
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        )


if __name__ == "__main__":
    unittest.main()
