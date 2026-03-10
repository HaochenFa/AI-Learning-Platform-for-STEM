from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import os
import unittest
from unittest.mock import patch

from app import config


class ConfigTests(unittest.TestCase):
    def test_get_bool_and_int_helpers(self) -> None:
        with patch.dict(os.environ, {"BOOL_X": "yes", "INT_X": "42"}, clear=False):
            self.assertTrue(config._get_bool("BOOL_X", False))
            self.assertEqual(config._get_int("INT_X", 1), 42)

        with patch.dict(os.environ, {"BOOL_X": "no", "INT_X": "invalid"}, clear=False):
            self.assertFalse(config._get_bool("BOOL_X", True))
            self.assertEqual(config._get_int("INT_X", 7), 7)

    def test_get_settings_reads_env(self) -> None:
        with patch.dict(
            os.environ,
            {
                "PYTHON_BACKEND_API_KEY": "abc",
                "PYTHON_BACKEND_ALLOW_UNAUTHENTICATED_REQUESTS": "true",
                "AI_PROVIDER_DEFAULT": "OpenRouter",
                "SUPABASE_URL": "https://db.example",
                "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "pk",
                "SUPABASE_SERVICE_ROLE_KEY": "srk",
                "MATERIAL_WORKER_BATCH": "5",
            },
            clear=False,
        ):
            settings = config.get_settings()

        self.assertEqual(settings.python_backend_api_key, "abc")
        self.assertTrue(settings.python_backend_allow_unauthenticated_requests)
        self.assertEqual(settings.ai_provider_default, "openrouter")
        self.assertEqual(settings.supabase_url, "https://db.example")
        self.assertEqual(settings.supabase_publishable_key, "pk")
        self.assertEqual(settings.supabase_service_role_key, "srk")
        self.assertEqual(settings.material_worker_batch, 5)


if __name__ == "__main__":
    unittest.main()
