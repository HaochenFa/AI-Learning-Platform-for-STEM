from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import _parse_bearer_token, app
from tests.helpers import make_settings


class MainTests(unittest.TestCase):
    def test_parse_bearer_token(self) -> None:
        self.assertEqual(_parse_bearer_token("Bearer abc"), "abc")
        self.assertIsNone(_parse_bearer_token("Token abc"))

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


if __name__ == "__main__":
    unittest.main()
