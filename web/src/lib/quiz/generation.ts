import { extractSingleJsonObject } from "@/lib/json/extract-object";
import type { QuizGenerationPayload } from "@/lib/quiz/types";
import { validateQuizGenerationPayload } from "@/lib/quiz/validation";

const QUALITY_PROFILE = process.env.AI_PROMPT_QUALITY_PROFILE ?? "quality_v1";
const GROUNDING_MODE = process.env.AI_GROUNDING_MODE ?? "balanced";

export function buildQuizGenerationPrompt(input: {
  classTitle: string;
  questionCount: number;
  instructions: string;
  blueprintContext: string;
  materialContext: string;
}) {
  const system = [
    "You are an expert STEM assessment designer.",
    "Generate only valid JSON with deterministic structure.",
    "Use only the provided blueprint/material context for content and explanations.",
    "Questions must be multiple choice with exactly 4 choices and exactly one correct answer.",
    "Distractors must be plausible and non-trivial.",
    `Quality profile: ${QUALITY_PROFILE}.`,
    `Grounding mode: ${GROUNDING_MODE}.`,
  ].join(" ");

  const user = [
    `Class: ${input.classTitle}`,
    `Question count: ${input.questionCount}`,
    `Teacher instructions: ${input.instructions}`,
    "",
    "Published blueprint context:",
    input.blueprintContext || "No blueprint context provided.",
    "",
    "Retrieved class material context:",
    input.materialContext || "No material context provided.",
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
  ].join("\n");

  return { system, user };
}

export function parseQuizGenerationResponse(raw: string): QuizGenerationPayload {
  const jsonText = extractSingleJsonObject(raw, {
    notFoundMessage: "No JSON object found in quiz generation response.",
    multipleMessage: "Multiple JSON objects found in quiz generation response.",
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Quiz generation response is not valid JSON.");
  }

  const validation = validateQuizGenerationPayload(parsed);
  if (!validation.ok) {
    throw new Error(`Invalid quiz JSON: ${validation.errors.join("; ")}`);
  }
  return validation.value;
}
