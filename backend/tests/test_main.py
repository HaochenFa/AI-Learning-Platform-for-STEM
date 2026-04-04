from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from app.main import _parse_bearer_token, app
from tests.helpers import make_settings


class MainTests(unittest.TestCase):
    def test_parse_bearer_token(self) -> None:
        self.assertEqual(_parse_bearer_token("Bearer abc"), "abc")
        self.assertIsNone(_parse_bearer_token("Token abc"))

    def test_guest_sandbox_verification_distinguishes_upstream_unavailable(self) -> None:
        settings = make_settings()

        class _FailingClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def get(self, *_args, **_kwargs):
                raise httpx.ConnectError("boom")

        async def run_test() -> Any:
            from app.main import _load_guest_sandbox_for_actor

            with patch("app.main.httpx.AsyncClient", return_value=_FailingClient()):
                return await _load_guest_sandbox_for_actor(
                    settings,
                    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                )

        result = __import__("asyncio").run(run_test())
        self.assertEqual(result, (None, True))

    def test_guest_chat_reuses_cached_actor_lookup(self) -> None:
        settings = make_settings(python_backend_api_key="secret")
        client = TestClient(app)
        request_urls: list[str] = []

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def get(self, url: str, **_kwargs):
                request_urls.append(url)
                if url.endswith("/auth/v1/user"):
                    return httpx.Response(
                        200,
                        json={
                            "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                            "is_anonymous": True,
                        },
                    )
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                            "chat_messages_used": 0,
                            "quiz_generations_used": 0,
                            "flashcard_generations_used": 0,
                            "blueprint_regenerations_used": 0,
                            "embedding_operations_used": 0,
                        }
                    ],
                )

        with (
            patch("app.main.get_settings", return_value=settings),
            patch("app.main.httpx.AsyncClient", return_value=_Client()),
            patch("app.main.acquire_guest_ai_slot", new=AsyncMock(return_value=True)),
            patch("app.main.increment_guest_ai_usage", new=AsyncMock()),
            patch("app.main.release_guest_ai_slot", new=AsyncMock()),
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
            response = client.post(
                "/v1/chat/generate",
                headers={"x-api-key": "secret", "authorization": "Bearer guest-jwt"},
                json={
                    "user_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "class_id": "c1",
                    "class_title": "Guest Class",
                    "user_message": "hello",
                    "blueprint_context": "bp",
                    "material_context": "materials",
                    "sandbox_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                },
            )

        self.assertEqual(response.status_code, 200)
        auth_urls = [url for url in request_urls if url.endswith("/auth/v1/user")]
        self.assertEqual(len(auth_urls), 1)

    def test_healthz(self) -> None:
        client = TestClient(app)
        response = client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_unauthorized_without_api_key_header(self) -> None:
        settings = make_settings(python_backend_api_key="secret")
        client = TestClient(app)
        with patch("app.main.get_settings", return_value=settings):
            response = client.post(
                "/v1/llm/generate", json={"system": "s", "user": "u"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "unauthorized")

    def test_user_bound_route_requires_user_token(self) -> None:
        settings = make_settings(python_backend_api_key="secret")
        client = TestClient(app)
        with patch("app.main.get_settings", return_value=settings):
            response = client.post(
                "/v1/classes/create",
                headers={"x-api-key": "secret"},
                json={
                    "user_id": "u1",
                    "title": "Physics",
                    "subject": None,
                    "level": None,
                    "description": None,
                    "join_code": "JOIN1",
                },
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]
                         ["code"], "user_token_required")

    def test_user_bound_route_rejects_payload_user_mismatch(self) -> None:
        settings = make_settings(python_backend_api_key="secret")
        client = TestClient(app)
        with (
            patch("app.main.get_settings", return_value=settings),
            patch("app.main._resolve_actor_user_id",
                  return_value=("actor-1", None)),
        ):
            response = client.post(
                "/v1/classes/create",
                headers={"x-api-key": "secret",
                         "authorization": "Bearer user-jwt"},
                json={
                    "user_id": "someone-else",
                    "title": "Physics",
                    "subject": None,
                    "level": None,
                    "description": None,
                    "join_code": "JOIN1",
                },
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "user_id_mismatch")


class GuestQuotaDefaultTests(unittest.TestCase):
    def test_guest_quota_defaults_match_approved_spec(self) -> None:
        settings = make_settings()
        self.assertEqual(settings.guest_max_concurrent_ai_requests, 20)
        self.assertEqual(settings.guest_embedding_limit, 15)


class EnvelopeGuardTests(unittest.TestCase):
    def _client_with_boom(self, exc: Exception) -> TestClient:
        """Return a TestClient where run_in_threadpool raises `exc`."""
        settings = make_settings()
        client = TestClient(app, raise_server_exceptions=False)

        def boom(*_args, **_kwargs):
            raise exc

        for p in [
            patch("app.main.get_settings", return_value=settings),
            patch("app.main.run_in_threadpool", side_effect=boom),
            patch("app.main._resolve_actor_user_id", return_value=("u1", None)),
            patch("app.main._resolve_actor_user", return_value=({"id": "u1", "is_anonymous": False}, None)),
        ]:
            p.start()
            self.addCleanup(p.stop)
        return client

    def _post_generate(self, client: TestClient) -> Any:
        return client.post(
            "/v1/chat/generate",
            headers={"x-api-key": "test-key", "authorization": "Bearer u1-jwt"},
            json={
                "user_id": "u1",
                "class_id": "c1",
                "class_title": "Test Class",
                "user_message": "hello",
                "blueprint_context": "test context",
                "material_context": "test material",
            },
        )

    def test_value_error_returns_envelope(self) -> None:
        client = self._client_with_boom(ValueError("boom"))
        response = self._post_generate(client)
        self.assertEqual(response.status_code, 500)
        body = response.json()
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "internal_error")
        self.assertEqual(body["error"]["message"], "An unexpected error occurred.")
        self.assertIn("request_id", body["meta"])

    def test_key_error_returns_envelope(self) -> None:
        client = self._client_with_boom(KeyError("missing"))
        response = self._post_generate(client)
        self.assertEqual(response.status_code, 500)
        body = response.json()
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "internal_error")
        self.assertEqual(body["error"]["message"], "An unexpected error occurred.")
        self.assertIn("request_id", body["meta"])


if __name__ == "__main__":
    unittest.main()
