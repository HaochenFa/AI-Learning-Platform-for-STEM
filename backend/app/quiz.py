from __future__ import annotations

import json
from typing import Any

from app.config import Settings
from app.providers import generate_with_fallback
from app.schemas import GenerateRequest, QuizGenerateRequest, QuizGenerateResult

QUALITY_PROFILE = "quality_v1"
GROUNDING_MODE = "balanced"


def generate_quiz(settings: Settings, request: QuizGenerateRequest) -> QuizGenerateResult:
    prompt = build_quiz_prompt(
        class_title=request.class_title,
        question_count=request.question_count,
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
    payload = parse_quiz_response(result.content, request.question_count)
    return QuizGenerateResult(
        payload=payload,
        provider=result.provider,
        model=result.model,
        usage=result.usage,
        latency_ms=result.latency_ms,
    )


def build_quiz_prompt(
    *,
    class_title: str,
    question_count: int,
    instructions: str,
    blueprint_context: str,
    material_context: str,
) -> dict[str, str]:
    system = " ".join(
        [
            "You are an expert STEM assessment designer.",
            "Generate only valid JSON with deterministic structure.",
            "Use only the provided blueprint/material context for content and explanations.",
            "Questions must be multiple choice with exactly 4 choices and exactly one correct answer.",
            "Distractors must be plausible and non-trivial.",
            f"Quality profile: {QUALITY_PROFILE}.",
            f"Grounding mode: {GROUNDING_MODE}.",
        ]
    )

    user = "\n".join(
        [
            f"Class: {class_title}",
            f"Question count: {question_count}",
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
            "2) Mix cognitive demand levels (recall, understanding, application, analysis) based on available context.",
            "3) Avoid duplicate or near-duplicate question stems.",
            "4) Explanations must justify the correct answer using class context, not generic trivia.",
            "",
            "Return JSON using this exact shape:",
            "{",
            '  "questions": [',
            "    {",
            '      "question": "string",',
            '      "choices": ["string", "string", "string", "string"],',
            '      "answer": "string",',
            '      "explanation": "string"',
            "    }",
            "  ]",
            "}",
            "",
            "Rules:",
            "- No markdown.",
            "- No additional top-level keys.",
            "- `answer` must exactly match one item in `choices`.",
            "- Avoid weak distractors such as 'all of the above' or 'none of the above'.",
        ]
    )
    return {"system": system, "user": user}


def parse_quiz_response(raw: str, question_count: int) -> dict[str, Any]:
    not_found_message = "No JSON object found in quiz generation response."
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
            raise RuntimeError("Quiz generation response is not valid JSON.")
        raise RuntimeError(not_found_message)

    best_errors: list[str] = []
    best_payload: dict[str, Any] | None = None
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        payload = {"questions": (candidate.get("questions") if isinstance(candidate.get("questions"), list) else [])[:20]}
        ok, normalized, errors = validate_quiz_payload(payload, question_count)
        if ok and normalized:
            if not best_payload or len(normalized["questions"]) > len(best_payload["questions"]):
                best_payload = normalized
            continue
        if not best_errors or len(errors) < len(best_errors):
            best_errors = errors

    if best_payload:
        return best_payload

    raise RuntimeError(
        f"Invalid quiz JSON: {'; '.join(best_errors) if best_errors else 'Payload could not be validated.'}"
    )


def validate_quiz_payload(
    payload: dict[str, Any], question_count: int
) -> tuple[bool, dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    questions = payload.get("questions")
    if not isinstance(questions, list) or len(questions) == 0:
        errors.append("questions must be a non-empty array.")
        return False, None, errors

    normalized_questions: list[dict[str, Any]] = []
    seen_stems: set[str] = set()
    for index, item in enumerate(questions):
        if not isinstance(item, dict):
            errors.append(f"questions[{index}] must be an object.")
            continue
        question = normalize_text(item.get("question"))
        explanation = normalize_text(item.get("explanation"))
        answer = normalize_text(item.get("answer"))
        choices_raw = item.get("choices")
        if not question:
            errors.append(f"questions[{index}].question is required.")
        if not explanation:
            errors.append(f"questions[{index}].explanation is required.")
        if not answer:
            errors.append(f"questions[{index}].answer is required.")
        if not isinstance(choices_raw, list) or len(choices_raw) != 4:
            errors.append(f"questions[{index}].choices must contain exactly 4 options.")
            continue

        choices: list[str] = []
        for choice in choices_raw:
            text = normalize_text(choice)
            if not text:
                errors.append(f"questions[{index}].choices contains an empty option.")
            choices.append(text)
        if len(set(choices)) != 4:
            errors.append(f"questions[{index}].choices must be unique.")
        if answer and answer not in choices:
            errors.append(f"questions[{index}].answer must match one choice.")

        normalized_stem = " ".join(question.lower().split())
        if normalized_stem in seen_stems:
            errors.append("questions contain duplicate or near-duplicate stems.")
        seen_stems.add(normalized_stem)

        normalized_questions.append(
            {
                "question": question,
                "choices": choices,
                "answer": answer,
                "explanation": explanation,
            }
        )

    trimmed = normalized_questions[: max(1, question_count)]
    if not trimmed:
        errors.append("No valid questions were generated.")
    if errors:
        return False, None, errors
    return True, {"questions": trimmed}, errors


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
                candidates.append(raw[start_index : index + 1])
                start_index = -1
    return candidates


def normalize_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()
