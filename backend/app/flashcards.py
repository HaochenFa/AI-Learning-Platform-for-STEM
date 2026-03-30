from __future__ import annotations

import json
from typing import Any

from app.config import Settings
from app.providers import generate_with_fallback
from app.schemas import FlashcardsGenerateRequest, FlashcardsGenerateResult, GenerateRequest

QUALITY_PROFILE = "quality_v1"  # injected into the system prompt to enforce structured output standards
GROUNDING_MODE = "balanced"     # instructs the model to blend blueprint topics and material context equally


def generate_flashcards(
    settings: Settings, request: FlashcardsGenerateRequest
) -> FlashcardsGenerateResult:
    """Orchestrate end-to-end flashcard generation: build prompt, call AI, validate response.

    Uses a low temperature (0.2) so that card backs are factually stable and consistent
    with the class materials. The AI response is parsed and validated before returning,
    so callers receive a clean payload or a RuntimeError with actionable detail.

    Args:
        settings: Application configuration including provider credentials.
        request: Validated flashcard generation parameters from the API layer.

    Returns:
        FlashcardsGenerateResult containing a "cards" list payload, provider metadata,
        and token usage. Each card matches the FlashcardsGeneratedCard shape
        (front: short prompt, back: grounded explanation of at least 3 words).

    Raises:
        RuntimeError: If the AI response cannot be parsed into valid flashcard JSON.
    """
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
            temperature=0.2,   # low temperature: maximise factual consistency for study material
            max_tokens=8000,   # generous ceiling — 30 cards × ~260 tokens each (front + back)
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
    """Construct the system and user prompt strings for flashcard generation.

    The system prompt establishes the model persona and output constraints (JSON-only,
    concise fronts, grounded backs). The user prompt injects class context and generation
    objectives designed to spread cards across blueprint topics and prevent duplicates.

    Blueprint context is listed before material context so the model treats the approved
    blueprint topic list as the primary driver of card subjects, with materials supplying
    supporting evidence for the backs.

    Args:
        class_title: Display name of the class; grounds the model in subject matter.
        card_count: Requested number of cards; injected as an explicit generation constraint.
        instructions: Teacher-authored guidance that can focus or restrict generation.
        blueprint_context: Serialised published blueprint (topics, objectives) that drives
            topic coverage for the front of each card.
        material_context: Retrieved material snippets used to ground the back of each card
            in actual class content.

    Returns:
        A dict with keys "system" and "user", each a single string ready for the AI provider.
    """
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
    """Extract, validate, and normalise a flashcard JSON payload from a raw AI response string.

    Models sometimes wrap JSON in prose or code fences, so parsing is multi-stage:
    first attempt a direct parse if the response looks like bare JSON, then fall back
    to brace-balanced extraction to locate embedded JSON objects. Among all valid
    candidates the one with the most cards is preferred, giving the best chance of
    meeting the teacher's requested count.

    Args:
        raw: Raw text content from the AI provider.
        card_count: Requested number of cards; used to trim and validate the result.

    Returns:
        A dict with key "cards" containing a list of validated card objects,
        each with "front" and "back" string fields.

    Raises:
        RuntimeError: If no parseable or valid flashcard JSON can be extracted from the response.
    """
    not_found_message = "No JSON object found in flashcards generation response."
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
            raise RuntimeError(
                "Flashcards generation response is not valid JSON.")
        raise RuntimeError(not_found_message)

    # --- 3. Validate each candidate; keep the one with the most valid cards ---
    best_errors: list[str] = []
    best_payload: dict[str, Any] | None = None
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        cards_raw = candidate.get("cards")
        cards = cards_raw if isinstance(cards_raw, list) else []
        payload = {"cards": cards[:30]}  # hard cap matches FlashcardsGenerateRequest.card_count max
        ok, normalized, errors = validate_flashcards_payload(
            payload, card_count)
        if ok:
            if normalized is None:
                continue
            # Prefer the candidate that produced more valid cards
            if not best_payload or len(normalized["cards"]) > len(best_payload["cards"]):
                best_payload = normalized
            continue
        # Track the candidate with fewest validation errors as the best diagnostic
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
    """Validate and normalise a parsed flashcard payload dict.

    Checks that every card has a non-empty front and a back of at least 3 words (to
    prevent trivially short answers), and that no two fronts are near-duplicates. Cards
    that pass all checks are collected into a normalised list, which is then trimmed to
    card_count. At least one valid card is always required even if card_count would
    allow zero.

    Args:
        payload: Dict expected to contain a "cards" list of front/back objects.
        card_count: Maximum cards to return; excess valid cards are discarded.

    Returns:
        A 3-tuple of (ok, normalised_payload, errors). When ok is True, normalised_payload
        is a dict with a "cards" key and errors is an empty list. When ok is False,
        normalised_payload is None and errors lists every validation problem found.
    """
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
            # Minimum 3 words enforces a meaningful explanation rather than a single-word answer
            errors.append(f"cards[{index}].back must be at least 3 words.")

        # Deduplicate fronts using an alphanumeric-only normalised form to catch near-duplicates
        normalized_front = normalize_for_dedup(front)
        if normalized_front in front_set:
            errors.append(f"cards[{index}].front duplicates an earlier front.")
        front_set.add(normalized_front)

        normalized_cards.append({"front": front, "back": back})

    # Enforce max(1, ...) so an empty trimmed list is always an error, not silent success
    trimmed = normalized_cards[: max(1, card_count)]
    if not trimmed:
        errors.append("No valid cards were generated.")
    if errors:
        return False, None, errors
    return True, {"cards": trimmed}, errors


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


def normalize_for_dedup(value: str) -> str:
    """Produce a normalised key for near-duplicate detection by keeping only alphanumerics.

    Strips punctuation and collapses whitespace so that "Newton's 1st Law" and
    "Newtons 1st Law" are treated as the same front.

    Args:
        value: Raw front text of a flashcard.

    Returns:
        Lowercase alphanumeric-only string with single spaces between words.
    """
    return " ".join(
        "".join(char.lower() if char.isalnum() or char.isspace()
                else " " for char in value).split()
    )


def word_count(value: str) -> int:
    """Count whitespace-delimited words in a string.

    Args:
        value: Text to count words in.

    Returns:
        Number of words; 0 for empty or whitespace-only strings.
    """
    stripped = value.strip()
    if not stripped:
        return 0
    return len(stripped.split())
