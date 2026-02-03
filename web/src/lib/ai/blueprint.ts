export type BlueprintObjective = {
  statement: string;
  level?: string;
};

export type BlueprintTopic = {
  key: string;
  title: string;
  description?: string;
  sequence: number;
  prerequisites?: string[];
  objectives: BlueprintObjective[];
  assessmentIdeas?: string[];
};

export type BlueprintPayload = {
  summary: string;
  assumptions?: string[];
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
    "Generate a course blueprint strictly as JSON. No markdown, no commentary.",
    "Use Bloom-style objective levels (remember, understand, apply, analyze, evaluate, create).",
    "Every topic must include objectives and a stable `key` that other topics can reference.",
  ].join(" ");

  const user = [
    `Class: ${input.classTitle}`,
    `Subject: ${input.subject || "STEM"}`,
    `Level: ${input.level || "Mixed high school/college"}`,
    `Materials provided: ${input.materialCount}`,
    "",
    "Produce JSON with this structure:",
    "{",
    '  "summary": string,',
    '  "assumptions": string[],',
    '  "topics": [',
    "    {",
    '      "key": string,',
    '      "title": string,',
    '      "description": string,',
    '      "sequence": number,',
    '      "prerequisites": string[],',
    '      "objectives": [ { "statement": string, "level": string } ],',
    '      "assessmentIdeas": string[]',
    "    }",
    "  ]",
    "}",
    "",
    "Materials:",
    input.materialText,
  ].join("\n");

  return { system, user };
}

export function parseBlueprintResponse(raw: string) {
  const jsonText = extractJson(raw);
  const parsed = JSON.parse(jsonText) as unknown;
  const validation = validateBlueprintPayload(parsed);
  if (!validation.ok) {
    throw new Error(`Invalid blueprint JSON: ${validation.errors.join("; ")}`);
  }
  return validation.value;
}

export function validateBlueprintPayload(payload: unknown): {
  ok: boolean;
  errors: string[];
  value?: BlueprintPayload;
} {
  const errors: string[] = [];

  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["Payload is not an object."] };
  }

  const data = payload as BlueprintPayload;

  if (!isNonEmptyString(data.summary)) {
    errors.push("summary is required.");
  }

  if (!Array.isArray(data.topics) || data.topics.length === 0) {
    errors.push("topics must be a non-empty array.");
  } else {
    const keys = new Set<string>();
    data.topics.forEach((topic, index) => {
      if (!isNonEmptyString(topic.key)) {
        errors.push(`topics[${index}].key is required.`);
      } else if (keys.has(topic.key)) {
        errors.push(`topics[${index}].key is duplicated.`);
      } else {
        keys.add(topic.key);
      }

      if (!isNonEmptyString(topic.title)) {
        errors.push(`topics[${index}].title is required.`);
      }

      if (typeof topic.sequence !== "number") {
        errors.push(`topics[${index}].sequence must be a number.`);
      }

      if (!Array.isArray(topic.objectives) || topic.objectives.length === 0) {
        errors.push(`topics[${index}].objectives must be non-empty.`);
      } else {
        topic.objectives.forEach((objective, objectiveIndex) => {
          if (!isNonEmptyString(objective.statement)) {
            errors.push(
              `topics[${index}].objectives[${objectiveIndex}].statement is required.`
            );
          }
        });
      }

      if (topic.prerequisites && !Array.isArray(topic.prerequisites)) {
        errors.push(`topics[${index}].prerequisites must be an array.`);
      }
    });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors, value: data };
}

function extractJson(raw: string) {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON object found in AI response.");
  }
  return raw.slice(first, last + 1);
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}
