from __future__ import annotations

import json

from app.config import Settings
from app.providers import generate_with_fallback
from app.schemas import CanvasRequest, GenerateRequest

CANVAS_SYSTEM_PROMPTS = {
    "chart": """Generate a precise JSON specification for a chart canvas. Return ONLY valid JSON.
Schema: {"type":"chart","chartType":"bar|line|pie|scatter","title":"string","data":[{"label":"string","value":number}],"xLabel":"string","yLabel":"string"}
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

    if not isinstance(spec, dict) or spec.get("type") != canvas_type:
        raise RuntimeError(f"Canvas spec type mismatch: expected {canvas_type}, got {spec.get('type')}")

    return spec
