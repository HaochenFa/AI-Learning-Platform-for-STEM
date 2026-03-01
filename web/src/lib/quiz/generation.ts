import { extractJsonObjectCandidates } from "@/lib/json/extract-object";
import type { QuizGenerationPayload } from "@/lib/quiz/types";
import { MAX_QUIZ_QUESTIONS, validateQuizGenerationPayload } from "@/lib/quiz/validation";

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
  const notFoundMessage = "No JSON object found in quiz generation response.";
  const normalizedRaw = raw.trim();

  const candidates: unknown[] = [];
  let directJsonParseFailed = false;

  if (normalizedRaw.startsWith("{") && normalizedRaw.endsWith("}")) {
    try {
      candidates.push(JSON.parse(normalizedRaw));
    } catch {
      directJsonParseFailed = true;
    }
  }

  const objectCandidates = extractJsonObjectCandidates(raw);
  objectCandidates.forEach((candidate) => {
    try {
      candidates.push(JSON.parse(candidate));
    } catch {
      // Candidate extraction already filtered for valid JSON.
    }
  });

  if (candidates.length === 0) {
    if (directJsonParseFailed) {
      throw new Error("Quiz generation response is not valid JSON.");
    }
    throw new Error(notFoundMessage);
  }

  let bestValidPayload: QuizGenerationPayload | null = null;
  let bestValidationErrors: string[] = [];

  candidates.forEach((candidate) => {
    const normalizedCandidate =
      candidate &&
      typeof candidate === "object" &&
      Array.isArray((candidate as { questions?: unknown }).questions)
        ? {
            ...(candidate as Record<string, unknown>),
            questions: (candidate as { questions: unknown[] }).questions.slice(0, MAX_QUIZ_QUESTIONS),
          }
        : candidate;

    const validation = validateQuizGenerationPayload(normalizedCandidate);
    if (validation.ok) {
      if (
        !bestValidPayload ||
        validation.value.questions.length > bestValidPayload.questions.length
      ) {
        bestValidPayload = validation.value;
      }
      return;
    }

    if (
      bestValidationErrors.length === 0 ||
      validation.errors.length < bestValidationErrors.length
    ) {
      bestValidationErrors = validation.errors;
    }
  });

  if (bestValidPayload) {
    return bestValidPayload;
  }

  throw new Error(
    `Invalid quiz JSON: ${bestValidationErrors.join("; ") || "Payload could not be validated."}`,
  );
}
