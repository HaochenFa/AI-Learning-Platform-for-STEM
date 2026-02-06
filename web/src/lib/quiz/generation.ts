import { extractSingleJsonObject } from "@/lib/json/extract-object";
import type { QuizGenerationPayload } from "@/lib/quiz/types";
import { validateQuizGenerationPayload } from "@/lib/quiz/validation";

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
    "Return multiple-choice questions only.",
    "Each question must have exactly 4 choices and exactly one correct answer.",
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
    "- No additional keys.",
    "- `answer` must exactly match one item in `choices`.",
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
