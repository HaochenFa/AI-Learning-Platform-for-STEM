from __future__ import annotations

import json
import re
from typing import Any

from app.config import Settings
from app.providers import generate_with_fallback
from app.schemas import BlueprintGenerateRequest, BlueprintGenerateResult, GenerateRequest

DEFAULT_BLUEPRINT_SCHEMA_VERSION = "v2"
DEFAULT_AI_PROMPT_QUALITY_PROFILE = "quality_v1"
DEFAULT_AI_GROUNDING_MODE = "balanced"


def generate_blueprint(settings: Settings, request: BlueprintGenerateRequest) -> BlueprintGenerateResult:
    prompt = build_blueprint_prompt(
        class_title=request.class_title,
        subject=request.subject,
        level=request.level,
        material_count=request.material_count,
        material_text=request.material_text,
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
    payload = parse_blueprint_response(result.content)
    return BlueprintGenerateResult(
        payload=payload,
        provider=result.provider,
        model=result.model,
        usage=result.usage,
        latency_ms=result.latency_ms,
    )


def build_blueprint_prompt(
    *,
    class_title: str,
    subject: str | None,
    level: str | None,
    material_count: int,
    material_text: str,
) -> dict[str, str]:
    system = " ".join(
        [
            "You are an expert curriculum designer for high school and college STEM courses.",
            "Produce a deterministic, deeply structured class blueprint grounded only in provided class materials.",
            "Never hallucinate content that cannot be tied to the retrieved context.",
            "Return JSON only. No markdown, no prose outside JSON, no code fences.",
            "Use Bloom levels exactly from this set: remember, understand, apply, analyze, evaluate, create.",
            "All prerequisite links must form a DAG and reference existing topic keys.",
            f"Quality profile: {DEFAULT_AI_PROMPT_QUALITY_PROFILE}.",
            f"Grounding mode: {DEFAULT_AI_GROUNDING_MODE}.",
        ]
    )

    user = "\n".join(
        [
            f"Class: {class_title}",
            f"Subject: {subject or 'STEM'}",
            f"Level: {level or 'Mixed high school/college'}",
            f"Materials provided: {material_count}",
            "",
            "Return one JSON object with this exact top-level shape and no additional top-level keys:",
            "{",
            '  "schemaVersion": "v2",',
            '  "summary": "string",',
            '  "assumptions": ["string"],',
            '  "uncertaintyNotes": ["string"],',
            '  "qualityRubric": {',
            '    "coverageCompleteness": "low|medium|high",',
            '    "logicalProgression": "low|medium|high",',
            '    "evidenceGrounding": "low|medium|high",',
            '    "notes": ["string"]',
            "  },",
            '  "topics": [',
            "    {",
            '      "key": "kebab-case-string",',
            '      "title": "string",',
            '      "description": "string",',
            '      "section": "string",',
            '      "sequence": 1,',
            '      "prerequisites": ["topic-key"],',
            '      "objectives": [',
            "        {",
            '          "statement": "string",',
            '          "level": "remember|understand|apply|analyze|evaluate|create",',
            '          "masteryCriteria": "string",',
            '          "misconceptionAddressed": "string",',
            '          "evidence": [{ "sourceLabel": "Source N", "rationale": "string" }]',
            "        }",
            "      ],",
            '      "assessmentIdeas": ["string"],',
            '      "misconceptionFlags": ["string"],',
            '      "evidence": [{ "sourceLabel": "Source N", "rationale": "string" }]',
            "    }",
            "  ]",
            "}",
            "",
            "Hard requirements:",
            "1) sequence values must be integers, unique, and contiguous starting at 1.",
            "2) Every topic must include at least one objective and one assessment idea.",
            "3) Do not create duplicate topics or near-duplicate objectives.",
            "4) If context is insufficient, include explicit uncertaintyNotes instead of guessing.",
            "5) Keep evidence sourceLabel aligned to provided source headers exactly (e.g., 'Source 1').",
            "",
            "Materials:",
            material_text,
        ]
    )

    return {"system": system, "user": user}


def parse_blueprint_response(raw: str) -> dict[str, Any]:
    json_text = extract_json_with_fallback(raw)
    parsed = parse_json_with_repair(json_text)
    if not isinstance(parsed, dict):
        raise RuntimeError("Invalid blueprint JSON: Payload is not an object.")
    normalized = validate_and_normalize_blueprint(parsed)
    return normalized


def extract_json_with_fallback(raw: str) -> str:
    extracted = extract_single_json_object(raw)
    if extracted:
        return extracted

    trimmed = raw.strip()
    if trimmed.startswith("{") and trimmed.endswith("}"):
        return trimmed
    raise RuntimeError("No JSON object found in AI response.")


def parse_json_with_repair(json_text: str) -> Any:
    try:
        return json.loads(json_text)
    except json.JSONDecodeError:
        repaired = repair_json(json_text)
        try:
            return json.loads(repaired)
        except json.JSONDecodeError as error:
            raise RuntimeError("Blueprint response is not valid JSON.") from error


def repair_json(input_text: str) -> str:
    return (
        input_text.replace("“", '"')
        .replace("”", '"')
        .replace("‘", "'")
        .replace("’", "'")
        .replace(",}", "}")
        .replace(",]", "]")
        .strip()
    )


def extract_single_json_object(raw: str) -> str | None:
    start = raw.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escape = False
    found_start = False
    for index in range(start, len(raw)):
        char = raw[index]
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
            depth += 1
            found_start = True
        elif char == "}":
            depth -= 1
            if found_start and depth == 0:
                candidate = raw[start : index + 1]
                trailing = raw[index + 1 :].strip()
                if trailing and "{" in trailing:
                    raise RuntimeError("Multiple JSON objects found in AI response.")
                return candidate
    return None


def validate_and_normalize_blueprint(payload: dict[str, Any]) -> dict[str, Any]:
    summary = payload.get("summary")
    topics = payload.get("topics")
    if not isinstance(summary, str) or not summary.strip():
        raise RuntimeError("Invalid blueprint JSON: summary is required.")
    if not isinstance(topics, list) or len(topics) == 0:
        raise RuntimeError("Invalid blueprint JSON: topics must be a non-empty array.")

    normalized_topics: list[dict[str, Any]] = []
    keys: set[str] = set()
    sequences: list[int] = []
    for index, topic in enumerate(topics):
        if not isinstance(topic, dict):
            raise RuntimeError(f"Invalid blueprint JSON: topics[{index}] must be an object.")

        key = normalize_topic_key(topic.get("key"))
        if not key:
            raise RuntimeError(f"Invalid blueprint JSON: topics[{index}].key is required and must be kebab-case.")
        if key in keys:
            raise RuntimeError(f"Invalid blueprint JSON: topics[{index}].key is duplicated.")
        keys.add(key)

        sequence = topic.get("sequence")
        if not isinstance(sequence, int) or sequence < 1:
            raise RuntimeError(f"Invalid blueprint JSON: topics[{index}].sequence must be an integer >= 1.")
        sequences.append(sequence)

        title = string_or_empty(topic.get("title"))
        if not title:
            raise RuntimeError(f"Invalid blueprint JSON: topics[{index}].title is required.")

        objectives = topic.get("objectives")
        if not isinstance(objectives, list) or len(objectives) == 0:
            raise RuntimeError(f"Invalid blueprint JSON: topics[{index}].objectives must be non-empty.")
        normalized_objectives: list[dict[str, Any]] = []
        for objective_index, objective in enumerate(objectives):
            if not isinstance(objective, dict):
                raise RuntimeError(
                    f"Invalid blueprint JSON: topics[{index}].objectives[{objective_index}] must be object."
                )
            statement = string_or_empty(objective.get("statement"))
            if not statement:
                raise RuntimeError(
                    f"Invalid blueprint JSON: topics[{index}].objectives[{objective_index}].statement is required."
                )
            level = normalize_bloom_level(objective.get("level"))
            normalized_objectives.append(
                {
                    "statement": statement,
                    "level": level,
                    "masteryCriteria": optional_string(objective.get("masteryCriteria")),
                    "misconceptionAddressed": optional_string(objective.get("misconceptionAddressed")),
                    "evidence": normalize_evidence_list(objective.get("evidence")),
                }
            )

        assessment_ideas = normalize_string_list(topic.get("assessmentIdeas"))
        if len(assessment_ideas) == 0:
            raise RuntimeError(f"Invalid blueprint JSON: topics[{index}].assessmentIdeas must be non-empty.")

        normalized_topics.append(
            {
                "key": key,
                "title": title,
                "description": optional_string(topic.get("description")),
                "section": optional_string(topic.get("section")),
                "sequence": sequence,
                "prerequisites": normalize_string_list(topic.get("prerequisites")),
                "objectives": normalized_objectives,
                "assessmentIdeas": assessment_ideas,
                "misconceptionFlags": normalize_string_list(topic.get("misconceptionFlags")),
                "evidence": normalize_evidence_list(topic.get("evidence")),
            }
        )

    unique_sequences = sorted(set(sequences))
    if len(unique_sequences) != len(sequences):
        raise RuntimeError("Invalid blueprint JSON: topic sequence values are duplicated.")
    for expected, actual in enumerate(unique_sequences, start=1):
        if actual != expected:
            raise RuntimeError("Invalid blueprint JSON: topic sequences must be contiguous starting at 1.")

    topic_key_set = {topic["key"] for topic in normalized_topics}
    graph: dict[str, list[str]] = {}
    for topic in normalized_topics:
        prereqs = topic.get("prerequisites") or []
        for prereq in prereqs:
            if prereq not in topic_key_set:
                raise RuntimeError(
                    f"Invalid blueprint JSON: topic '{topic['key']}' prerequisite '{prereq}' is missing."
                )
            if prereq == topic["key"]:
                raise RuntimeError(f"Invalid blueprint JSON: topic '{topic['key']}' cannot require itself.")
        graph[topic["key"]] = prereqs

    if has_cycle(graph):
        raise RuntimeError("Invalid blueprint JSON: topics prerequisites must form an acyclic graph.")

    quality = payload.get("qualityRubric")
    normalized_quality: dict[str, Any] | None = None
    if isinstance(quality, dict):
        coverage = normalize_coverage_level(quality.get("coverageCompleteness"))
        progression = normalize_coverage_level(quality.get("logicalProgression"))
        grounding = normalize_coverage_level(quality.get("evidenceGrounding"))
        if coverage and progression and grounding:
            normalized_quality = {
                "coverageCompleteness": coverage,
                "logicalProgression": progression,
                "evidenceGrounding": grounding,
                "notes": normalize_string_list(quality.get("notes")),
            }

    return {
        "schemaVersion": DEFAULT_BLUEPRINT_SCHEMA_VERSION,
        "summary": summary.strip(),
        "assumptions": normalize_string_list(payload.get("assumptions")),
        "uncertaintyNotes": normalize_string_list(payload.get("uncertaintyNotes")),
        "qualityRubric": normalized_quality,
        "topics": sorted(normalized_topics, key=lambda topic: topic["sequence"]),
    }


def normalize_topic_key(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    key = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key):
        return None
    return key


def normalize_bloom_level(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in {"remember", "understand", "apply", "analyze", "evaluate", "create"}:
        return normalized
    return None


def normalize_coverage_level(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in {"low", "medium", "high"}:
        return normalized
    return None


def normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        if isinstance(item, str):
            cleaned = item.strip()
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                out.append(cleaned)
    return out


def normalize_evidence_list(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        source = string_or_empty(item.get("sourceLabel"))
        rationale = string_or_empty(item.get("rationale"))
        if not source or not rationale:
            continue
        key = f"{source.lower()}::{rationale.lower()}"
        if key in seen:
            continue
        seen.add(key)
        out.append({"sourceLabel": source, "rationale": rationale})
    return out


def has_cycle(graph: dict[str, list[str]]) -> bool:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> bool:
        if node in visiting:
            return True
        if node in visited:
            return False
        visiting.add(node)
        for nxt in graph.get(node, []):
            if visit(nxt):
                return True
        visiting.remove(node)
        visited.add(node)
        return False

    return any(visit(node) for node in graph.keys())


def string_or_empty(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def optional_string(value: Any) -> str | None:
    cleaned = string_or_empty(value)
    return cleaned or None
