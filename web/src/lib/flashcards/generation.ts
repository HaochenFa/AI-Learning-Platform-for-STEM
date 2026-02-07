import { extractSingleJsonObject } from "@/lib/json/extract-object";
import type { FlashcardsGenerationPayload } from "@/lib/flashcards/types";
import { validateFlashcardsGenerationPayload } from "@/lib/flashcards/validation";

const QUALITY_PROFILE = process.env.AI_PROMPT_QUALITY_PROFILE ?? "quality_v1";
const GROUNDING_MODE = process.env.AI_GROUNDING_MODE ?? "balanced";

export function buildFlashcardsGenerationPrompt(input: {
  classTitle: string;
  cardCount: number;
  instructions: string;
  blueprintContext: string;
  materialContext: string;
}) {
  const system = [
    "You are an expert STEM learning designer.",
    "Generate only valid JSON with deterministic structure.",
    "Use only the provided blueprint/material context for content.",
    "Each flashcard must have a concise front and a clear, grounded back.",
    `Quality profile: ${QUALITY_PROFILE}.`,
    `Grounding mode: ${GROUNDING_MODE}.`,
  ].join(" ");

  const user = [
    `Class: ${input.classTitle}`,
    `Card count: ${input.cardCount}`,
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
  ].join("\n");

  return { system, user };
}

export function parseFlashcardsGenerationResponse(raw: string): FlashcardsGenerationPayload {
  const jsonText = extractSingleJsonObject(raw, {
    notFoundMessage: "No JSON object found in flashcards generation response.",
    multipleMessage: "Multiple JSON objects found in flashcards generation response.",
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Flashcards generation response is not valid JSON.");
  }

  const validation = validateFlashcardsGenerationPayload(parsed);
  if (!validation.ok) {
    throw new Error(`Invalid flashcards JSON: ${validation.errors.join("; ")}`);
  }
  return validation.value;
}
