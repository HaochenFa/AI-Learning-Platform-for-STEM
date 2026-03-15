from __future__ import annotations

import json
from typing import Any

from app.config import Settings
from app.providers import generate_with_fallback
from app.schemas import FlashcardsGenerateRequest, FlashcardsGenerateResult, GenerateRequest

QUALITY_PROFILE = "quality_v1"
GROUNDING_MODE = "balanced"


def generate_flashcards(
    settings: Settings, request: FlashcardsGenerateRequest
) -> FlashcardsGenerateResult:
    prompt = build_flashcards_prompt(
        class_title=request.class_title,
        card_count=request.card_count,
        instructions=request.instructions,
        blueprint_context=request.blueprint_context,
        material_context=request.material_context,
    )
    result = generate_with_fallback(
        settings,
        GenerateRequest(
            system=prompt["system"],
            user=prompt["user"],
            temperature=0.2,
            max_tokens=8000,
            timeout_ms=request.timeout_ms,
        ),
    )
    payload = parse_flashcards_response(result.content, request.card_count)
    return FlashcardsGenerateResult(
        payload=payload,
        provider=result.provider,
        model=result.model,
        usage=result.usage,
        latency_ms=result.latency_ms,
    )


def build_flashcards_prompt(
    *,
    class_title: str,
    card_count: int,
    instructions: str,
    blueprint_context: str,
    material_context: str,
) -> dict[str, str]:
    system = " ".join(
        [
            "You are an expert STEM learning designer.",
            "Generate only valid JSON with deterministic structure.",
            "Use only the provided blueprint/material context for content.",
            "Each flashcard must have a concise front and a clear, grounded back.",
            f"Quality profile: {QUALITY_PROFILE}.",
            f"Grounding mode: {GROUNDING_MODE}.",
        ]
    )

    user = "\n".join(
        [
            f"Class: {class_title}",
            f"Card count: {card_count}",
            f"Teacher instructions: {instructions}",
            "",
            "Published blueprint context:",
            blueprint_context or "No blueprint context provided.",
            "",
            "Retrieved class material context:",
            material_context or "No material context provided.",
            "",
            "Generation objectives:",
            "1) Cover multiple blueprint topics/objectives when possible.",
            "2) Keep fronts short and prompt-like.",
            "3) Keep backs precise and grounded in class context.",
            "4) Avoid duplicates or near-duplicates.",
            "",
            "Return JSON using this exact shape:",
            "{",
            '  "cards": [',
            "    {",
            '      "front": "string",',
            '      "back": "string"',
            "    }",
            "  ]",
            "}",
            "",
            "Rules:",
            "- No markdown.",
            "- No additional top-level keys.",
            "- Avoid overly long backs; keep them focused.",
        ]
    )
    return {"system": system, "user": user}


def parse_flashcards_response(raw: str, card_count: int) -> dict[str, Any]:
    not_found_message = "No JSON object found in flashcards generation response."
    normalized_raw = raw.strip()

    candidates: list[Any] = []
    direct_json_parse_failed = False
    if normalized_raw.startswith("{") and normalized_raw.endswith("}"):
        try:
            candidates.append(json.loads(normalized_raw))
        except json.JSONDecodeError:
            direct_json_parse_failed = True

    for candidate in extract_json_object_candidates(raw):
        try:
            candidates.append(json.loads(candidate))
        except json.JSONDecodeError:
            continue

    if not candidates:
        if direct_json_parse_failed:
            raise RuntimeError(
                "Flashcards generation response is not valid JSON.")
        raise RuntimeError(not_found_message)

    best_errors: list[str] = []
    best_payload: dict[str, Any] | None = None
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        cards_raw = candidate.get("cards")
        cards = cards_raw if isinstance(cards_raw, list) else []
        payload = {"cards": cards[:30]}
        ok, normalized, errors = validate_flashcards_payload(
            payload, card_count)
        if ok:
            if normalized is None:
                continue
            if not best_payload or len(normalized["cards"]) > len(best_payload["cards"]):
                best_payload = normalized
            continue
        if not best_errors or len(errors) < len(best_errors):
            best_errors = errors

    if best_payload:
        return best_payload

    raise RuntimeError(
        "Invalid flashcards JSON: "
        + ("; ".join(best_errors) if best_errors else "Payload could not be validated.")
    )


def validate_flashcards_payload(
    payload: dict[str, Any], card_count: int
) -> tuple[bool, dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    cards = payload.get("cards")
    if not isinstance(cards, list) or len(cards) == 0:
        errors.append("cards must be a non-empty array.")
        return False, None, errors

    normalized_cards: list[dict[str, str]] = []
    front_set: set[str] = set()
    for index, item in enumerate(cards):
        if not isinstance(item, dict):
            errors.append(f"cards[{index}] must be an object.")
            continue

        front = normalize_text(item.get("front"))
        back = normalize_text(item.get("back"))
        if not front:
            errors.append(f"cards[{index}].front is required.")
        if not back:
            errors.append(f"cards[{index}].back is required.")
        elif word_count(back) < 3:
            errors.append(f"cards[{index}].back must be at least 3 words.")

        normalized_front = normalize_for_dedup(front)
        if normalized_front in front_set:
            errors.append(f"cards[{index}].front duplicates an earlier front.")
        front_set.add(normalized_front)

        normalized_cards.append({"front": front, "back": back})

    trimmed = normalized_cards[: max(1, card_count)]
    if not trimmed:
        errors.append("No valid cards were generated.")
    if errors:
        return False, None, errors
    return True, {"cards": trimmed}, errors


def extract_json_object_candidates(raw: str) -> list[str]:
    candidates: list[str] = []
    depth = 0
    start_index = -1
    in_string = False
    escape = False
    for index, char in enumerate(raw):
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char == "{":
            if depth == 0:
                start_index = index
            depth += 1
            continue
        if char == "}":
            if depth == 0:
                continue
            depth -= 1
            if depth == 0 and start_index >= 0:
                candidates.append(raw[start_index: index + 1])
                start_index = -1
    return candidates


def normalize_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def normalize_for_dedup(value: str) -> str:
    return " ".join(
        "".join(char.lower() if char.isalnum() or char.isspace()
                else " " for char in value).split()
    )


def word_count(value: str) -> int:
    stripped = value.strip()
    if not stripped:
        return 0
    return len(stripped.split())
