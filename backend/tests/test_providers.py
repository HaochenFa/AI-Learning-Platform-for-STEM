from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import patch

from app.providers import (
    _normalize_chat_content,
    _resolve_provider_order,
    generate_with_fallback,
)
from app.schemas import GenerateRequest, GenerateResult
from tests.helpers import make_settings


class ProvidersTests(unittest.TestCase):
    def test_normalize_chat_content(self) -> None:
        self.assertEqual(_normalize_chat_content("hello"), "hello")
        self.assertEqual(_normalize_chat_content({"text": "hello"}), "hello")
        self.assertEqual(_normalize_chat_content([{"text": "a"}, "b"]), "ab")

    def test_resolve_provider_order_prioritizes_default(self) -> None:
        settings = make_settings(openai_api_key="oa", openai_model="gpt")
        order = _resolve_provider_order(settings, requested_order=[
                                        "openai", "openrouter"], requested_default="openrouter", for_embeddings=False)
        self.assertEqual(order[0], "openrouter")

    def test_generate_with_fallback_uses_second_provider(self) -> None:
        settings = make_settings(openai_api_key="oa", openai_model="gpt")
        request = GenerateRequest(system="s", user="u")

        expected = GenerateResult(
            provider="openai", model="gpt", content="{}", usage=None, latency_ms=1)
        with patch("app.providers._resolve_provider_order", return_value=["openrouter", "openai"]), patch(
            "app.providers._generate_with_provider",
            side_effect=[RuntimeError("first failed"), expected],
        ):
            result = generate_with_fallback(settings, request)

        self.assertEqual(result.provider, "openai")


if __name__ == "__main__":
    unittest.main()
