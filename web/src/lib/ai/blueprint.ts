import { extractSingleJsonObject } from "@/lib/json/extract-object";

export const DEFAULT_BLUEPRINT_SCHEMA_VERSION = process.env.BLUEPRINT_SCHEMA_VERSION ?? "v2";
export const DEFAULT_AI_PROMPT_QUALITY_PROFILE = process.env.AI_PROMPT_QUALITY_PROFILE ?? "quality_v1";
export const DEFAULT_AI_GROUNDING_MODE = process.env.AI_GROUNDING_MODE ?? "balanced";

const BLOOM_LEVELS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

const COVERAGE_LEVELS = ["low", "medium", "high"] as const;

export type BloomLevel = (typeof BLOOM_LEVELS)[number];
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

export type BlueprintEvidence = {
  sourceLabel: string;
  rationale: string;
};

export type BlueprintObjective = {
  statement: string;
  level?: BloomLevel;
  masteryCriteria?: string;
  misconceptionAddressed?: string;
  evidence?: BlueprintEvidence[];
};

export type BlueprintTopic = {
  key: string;
  title: string;
  description?: string;
  section?: string;
  sequence: number;
  prerequisites?: string[];
  objectives: BlueprintObjective[];
  assessmentIdeas?: string[];
  misconceptionFlags?: string[];
  evidence?: BlueprintEvidence[];
};

export type BlueprintQualityRubric = {
  coverageCompleteness: CoverageLevel;
  logicalProgression: CoverageLevel;
  evidenceGrounding: CoverageLevel;
  notes?: string[];
};

export type BlueprintPayload = {
  schemaVersion?: string;
  summary: string;
  assumptions?: string[];
  uncertaintyNotes?: string[];
  qualityRubric?: BlueprintQualityRubric;
  topics: BlueprintTopic[];
};

export function buildBlueprintPrompt(input: {
  classTitle: string;
  subject?: string | null;
  level?: string | null;
  materialCount: number;
  materialText: string;
}) {
  const system = [
    "You are an expert curriculum designer for high school and college STEM courses.",
    "Produce a deterministic, deeply structured class blueprint grounded only in provided class materials.",
    "Never hallucinate content that cannot be tied to the retrieved context.",
    "Return JSON only. No markdown, no prose outside JSON, no code fences.",
    "Use Bloom levels exactly from this set: remember, understand, apply, analyze, evaluate, create.",
    "All prerequisite links must form a DAG and reference existing topic keys.",
    `Quality profile: ${DEFAULT_AI_PROMPT_QUALITY_PROFILE}.`,
    `Grounding mode: ${DEFAULT_AI_GROUNDING_MODE}.`,
  ].join(" ");

  const user = [
    `Class: ${input.classTitle}`,
    `Subject: ${input.subject || "STEM"}`,
    `Level: ${input.level || "Mixed high school/college"}`,
    `Materials provided: ${input.materialCount}`,
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
    input.materialText,
  ].join("\n");

  return { system, user };
}

export function parseBlueprintResponse(raw: string): BlueprintPayload {
  const jsonText = extractJsonWithFallback(raw);
  const parsed = parseJsonWithRepair(jsonText);
  const validation = validateBlueprintPayload(parsed);
  if (!validation.ok) {
    throw new Error(`Invalid blueprint JSON: ${validation.errors.join("; ")}`);
  }
  return validation.value;
}

export function validateBlueprintPayload(
  payload: unknown,
): { ok: true; errors: string[]; value: BlueprintPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["Payload is not an object."] };
  }

  const data = payload as BlueprintPayload;
  const sanitizedTopics: BlueprintTopic[] = [];
  const topicKeys = new Set<string>();
  const normalizedTopicTitles = new Set<string>();
  const seenSequences = new Set<number>();

  if (!isNonEmptyString(data.summary)) {
    errors.push("summary is required.");
  }

  const assumptions = sanitizeStringArray(data.assumptions);
  if (data.assumptions && assumptions.length === 0) {
    errors.push("assumptions must contain non-empty strings when provided.");
  }

  const uncertaintyNotes = sanitizeStringArray(data.uncertaintyNotes);
  if (data.uncertaintyNotes && uncertaintyNotes.length === 0) {
    errors.push("uncertaintyNotes must contain non-empty strings when provided.");
  }

  const qualityRubric = validateQualityRubric(data.qualityRubric, errors);

  if (!Array.isArray(data.topics) || data.topics.length === 0) {
    errors.push("topics must be a non-empty array.");
  } else {
    data.topics.forEach((topic, index) => {
      if (!topic || typeof topic !== "object") {
        errors.push(`topics[${index}] must be an object.`);
        return;
      }

      const key = normalizeTopicKey(topic.key);
      if (!key) {
        errors.push(`topics[${index}].key is required and must be kebab-case.`);
      } else if (topicKeys.has(key)) {
        errors.push(`topics[${index}].key is duplicated.`);
      } else {
        topicKeys.add(key);
      }

      const title = sanitizeString(topic.title);
      if (!title) {
        errors.push(`topics[${index}].title is required.`);
      } else {
        const normalizedTitle = normalizeText(title);
        if (normalizedTopicTitles.has(normalizedTitle)) {
          errors.push(`topics[${index}].title is a near-duplicate.`);
        }
        normalizedTopicTitles.add(normalizedTitle);
      }

      if (!Number.isInteger(topic.sequence)) {
        errors.push(`topics[${index}].sequence must be an integer.`);
      } else if (topic.sequence < 1) {
        errors.push(`topics[${index}].sequence must be >= 1.`);
      } else if (seenSequences.has(topic.sequence)) {
        errors.push(`topics[${index}].sequence is duplicated.`);
      } else {
        seenSequences.add(topic.sequence);
      }

      const prerequisites = sanitizeStringArray(topic.prerequisites);
      if (topic.prerequisites && !Array.isArray(topic.prerequisites)) {
        errors.push(`topics[${index}].prerequisites must be an array.`);
      }

      const objectives = sanitizeObjectives(topic.objectives, index, errors);
      const assessmentIdeas = sanitizeStringArray(topic.assessmentIdeas);
      if (assessmentIdeas.length === 0) {
        errors.push(`topics[${index}].assessmentIdeas must include at least one item.`);
      }

      const evidence = sanitizeEvidence(topic.evidence, `topics[${index}].evidence`, errors);

      sanitizedTopics.push({
        key: key || `topic-${index + 1}`,
        title: title || "",
        description: sanitizeOptionalString(topic.description),
        section: sanitizeOptionalString(topic.section),
        sequence: Number.isInteger(topic.sequence) ? topic.sequence : index + 1,
        prerequisites,
        objectives,
        assessmentIdeas,
        misconceptionFlags: sanitizeStringArray(topic.misconceptionFlags),
        evidence,
      });
    });

    const sortedSequences = [...seenSequences].sort((a, b) => a - b);
    for (let index = 0; index < sortedSequences.length; index += 1) {
      if (sortedSequences[index] !== index + 1) {
        errors.push("topic sequences must be contiguous starting at 1.");
        break;
      }
    }

    const keySet = new Set(sanitizedTopics.map((topic) => topic.key));
    const graph = new Map<string, string[]>();
    sanitizedTopics.forEach((topic, index) => {
      const prereqs = topic.prerequisites ?? [];
      prereqs.forEach((prereqKey) => {
        if (!keySet.has(prereqKey)) {
          errors.push(`topics[${index}].prerequisites references missing key '${prereqKey}'.`);
        }
        if (prereqKey === topic.key) {
          errors.push(`topics[${index}].prerequisites cannot reference itself.`);
        }
      });
      graph.set(topic.key, prereqs);
    });

    if (hasCycle(graph)) {
      errors.push("topics prerequisites must form an acyclic graph.");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors,
    value: {
      schemaVersion: DEFAULT_BLUEPRINT_SCHEMA_VERSION,
      summary: sanitizeString(data.summary),
      assumptions,
      uncertaintyNotes,
      qualityRubric,
      topics: sanitizedTopics.sort((a, b) => a.sequence - b.sequence),
    },
  };
}

function sanitizeObjectives(
  raw: unknown,
  topicIndex: number,
  errors: string[],
): BlueprintObjective[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push(`topics[${topicIndex}].objectives must be non-empty.`);
    return [];
  }

  const normalizedObjectiveStatements = new Set<string>();
  const objectives: BlueprintObjective[] = [];
  raw.forEach((objective, objectiveIndex) => {
    if (!objective || typeof objective !== "object") {
      errors.push(`topics[${topicIndex}].objectives[${objectiveIndex}] must be an object.`);
      return;
    }

    const statement = sanitizeString((objective as BlueprintObjective).statement);
    if (!statement) {
      errors.push(`topics[${topicIndex}].objectives[${objectiveIndex}].statement is required.`);
      return;
    }
    if (wordCount(statement) < 4) {
      errors.push(
        `topics[${topicIndex}].objectives[${objectiveIndex}].statement must be specific (>= 4 words).`,
      );
    }

    const normalizedStatement = normalizeText(statement);
    if (normalizedObjectiveStatements.has(normalizedStatement)) {
      errors.push(`topics[${topicIndex}] contains duplicate or near-duplicate objectives.`);
    }
    normalizedObjectiveStatements.add(normalizedStatement);

    const rawLevel = (objective as BlueprintObjective).level;
    const level = normalizeBloomLevel(rawLevel);
    if (rawLevel && !level) {
      errors.push(
        `topics[${topicIndex}].objectives[${objectiveIndex}].level must be one of ${BLOOM_LEVELS.join(", ")}.`,
      );
    }

    objectives.push({
      statement,
      level: level ?? undefined,
      masteryCriteria: sanitizeOptionalString((objective as BlueprintObjective).masteryCriteria),
      misconceptionAddressed: sanitizeOptionalString(
        (objective as BlueprintObjective).misconceptionAddressed,
      ),
      evidence: sanitizeEvidence(
        (objective as BlueprintObjective).evidence,
        `topics[${topicIndex}].objectives[${objectiveIndex}].evidence`,
        errors,
      ),
    });
  });

  return objectives;
}

function sanitizeEvidence(raw: unknown, label: string, errors: string[]): BlueprintEvidence[] {
  if (typeof raw === "undefined") {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push(`${label} must be an array.`);
    return [];
  }

  const seen = new Set<string>();
  const output: BlueprintEvidence[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      errors.push(`${label}[${index}] must be an object.`);
      return;
    }

    const sourceLabel = sanitizeString((item as BlueprintEvidence).sourceLabel);
    const rationale = sanitizeString((item as BlueprintEvidence).rationale);
    if (!sourceLabel || !rationale) {
      errors.push(`${label}[${index}] requires sourceLabel and rationale.`);
      return;
    }
    const key = `${normalizeText(sourceLabel)}:${normalizeText(rationale)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push({ sourceLabel, rationale });
  });
  return output;
}

function validateQualityRubric(
  raw: unknown,
  errors: string[],
): BlueprintQualityRubric | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw !== "object") {
    errors.push("qualityRubric must be an object.");
    return undefined;
  }

  const rubric = raw as BlueprintQualityRubric;
  const coverageCompleteness = normalizeCoverageLevel(rubric.coverageCompleteness);
  const logicalProgression = normalizeCoverageLevel(rubric.logicalProgression);
  const evidenceGrounding = normalizeCoverageLevel(rubric.evidenceGrounding);

  if (!coverageCompleteness || !logicalProgression || !evidenceGrounding) {
    errors.push("qualityRubric fields must be low|medium|high.");
    return undefined;
  }

  return {
    coverageCompleteness,
    logicalProgression,
    evidenceGrounding,
    notes: sanitizeStringArray(rubric.notes),
  };
}

function normalizeBloomLevel(value: unknown): BloomLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return BLOOM_LEVELS.includes(normalized as BloomLevel) ? (normalized as BloomLevel) : null;
}

function normalizeCoverageLevel(value: unknown): CoverageLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return COVERAGE_LEVELS.includes(normalized as CoverageLevel)
    ? (normalized as CoverageLevel)
    : null;
}

function normalizeTopicKey(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    return null;
  }
  return key;
}

function sanitizeString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function sanitizeOptionalString(value: unknown) {
  const sanitized = sanitizeString(value);
  return sanitized || undefined;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => sanitizeString(item))
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
}

function parseJsonWithRepair(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText);
  } catch {
    const repaired = repairJson(jsonText);
    try {
      return JSON.parse(repaired);
    } catch {
      throw new Error("Blueprint response is not valid JSON.");
    }
  }
}

function repairJson(input: string) {
  return input
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function hasCycle(graph: Map<string, string[]>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): boolean => {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }
    visiting.add(node);
    const edges = graph.get(node) ?? [];
    for (const next of edges) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  for (const node of graph.keys()) {
    if (visit(node)) {
      return true;
    }
  }
  return false;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string) {
  if (!value.trim()) {
    return 0;
  }
  return value.trim().split(/\s+/).length;
}

function extractJson(raw: string) {
  return extractSingleJsonObject(raw, {
    notFoundMessage: "No JSON object found in AI response.",
    multipleMessage: "Multiple JSON objects found in AI response.",
  });
}

function extractJsonWithFallback(raw: string) {
  try {
    return extractJson(raw);
  } catch {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed;
    }
    throw new Error("No JSON object found in AI response.");
  }
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}
