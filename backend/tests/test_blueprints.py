from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import patch

from app.blueprints import (
    build_blueprint_prompt,
    generate_blueprint,
    parse_blueprint_response,
)
from app.schemas import AiUsage, BlueprintGenerateRequest, GenerateResult
from tests.helpers import make_settings


class BlueprintsTests(unittest.TestCase):
    def test_build_prompt_contains_materials(self) -> None:
        prompt = build_blueprint_prompt(
            class_title="Calculus",
            subject="Math",
            level="College",
            material_count=2,
            material_text="Source 1\\nLimits notes",
        )
        self.assertIn("Class: Calculus", prompt["user"])
        self.assertIn("Return one JSON object", prompt["user"])

    def test_parse_blueprint_response_valid(self) -> None:
        raw = '{"summary":"S","topics":[{"key":"limits","title":"Limits","sequence":1,"prerequisites":[],"objectives":[{"statement":"Define limit","level":"understand","evidence":[]}],"assessmentIdeas":["Quiz"],"evidence":[]}]} '
        parsed = parse_blueprint_response(raw)
        self.assertEqual(parsed["schemaVersion"], "v2")
        self.assertEqual(len(parsed["topics"]), 1)

    def test_parse_blueprint_response_rejects_empty_assessment_ideas(self) -> None:
        raw = '{"summary":"S","topics":[{"key":"limits","title":"Limits","sequence":1,"prerequisites":[],"objectives":[{"statement":"Define limit","level":"understand","evidence":[]}],"assessmentIdeas":[],"evidence":[]}]} '
        with self.assertRaisesRegex(RuntimeError, "assessmentIdeas must be non-empty"):
            parse_blueprint_response(raw)

    def test_generate_blueprint_uses_provider(self) -> None:
        settings = make_settings()
        req = BlueprintGenerateRequest(
            class_title="Calculus",
            subject="Math",
            level="College",
            material_count=1,
            material_text="Source 1\\nLimits",
        )
        provider_result = GenerateResult(
            provider="openrouter",
            model="or-model",
            content='{"summary":"S","topics":[{"key":"limits","title":"Limits","sequence":1,"prerequisites":[],"objectives":[{"statement":"Define limit","level":"understand","evidence":[]}],"assessmentIdeas":["Quiz"],"evidence":[]}]}',
            usage=AiUsage(prompt_tokens=1,
                          completion_tokens=2, total_tokens=3),
            latency_ms=100,
        )
        with patch("app.blueprints.generate_with_fallback", return_value=provider_result):
            result = generate_blueprint(settings, req)

        self.assertEqual(result.provider, "openrouter")
        self.assertIn("topics", result.payload)


if __name__ == "__main__":
    unittest.main()
