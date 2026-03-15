from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest

from pydantic import ValidationError

from app.schemas import ChatWorkspaceMessageSendRequest, QuizGenerateRequest


class SchemasTests(unittest.TestCase):
    def test_chat_workspace_send_schema_valid(self) -> None:
        payload = ChatWorkspaceMessageSendRequest(
            class_id="class-1",
            user_id="user-1",
            session_id="session-1",
            message="hello",
            tool_mode="off",
        )
        self.assertEqual(payload.class_id, "class-1")

    def test_quiz_schema_rejects_invalid_count(self) -> None:
        with self.assertRaises(ValidationError):
            QuizGenerateRequest(
                class_title="Calc",
                question_count=0,
                instructions="Make quiz",
                blueprint_context="bp",
                material_context="ctx",
            )


if __name__ == "__main__":
    unittest.main()
