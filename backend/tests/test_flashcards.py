from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import patch

from app.flashcards import build_flashcards_prompt, generate_flashcards, parse_flashcards_response
from app.schemas import AiUsage, FlashcardsGenerateRequest, GenerateResult
from tests.helpers import make_settings


class FlashcardsTests(unittest.TestCase):
    def test_parse_flashcards_response_valid(self) -> None:
        raw = '{"cards":[{"front":"Term","back":"A grounded explanation here"}]}'
        parsed = parse_flashcards_response(raw, 1)
        self.assertEqual(len(parsed["cards"]), 1)

    def test_build_flashcards_prompt_contains_card_count(self) -> None:
        prompt = build_flashcards_prompt(
            class_title="Biology",
            card_count=2,
            instructions="Key terms",
            blueprint_context="bp",
            material_context="ctx",
        )
        self.assertIn("Card count: 2", prompt["user"])
        self.assertIn("deterministic structure", prompt["system"])

    def test_generate_flashcards_invokes_provider(self) -> None:
        settings = make_settings()
        req = FlashcardsGenerateRequest(
            class_title="Biology",
            card_count=1,
            instructions="Key terms",
            blueprint_context="bp",
            material_context="ctx",
        )
        provider_result = GenerateResult(
            provider="openrouter",
            model="or-model",
            content='{"cards":[{"front":"Term","back":"A grounded explanation here"}]}',
            usage=AiUsage(prompt_tokens=1,
                          completion_tokens=2, total_tokens=3),
            latency_ms=99,
        )
        with patch("app.flashcards.generate_with_fallback", return_value=provider_result):
            result = generate_flashcards(settings, req)

        self.assertEqual(result.provider, "openrouter")
        self.assertEqual(result.payload["cards"][0]["front"], "Term")


if __name__ == "__main__":
    unittest.main()
