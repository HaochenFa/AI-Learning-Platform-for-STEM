from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.guest_rate_limit import check_guest_ai_access, increment_guest_ai_usage, release_guest_ai_slot
from tests.helpers import make_settings


class GuestRateLimitTests(unittest.TestCase):
    def setUp(self) -> None:
        release_guest_ai_slot("sandbox-1")
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

    def _chat_payload(self) -> dict[str, object]:
        return {
            "user_id": "guest-user-1",
            "class_id": "class-1",
            "class_title": "Guest Biology",
            "user_message": "Explain osmosis",
            "blueprint_context": "bp",
            "material_context": "materials",
            "sandbox_id": "sandbox-1",
        }

    def _quiz_payload(self) -> dict[str, object]:
        return {
            "class_title": "Guest Biology",
            "question_count": 5,
            "instructions": "Write a short quiz",
            "blueprint_context": "bp",
            "material_context": "materials",
            "sandbox_id": "sandbox-1",
        }

    def test_per_feature_limits_match_guest_mode_spec(self) -> None:
        self.assertEqual(check_guest_ai_access(self.settings, "sandbox-1", "chat"), (True, None))
        for _ in range(50):
            increment_guest_ai_usage("sandbox-1", "chat")
        self.assertEqual(check_guest_ai_access(self.settings, "sandbox-1", "chat"), (False, "Guest chat limit reached."))

        self.assertEqual(check_guest_ai_access(self.settings, "sandbox-2", "quiz"), (True, None))
        for _ in range(5):
            increment_guest_ai_usage("sandbox-2", "quiz")
        self.assertEqual(check_guest_ai_access(self.settings, "sandbox-2", "quiz"), (False, "Guest quiz limit reached."))

        self.assertEqual(check_guest_ai_access(self.settings, "sandbox-3", "flashcards"), (True, None))
        for _ in range(10):
            increment_guest_ai_usage("sandbox-3", "flashcards")
        self.assertEqual(
            check_guest_ai_access(self.settings, "sandbox-3", "flashcards"),
            (False, "Guest flashcards limit reached."),
        )

        self.assertEqual(check_guest_ai_access(self.settings, "sandbox-4", "blueprint"), (True, None))
        for _ in range(3):
            increment_guest_ai_usage("sandbox-4", "blueprint")
        self.assertEqual(
            check_guest_ai_access(self.settings, "sandbox-4", "blueprint"),
            (False, "Guest blueprint limit reached."),
        )

    def test_embedding_uses_guest_quota_limit(self) -> None:
        self.assertEqual(check_guest_ai_access(self.settings, "sandbox-embed", "embedding"), (True, None))
        for _ in range(5):
            increment_guest_ai_usage("sandbox-embed", "embedding")
        self.assertEqual(
            check_guest_ai_access(self.settings, "sandbox-embed", "embedding"),
            (False, "Guest embedding limit reached."),
        )

    def test_guest_chat_requires_sandbox_id(self) -> None:
        payload = self._chat_payload()
        payload.pop("sandbox_id")

        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=({"id": "guest-user-1", "is_anonymous": True}, None)),
        ):
            response = self.client.post(
                "/v1/chat/generate",
                headers=self._guest_headers(),
                json=payload,
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_required")

    def test_guest_chat_rejects_when_usage_limit_is_exhausted(self) -> None:
        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=({"id": "guest-user-1", "is_anonymous": True}, None)),
            patch("app.main._guest_sandbox_belongs_to_actor", return_value=(True, False)),
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
            patch("app.main._resolve_actor_user", return_value=({"id": "guest-user-1", "is_anonymous": True}, None)),
            patch("app.main._guest_sandbox_belongs_to_actor", return_value=(True, False)),
            patch("app.main.check_guest_ai_access", return_value=(True, None)),
            patch("app.main.acquire_guest_ai_slot", return_value=False),
        ):
            response = self.client.post(
                "/v1/chat/generate",
                headers=self._guest_headers(),
                json=self._chat_payload(),
            )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "guest_concurrent_limit")

    def test_guest_chat_rejects_unowned_sandbox_id(self) -> None:
        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=({"id": "guest-user-1", "is_anonymous": True}, None)),
            patch("app.main._guest_sandbox_belongs_to_actor", return_value=(False, False), create=True),
            patch("app.main.check_guest_ai_access", return_value=(True, None)),
            patch("app.main.acquire_guest_ai_slot", return_value=True),
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

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_forbidden")

    def test_guest_chat_returns_upstream_error_when_sandbox_ownership_check_fails(self) -> None:
        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=({"id": "guest-user-1", "is_anonymous": True}, None)),
            patch(
                "app.main._guest_sandbox_belongs_to_actor",
                return_value=(False, True),
                create=True,
            ),
        ):
            response = self.client.post(
                "/v1/chat/generate",
                headers=self._guest_headers(),
                json=self._chat_payload(),
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_verification_unavailable")

    def test_guest_quiz_returns_upstream_error_when_sandbox_ownership_check_fails(self) -> None:
        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=({"id": "guest-user-1", "is_anonymous": True}, None)),
            patch(
                "app.main._guest_sandbox_belongs_to_actor",
                return_value=(False, True),
                create=True,
            ),
        ):
            response = self.client.post(
                "/v1/quiz/generate",
                headers=self._guest_headers(),
                json=self._quiz_payload(),
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_verification_unavailable")

    def test_guest_quiz_rejects_unowned_sandbox_id(self) -> None:
        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=({"id": "guest-user-1", "is_anonymous": True}, None)),
            patch("app.main._guest_sandbox_belongs_to_actor", return_value=(False, False), create=True),
            patch("app.main.check_guest_ai_access", return_value=(True, None)),
            patch("app.main.acquire_guest_ai_slot", return_value=True),
            patch(
                "app.main.run_in_threadpool",
                return_value=type(
                    "QuizResult",
                    (),
                    {
                        "model_dump": lambda self: {
                            "payload": {"questions": []},
                            "provider": "openrouter",
                            "model": "test-model",
                            "latency_ms": 10,
                        }
                    },
                )(),
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
        released: list[str] = []
        incremented: list[tuple[str, str]] = []

        def _release(sandbox_id: str) -> None:
            released.append(sandbox_id)

        def _increment(sandbox_id: str, feature: str) -> None:
            incremented.append((sandbox_id, feature))

        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=({"id": "guest-user-1", "is_anonymous": True}, None)),
            patch("app.main._guest_sandbox_belongs_to_actor", return_value=(True, False)),
            patch("app.main.check_guest_ai_access", return_value=(True, None)),
            patch("app.main.acquire_guest_ai_slot", return_value=True),
            patch("app.main.release_guest_ai_slot", side_effect=_release),
            patch("app.main.increment_guest_ai_usage", side_effect=_increment),
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
        self.assertEqual(incremented, [("sandbox-1", "chat")])
        self.assertEqual(released, ["sandbox-1"])

    def test_guest_quiz_requires_sandbox_id(self) -> None:
        payload = self._quiz_payload()
        payload.pop("sandbox_id")

        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=({"id": "guest-user-1", "is_anonymous": True}, None)),
        ):
            response = self.client.post(
                "/v1/quiz/generate",
                headers=self._guest_headers(),
                json=payload,
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "guest_sandbox_required")


if __name__ == "__main__":
    unittest.main()
