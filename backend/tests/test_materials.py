from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import patch

from app.materials import (
    _coerce_errors,
    _coerce_non_negative_int,
    process_material_jobs,
)
from app.schemas import MaterialProcessRequest
from tests.helpers import make_settings


class MaterialsTests(unittest.TestCase):
    def test_coerce_helpers(self) -> None:
        self.assertEqual(_coerce_non_negative_int("5"), 5)
        self.assertEqual(_coerce_non_negative_int("bad"), 0)
        self.assertEqual(_coerce_errors(["a", " ", 1]), ["a"])

    def test_process_material_jobs_maps_payload(self) -> None:
        settings = make_settings()
        request = MaterialProcessRequest(batch_size=2)

        with patch("app.materials.trigger_material_worker", return_value={
            "processed": "3",
            "succeeded": 2,
            "failed": 1,
            "retried": 0,
            "errors": ["e1"],
        }):
            result = process_material_jobs(settings, request)

        self.assertEqual(result.processed, 3)
        self.assertEqual(result.succeeded, 2)
        self.assertEqual(result.errors, ["e1"])


if __name__ == "__main__":
    unittest.main()
