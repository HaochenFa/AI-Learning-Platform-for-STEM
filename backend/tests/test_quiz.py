from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import patch

from app.quiz import build_quiz_prompt, generate_quiz, parse_quiz_response
from app.schemas import AiUsage, GenerateResult, QuizGenerateRequest
from tests.helpers import make_settings


class QuizTests(unittest.TestCase):
    def test_parse_quiz_response_valid(self) -> None:
        raw = '{"questions":[{"question":"Q1","choices":["A","B","C","D"],"answer":"A","explanation":"Because context says so."}]}'
        parsed = parse_quiz_response(raw, 1)
        self.assertEqual(len(parsed["questions"]), 1)

    def test_build_quiz_prompt_contains_rules(self) -> None:
        prompt = build_quiz_prompt(
            class_title="Physics",
            question_count=3,
            instructions="Focus on force",
            blueprint_context="bp",
            material_context="ctx",
        )
        self.assertIn("Question count: 3", prompt["user"])
        self.assertIn("exactly 4 choices", prompt["system"])

    def test_generate_quiz_invokes_provider(self) -> None:
        settings = make_settings()
        req = QuizGenerateRequest(
            class_title="Physics",
            question_count=1,
            instructions="Focus",
            blueprint_context="bp",
            material_context="ctx",
        )
        provider_result = GenerateResult(
            provider="openrouter",
            model="or-model",
            content='{"questions":[{"question":"Q1","choices":["A","B","C","D"],"answer":"A","explanation":"Because context says so."}]}',
            usage=AiUsage(prompt_tokens=1,
                          completion_tokens=2, total_tokens=3),
            latency_ms=120,
        )
        with patch("app.quiz.generate_with_fallback", return_value=provider_result):
            result = generate_quiz(settings, req)

        self.assertEqual(result.model, "or-model")
        self.assertEqual(result.payload["questions"][0]["answer"], "A")


if __name__ == "__main__":
    unittest.main()
