from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest

from app.canvas import validate_canvas_spec


class CanvasSpecValidationTests(unittest.TestCase):
    def test_accepts_valid_chart_spec(self) -> None:
        spec = {
            "type": "chart",
            "chartType": "bar",
            "title": "Topic Scores",
            "data": [
                {"label": "Kinematics", "value": 82},
                {"label": "Dynamics", "value": 76},
            ],
        }

        self.assertEqual(validate_canvas_spec(spec, expected_type="chart"), spec)

    def test_rejects_vector_spec_missing_vectors(self) -> None:
        with self.assertRaises(RuntimeError) as error:
            validate_canvas_spec(
                {
                    "type": "vector",
                    "title": "Net Force",
                },
                expected_type="vector",
            )

        self.assertIn("vectors", str(error.exception))

    def test_rejects_diagram_spec_missing_definition(self) -> None:
        with self.assertRaises(RuntimeError) as error:
            validate_canvas_spec(
                {
                    "type": "diagram",
                    "diagramType": "flowchart",
                    "title": "Energy Flow",
                },
                expected_type="diagram",
            )

        self.assertIn("definition", str(error.exception))


if __name__ == "__main__":
    unittest.main()
