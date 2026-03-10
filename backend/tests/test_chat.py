from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest

from app.chat import (
    build_chat_prompt,
    parse_chat_response,
    resolve_chat_engine,
    resolve_memory_namespace,
)
from app.schemas import ChatGenerateRequest


class ChatTests(unittest.TestCase):
    def test_parse_chat_response_valid(self) -> None:
        raw = '{"safety":"ok","answer":"Here is help","citations":[{"sourceLabel":"Blueprint Context","rationale":"Objective says so"}]}'
        parsed = parse_chat_response(raw)
        self.assertEqual(parsed["safety"], "ok")
        self.assertEqual(parsed["citations"][0]
                         ["sourceLabel"], "Blueprint Context")

    def test_resolve_chat_engine(self) -> None:
        self.assertEqual(resolve_chat_engine(
            {"engine": "langgraph_v1"}), "langgraph_v1")
        self.assertEqual(resolve_chat_engine({"engine": "other"}), "direct_v1")

    def test_build_chat_prompt_and_namespace(self) -> None:
        request = ChatGenerateRequest(
            class_id="class 1",
            user_id="user 1",
            class_title="Calculus",
            user_message="How to solve this?",
            transcript=[],
            blueprint_context="Blueprint Context",
            material_context="Source 1",
        )
        prompt = build_chat_prompt(
            class_title=request.class_title,
            user_message=request.user_message,
            transcript=request.transcript,
            blueprint_context=request.blueprint_context,
            material_context=request.material_context,
            compacted_memory_context="",
            assignment_instructions=None,
        )
        self.assertIn("Class: Calculus", prompt["user"])
        namespace = resolve_memory_namespace(request)
        self.assertEqual(namespace[0], "chat_memory")


if __name__ == "__main__":
    unittest.main()
