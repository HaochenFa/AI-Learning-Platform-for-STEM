from __future__ import annotations

import json
from typing import Any

from app.config import Settings
from app.providers import generate_with_fallback
from app.schemas import GenerateRequest, QuizGenerateRequest, QuizGenerateResult

QUALITY_PROFILE = "quality_v1"  # injected into the system prompt so the model applies stricter output rules
GROUNDING_MODE = "balanced"     # instructs the model to blend blueprint topics and material context equally


def generate_quiz(settings: Settings, request: QuizGenerateRequest) -> QuizGenerateResult:
    """Orchestrate end-to-end quiz generation: build prompt, call AI, validate response.

    Uses a low temperature (0.2) to favour deterministic, factually grounded output
    over creative variation. The AI response is parsed and validated before returning,
    so callers receive a clean payload or a RuntimeError with actionable detail.

    Args:
        settings: Application configuration including provider credentials.
        request: Validated quiz generation parameters from the API layer.

    Returns:
        QuizGenerateResult containing a "questions" list payload, provider metadata,
        and token usage. Each question matches the QuizGeneratedQuestion shape.

    Raises:
        RuntimeError: If the AI response cannot be parsed into valid quiz JSON.
    """
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
            temperature=0.2,   # low temperature: maximise factual consistency for assessments
            max_tokens=8000,   # generous ceiling — 20 questions × ~400 tokens each with explanation
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
    """Construct the system and user prompt strings for quiz generation.

    The system prompt establishes the model persona and hard constraints (JSON-only,
    exactly 4 choices, no weak distractors). The user prompt injects the class context
    and prescribes generation objectives to encourage balanced topic and cognitive-level
    coverage. Both strings are assembled via join to keep the code readable and diff-friendly.

    Blueprint context is placed before material context so the model treats the approved
    blueprint as the authoritative scope and uses materials purely for evidence.

    Args:
        class_title: Display name of the class, added to ground the model in subject matter.
        question_count: Requested number of questions; injected as an explicit constraint.
        instructions: Teacher-authored guidance that can tighten or relax generation rules.
        blueprint_context: Serialised published blueprint (topics, objectives).
        material_context: Retrieved material snippets used for grounding explanations.

    Returns:
        A dict with keys "system" and "user", each a single string ready for the AI provider.
    """
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
    """Extract, validate, and normalise a quiz JSON payload from a raw AI response string.

    Models sometimes wrap JSON in prose or code fences, so parsing is multi-stage:
    first attempt a direct parse if the response looks like bare JSON, then fall back
    to brace-balanced extraction to locate embedded JSON objects. Among all valid
    candidates the one with the most questions is preferred, giving the best chance of
    meeting the teacher's requested count.

    Args:
        raw: Raw text content from the AI provider.
        question_count: Requested number of questions; used to trim and validate the result.

    Returns:
        A dict with key "questions" containing a list of validated question objects.

    Raises:
        RuntimeError: If no parseable or valid quiz JSON can be extracted from the response.
    """
    not_found_message = "No JSON object found in quiz generation response."
    normalized_raw = raw.strip()

    # --- 1. Attempt direct parse when response appears to be bare JSON ---
    candidates: list[Any] = []
    direct_json_parse_failed = False
    if normalized_raw.startswith("{") and normalized_raw.endswith("}"):
        try:
            candidates.append(json.loads(normalized_raw))
        except json.JSONDecodeError:
            # Track failure so we can give a more specific error if extraction also finds nothing
            direct_json_parse_failed = True

    # --- 2. Scan for embedded JSON objects (handles prose + code-fence wrapping) ---
    for candidate in extract_json_object_candidates(raw):
        try:
            candidates.append(json.loads(candidate))
        except json.JSONDecodeError:
            continue

    if not candidates:
        if direct_json_parse_failed:
            raise RuntimeError("Quiz generation response is not valid JSON.")
        raise RuntimeError(not_found_message)

    # --- 3. Validate each candidate; keep the one with the most valid questions ---
    best_errors: list[str] = []
    best_payload: dict[str, Any] | None = None
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        questions_raw = candidate.get("questions")
        questions = questions_raw if isinstance(questions_raw, list) else []
        payload = {"questions": questions[:20]}  # hard cap matches QuizGenerateRequest.question_count max
        ok, normalized, errors = validate_quiz_payload(payload, question_count)
        if ok:
            if normalized is None:
                continue
            # Prefer the candidate that produced more valid questions
            if not best_payload or len(normalized["questions"]) > len(best_payload["questions"]):
                best_payload = normalized
            continue
        # Track the candidate with fewest validation errors as the best diagnostic
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
    """Validate and normalise a parsed quiz payload dict.

    Checks structural correctness (required fields, exactly 4 choices, answer in choices)
    and content quality (no duplicate stems, no empty options). Questions that pass all
    checks are collected into a normalised list, which is then trimmed to question_count.
    At least one valid question is always required even if question_count would allow zero.

    Args:
        payload: Dict expected to contain a "questions" list of MCQ objects.
        question_count: Maximum questions to return; excess valid questions are discarded.

    Returns:
        A 3-tuple of (ok, normalised_payload, errors). When ok is True, normalised_payload
        is a dict with a "questions" key and errors is an empty list. When ok is False,
        normalised_payload is None and errors lists every validation problem found.
    """
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
            # Cannot continue validating this question without exactly 4 choices
            errors.append(
                f"questions[{index}].choices must contain exactly 4 options.")
            continue

        choices: list[str] = []
        for choice in choices_raw:
            text = normalize_text(choice)
            if not text:
                errors.append(
                    f"questions[{index}].choices contains an empty option.")
            choices.append(text)
        if len(set(choices)) != 4:
            errors.append(f"questions[{index}].choices must be unique.")
        if answer and answer not in choices:
            errors.append(f"questions[{index}].answer must match one choice.")

        # Deduplicate by collapsing whitespace on lowercased stem — catches near-duplicates
        normalized_stem = " ".join(question.lower().split())
        if normalized_stem in seen_stems:
            errors.append(
                "questions contain duplicate or near-duplicate stems.")
        seen_stems.add(normalized_stem)

        normalized_questions.append(
            {
                "question": question,
                "choices": choices,
                "answer": answer,
                "explanation": explanation,
            }
        )

    # Enforce max(1, ...) so an empty trimmed list is always an error, not silent success
    trimmed = normalized_questions[: max(1, question_count)]
    if not trimmed:
        errors.append("No valid questions were generated.")
    if errors:
        return False, None, errors
    return True, {"questions": trimmed}, errors


def extract_json_object_candidates(raw: str) -> list[str]:
    """Scan a string for top-level JSON object substrings using brace-depth tracking.

    Handles escaped characters inside strings to avoid mistaking a literal brace in a
    JSON string value for a structural brace. Returns all balanced {…} substrings found,
    which are then individually attempted by json.loads in the caller.

    Args:
        raw: Arbitrary text that may contain one or more JSON objects, optionally
             surrounded by prose, markdown, or code fences.

    Returns:
        List of candidate substrings, each starting with "{" and ending with the
        matching "}". May be empty if no balanced objects are found.
    """
    candidates: list[str] = []
    depth = 0
    start_index = -1
    in_string = False
    escape = False
    for index, char in enumerate(raw):
        if in_string:
            if escape:
                escape = False  # previous backslash consumed — this char is literal
            elif char == "\\":
                escape = True   # next char is escaped; do not interpret it structurally
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char == "{":
            if depth == 0:
                start_index = index  # mark the beginning of a new top-level object
            depth += 1
            continue
        if char == "}":
            if depth == 0:
                continue  # unmatched closing brace — skip (malformed input guard)
            depth -= 1
            if depth == 0 and start_index >= 0:
                candidates.append(raw[start_index: index + 1])
                start_index = -1
    return candidates


def normalize_text(value: Any) -> str:
    """Coerce a field value to a stripped string, returning empty string for non-string types.

    Args:
        value: Raw value from a parsed JSON object field.

    Returns:
        Stripped string, or "" if value is not a str.
    """
    if not isinstance(value, str):
        return ""
    return value.strip()
