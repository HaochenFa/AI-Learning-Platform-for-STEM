from __future__ import annotations

import json
from typing import Any

from app.config import Settings
from app.providers import generate_with_fallback
from app.schemas import CanvasRequest, GenerateRequest

CHART_SPEC_SCHEMA = '{"type":"chart","chartType":"bar|line|pie|scatter","title":"string","data":[{"label":"string","value":number}],"xLabel":"string","yLabel":"string"}'

CANVAS_SYSTEM_PROMPTS = {
    "chart": f"""Generate a precise JSON specification for a chart canvas. Return ONLY valid JSON.
Schema: {CHART_SPEC_SCHEMA}
Rules: chartType must match the data (bar for categories, line for trends, pie for proportions, scatter for correlations). Include 3-8 data points. xLabel and yLabel are optional.""",

    "diagram": """Generate a precise JSON specification for a diagram canvas. Return ONLY valid JSON.
Schema: {"type":"diagram","diagramType":"flowchart|concept-map","definition":"string","title":"string"}
Rules: definition must be valid Mermaid.js syntax. Use flowchart TD for flowcharts. Use graph LR for concept maps. Keep diagrams simple (max 8 nodes).""",

    "wave": """Generate a precise JSON specification for a wave simulation canvas. Return ONLY valid JSON.
Schema: {"type":"wave","title":"string","waves":[{"label":"string","amplitude":number,"frequency":number,"color":"string"}]}
Rules: amplitude between 0.1 and 2.0. frequency between 0.1 and 5.0. color must be a valid CSS hex color (e.g. #3b82f6). Include 1-3 waves for comparison.""",

    "vector": """Generate a precise JSON specification for a vector diagram canvas. Return ONLY valid JSON.
Schema: {"type":"vector","title":"string","vectors":[{"label":"string","magnitude":number,"angleDeg":number,"color":"string"}],"gridSize":10}
Rules: magnitude between 0.5 and 5.0. angleDeg between 0 and 360. color must be a valid CSS hex color. Include 1-4 vectors.""",
}


def _strip_fence(raw: str) -> str:
    """Strip markdown code fences from a string if present."""
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return raw


def _require_non_empty_string(value: Any, field_name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"Canvas spec is missing required field: {field_name}")


def _require_number(value: Any, field_name: str) -> None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise RuntimeError(f"Canvas spec field {field_name} must be numeric.")


def validate_canvas_spec(spec: Any, *, expected_type: str | None = None) -> dict[str, Any]:
    if not isinstance(spec, dict):
        raise RuntimeError("Canvas spec generation returned a non-object payload.")

    spec_type = spec.get("type")
    if not isinstance(spec_type, str):
        raise RuntimeError("Canvas spec is missing required field: type")

    if expected_type and spec_type != expected_type:
        raise RuntimeError(f"Canvas spec type mismatch: expected {expected_type}, got {spec_type}")

    _require_non_empty_string(spec.get("title"), "title")

    if spec_type == "chart":
        _require_non_empty_string(spec.get("chartType"), "chartType")
        data = spec.get("data")
        if not isinstance(data, list):
            raise RuntimeError("Canvas spec is missing required field: data")
        for index, point in enumerate(data):
            if not isinstance(point, dict):
                raise RuntimeError(f"Canvas spec field data[{index}] must be an object.")
            _require_non_empty_string(point.get("label"), f"data[{index}].label")
            _require_number(point.get("value"), f"data[{index}].value")
        for optional_field in ("xLabel", "yLabel"):
            value = spec.get(optional_field)
            if value is not None and not isinstance(value, str):
                raise RuntimeError(f"Canvas spec field {optional_field} must be a string.")
        return spec

    if spec_type == "diagram":
        _require_non_empty_string(spec.get("diagramType"), "diagramType")
        _require_non_empty_string(spec.get("definition"), "definition")
        return spec

    if spec_type == "wave":
        waves = spec.get("waves")
        if not isinstance(waves, list):
            raise RuntimeError("Canvas spec is missing required field: waves")
        for index, wave in enumerate(waves):
            if not isinstance(wave, dict):
                raise RuntimeError(f"Canvas spec field waves[{index}] must be an object.")
            _require_non_empty_string(wave.get("label"), f"waves[{index}].label")
            _require_number(wave.get("amplitude"), f"waves[{index}].amplitude")
            _require_number(wave.get("frequency"), f"waves[{index}].frequency")
            _require_non_empty_string(wave.get("color"), f"waves[{index}].color")
        return spec

    if spec_type == "vector":
        vectors = spec.get("vectors")
        if not isinstance(vectors, list):
            raise RuntimeError("Canvas spec is missing required field: vectors")
        for index, vector in enumerate(vectors):
            if not isinstance(vector, dict):
                raise RuntimeError(f"Canvas spec field vectors[{index}] must be an object.")
            _require_non_empty_string(vector.get("label"), f"vectors[{index}].label")
            _require_number(vector.get("magnitude"), f"vectors[{index}].magnitude")
            _require_number(vector.get("angleDeg"), f"vectors[{index}].angleDeg")
            _require_non_empty_string(vector.get("color"), f"vectors[{index}].color")
        grid_size = spec.get("gridSize")
        if grid_size is not None:
            _require_number(grid_size, "gridSize")
        return spec

    raise RuntimeError(f"Unknown canvas spec type: {spec_type}")


def generate_canvas_spec(settings: Settings, request: CanvasRequest) -> dict:
    canvas_type = request.canvas_hint.type
    system_prompt = CANVAS_SYSTEM_PROMPTS.get(canvas_type)
    if not system_prompt:
        raise RuntimeError(f"Unknown canvas type: {canvas_type}")

    user_prompt = "\n".join([
        f"Canvas type: {canvas_type}",
        f"Concept to visualize: {request.canvas_hint.concept}",
        f"Canvas title: {request.canvas_hint.title}",
        f"Student question: {request.student_question[:500]}",
        f"AI answer: {request.ai_answer[:1500]}",
        "",
        "Generate the JSON specification now.",
    ])

    result = generate_with_fallback(
        settings,
        GenerateRequest(
            system=system_prompt,
            user=user_prompt,
            temperature=0.3,
            max_tokens=1000,
            timeout_ms=20000,
        ),
    )

    raw = _strip_fence(result.content.strip())
    if not raw:
        raise RuntimeError("Canvas spec generation returned an empty response from the provider.")

    try:
        spec = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Canvas spec generation returned invalid JSON: {exc}") from exc

    return validate_canvas_spec(spec, expected_type=canvas_type)
