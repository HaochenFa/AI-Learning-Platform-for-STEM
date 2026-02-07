import type {
  ChatAssignmentSubmissionContent,
  ChatModelResponse,
  ChatRole,
  ChatTurn,
} from "@/lib/chat/types";
import { extractSingleJsonObject } from "@/lib/json/extract-object";

export const MAX_CHAT_MESSAGE_CHARS = 1200;
export const MAX_CHAT_TURNS = 20;
export const MAX_REFLECTION_CHARS = 2000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRole(value: unknown): ChatRole | null {
  return value === "student" || value === "assistant" ? value : null;
}

export function parseChatTurns(raw: FormDataEntryValue | null): ChatTurn[] {
  if (!raw || typeof raw !== "string") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Transcript payload must be valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Transcript payload must be an array.");
  }

  if (parsed.length > MAX_CHAT_TURNS) {
    throw new Error(`Transcript cannot exceed ${MAX_CHAT_TURNS} turns.`);
  }

  return parsed.map((turn, index) => {
    if (!turn || typeof turn !== "object") {
      throw new Error(`Turn ${index + 1} is invalid.`);
    }

    const role = normalizeRole((turn as { role?: unknown }).role);
    if (!role) {
      throw new Error(`Turn ${index + 1} role is invalid.`);
    }

    const messageRaw = (turn as { message?: unknown }).message;
    if (!isNonEmptyString(messageRaw)) {
      throw new Error(`Turn ${index + 1} message is required.`);
    }
    const message = messageRaw.trim();

    if (message.length > MAX_CHAT_MESSAGE_CHARS) {
      throw new Error(`Turn ${index + 1} message exceeds ${MAX_CHAT_MESSAGE_CHARS} characters.`);
    }

    const createdAtRaw = (turn as { createdAt?: unknown }).createdAt;
    if (!isNonEmptyString(createdAtRaw)) {
      throw new Error(`Turn ${index + 1} createdAt is required.`);
    }
    const createdAt = createdAtRaw.trim();

    const citations = (turn as { citations?: unknown }).citations;
    if (citations && !Array.isArray(citations)) {
      throw new Error(`Turn ${index + 1} citations must be an array.`);
    }

    return {
      role,
      message,
      createdAt,
      citations: Array.isArray(citations)
        ? citations
            .filter((citation): citation is { sourceLabel: string; snippet?: string } => {
              if (!citation || typeof citation !== "object") {
                return false;
              }
              const sourceLabel = (citation as { sourceLabel?: unknown }).sourceLabel;
              if (!isNonEmptyString(sourceLabel)) {
                return false;
              }
              const snippet = (citation as { snippet?: unknown }).snippet;
              return typeof snippet === "undefined" || typeof snippet === "string";
            })
            .map((citation) => ({
              sourceLabel: citation.sourceLabel.trim(),
              snippet: citation.snippet?.trim() || undefined,
            }))
        : undefined,
    };
  });
}

export function parseChatMessage(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Message is required.");
  }

  const value = raw.trim();
  if (!value) {
    throw new Error("Message is required.");
  }

  if (value.length > MAX_CHAT_MESSAGE_CHARS) {
    throw new Error(`Message exceeds ${MAX_CHAT_MESSAGE_CHARS} characters.`);
  }

  return value;
}

export function parseReflection(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Reflection is required.");
  }

  const value = raw.trim();
  if (!value) {
    throw new Error("Reflection is required.");
  }

  if (value.length > MAX_REFLECTION_CHARS) {
    throw new Error(`Reflection exceeds ${MAX_REFLECTION_CHARS} characters.`);
  }

  return value;
}

export function extractJsonObject(raw: string) {
  return extractSingleJsonObject(raw, {
    notFoundMessage: "No JSON object found in model response.",
    multipleMessage: "Multiple JSON objects found in model response.",
  });
}

export function parseChatModelResponse(raw: string): ChatModelResponse {
  const text = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Model response is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model response payload is invalid.");
  }

  const answerRaw = (parsed as { answer?: unknown }).answer;
  if (!isNonEmptyString(answerRaw)) {
    throw new Error("Model response answer is required.");
  }
  const answer = answerRaw.trim();

  const safety = (parsed as { safety?: unknown }).safety;
  if (safety !== "ok" && safety !== "refusal") {
    throw new Error("Model response safety must be 'ok' or 'refusal'.");
  }

  const citationsRaw = (parsed as { citations?: unknown }).citations;
  if (!Array.isArray(citationsRaw)) {
    throw new Error("Model response citations must be an array.");
  }

  const citations = citationsRaw.map((citation, index) => {
    if (!citation || typeof citation !== "object") {
      throw new Error(`Citation ${index + 1} is invalid.`);
    }

    const sourceLabelRaw = (citation as { sourceLabel?: unknown }).sourceLabel;
    if (!isNonEmptyString(sourceLabelRaw)) {
      throw new Error(`Citation ${index + 1} sourceLabel is required.`);
    }
    const sourceLabel = sourceLabelRaw.trim();

    const rationaleRaw = (citation as { rationale?: unknown }).rationale;
    if (!isNonEmptyString(rationaleRaw)) {
      throw new Error(`Citation ${index + 1} rationale is required.`);
    }
    const rationale = rationaleRaw.trim();

    return {
      sourceLabel,
      rationale,
    };
  });

  const confidenceRaw = (parsed as { confidence?: unknown }).confidence;
  let confidence: ChatModelResponse["confidence"];
  if (
    typeof confidenceRaw === "string" &&
    (confidenceRaw === "low" || confidenceRaw === "medium" || confidenceRaw === "high")
  ) {
    confidence = confidenceRaw;
  }

  return {
    answer,
    citations,
    safety,
    confidence,
  };
}

export function parseHighlights(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string") {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export function parseOptionalScore(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error("Score must be a number.");
  }
  if (value < 0 || value > 100) {
    throw new Error("Score must be between 0 and 100.");
  }
  return value;
}

export function parseDueAt(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Due date is invalid.");
  }
  return date.toISOString();
}

export function buildChatAssignmentSubmissionContent(input: {
  activityId: string;
  transcript: ChatTurn[];
  reflection: string;
}): ChatAssignmentSubmissionContent {
  return {
    mode: "chat_assignment",
    activityId: input.activityId,
    transcript: input.transcript,
    reflection: input.reflection,
    completedAt: new Date().toISOString(),
  };
}
