import type { ChatCompactionSummary, ClassChatMessage } from "@/lib/chat/types";
import { parseChatCompactionSummary } from "@/lib/chat/validation";
import { estimateTokenCount } from "@/lib/materials/chunking";

function parseFiniteNumberEnv(envValue: string | undefined, fallback: number) {
  if (typeof envValue === "string" && envValue.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(envValue ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const CHAT_CONTEXT_RECENT_TURNS = parseFiniteNumberEnv(process.env.CHAT_CONTEXT_RECENT_TURNS, 12);
export const CHAT_COMPACTION_TRIGGER_TURNS = parseFiniteNumberEnv(process.env.CHAT_COMPACTION_TRIGGER_TURNS, 30);
export const CHAT_COMPACTION_MIN_NEW_TURNS = parseFiniteNumberEnv(process.env.CHAT_COMPACTION_MIN_NEW_TURNS, 6);
export const CHAT_CONTEXT_WINDOW_TOKENS = parseFiniteNumberEnv(process.env.CHAT_CONTEXT_WINDOW_TOKENS, 12000);
export const CHAT_OUTPUT_TOKEN_RESERVE = parseFiniteNumberEnv(process.env.CHAT_OUTPUT_TOKEN_RESERVE, 1400);

const CHAT_COMPACTION_CONTEXT_PRESSURE = parseFiniteNumberEnv(process.env.CHAT_COMPACTION_CONTEXT_PRESSURE, 0.8);
const MAX_KEY_TERMS = 12;
const MAX_LIST_ITEMS = 8;
const MAX_HIGHLIGHTS = 8;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

type CompactionAnchor = {
  createdAt: string;
  messageId: string;
  turnCount: number;
};

type ScoredTurn = {
  message: ClassChatMessage;
  score: number;
};

export type CompactionDecision = {
  shouldCompact: boolean;
  reason:
    | "below_trigger"
    | "no_new_turns"
    | "low_context_pressure"
    | "message_count_trigger"
    | "token_pressure";
  estimatedPromptTokens: number;
  pressureRatio: number;
  unsummarizedTurnCount: number;
};

export type CompactionResult = {
  summary: ChatCompactionSummary;
  summaryText: string;
};

export function parseCompactionSummary(raw: unknown): ChatCompactionSummary | null {
  return parseChatCompactionSummary(raw);
}

export function compareMessageChronology(a: Pick<ClassChatMessage, "createdAt" | "id">, b: Pick<ClassChatMessage, "createdAt" | "id">) {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt.localeCompare(b.createdAt);
  }
  return a.id.localeCompare(b.id);
}

export function sortMessagesChronologically(messages: ClassChatMessage[]) {
  return [...messages].sort(compareMessageChronology);
}

export function buildCompactionDecision(input: {
  messages: ClassChatMessage[];
  existingSummary: ChatCompactionSummary | null;
  pendingUserMessage: string;
  recentTurns?: number;
  triggerTurns?: number;
  minNewTurns?: number;
}): CompactionDecision {
  const recentTurns = Math.max(2, input.recentTurns ?? CHAT_CONTEXT_RECENT_TURNS);
  const triggerTurns = Math.max(recentTurns + 2, input.triggerTurns ?? CHAT_COMPACTION_TRIGGER_TURNS);
  const minNewTurns = Math.max(1, input.minNewTurns ?? CHAT_COMPACTION_MIN_NEW_TURNS);
  const messages = sortMessagesChronologically(input.messages);
  const candidates = collectCompactionCandidates(messages, recentTurns, input.existingSummary);

  const estimatedPromptTokens = estimateTokenCount([
    input.pendingUserMessage,
    ...messages.map((message) => message.content),
  ].join("\n"));
  const usableBudget = Math.max(1, CHAT_CONTEXT_WINDOW_TOKENS - CHAT_OUTPUT_TOKEN_RESERVE);
  const pressureRatio = estimatedPromptTokens / usableBudget;

  if (messages.length < triggerTurns) {
    return {
      shouldCompact: false,
      reason: "below_trigger",
      estimatedPromptTokens,
      pressureRatio,
      unsummarizedTurnCount: candidates.length,
    };
  }

  if (candidates.length < minNewTurns) {
    return {
      shouldCompact: false,
      reason: "no_new_turns",
      estimatedPromptTokens,
      pressureRatio,
      unsummarizedTurnCount: candidates.length,
    };
  }

  if (pressureRatio >= CHAT_COMPACTION_CONTEXT_PRESSURE) {
    return {
      shouldCompact: true,
      reason: "token_pressure",
      estimatedPromptTokens,
      pressureRatio,
      unsummarizedTurnCount: candidates.length,
    };
  }

  if (messages.length >= triggerTurns * 2) {
    return {
      shouldCompact: true,
      reason: "message_count_trigger",
      estimatedPromptTokens,
      pressureRatio,
      unsummarizedTurnCount: candidates.length,
    };
  }

  return {
    shouldCompact: false,
    reason: "low_context_pressure",
    estimatedPromptTokens,
    pressureRatio,
    unsummarizedTurnCount: candidates.length,
  };
}

export function buildCompactionResult(input: {
  messages: ClassChatMessage[];
  existingSummary: ChatCompactionSummary | null;
  latestUserMessage: string;
  recentTurns?: number;
}): CompactionResult | null {
  const messages = sortMessagesChronologically(input.messages);
  const recentTurns = Math.max(2, input.recentTurns ?? CHAT_CONTEXT_RECENT_TURNS);
  const candidates = collectCompactionCandidates(messages, recentTurns, input.existingSummary);
  if (candidates.length === 0) {
    return null;
  }

  const latestQueryTerms = extractTerms(input.latestUserMessage);
  const scored = candidates.map((message, index) => ({
    message,
    score: scoreTurn({
      message,
      index,
      total: candidates.length,
      latestQueryTerms,
    }),
  }));

  const selected = selectChronologicalHighlights(scored);
  const compactedThrough = selected[selected.length - 1];
  if (!compactedThrough) {
    return null;
  }
  const compactedThroughIndex = candidates.findIndex(
    (candidate) => candidate.id === compactedThrough.id && candidate.createdAt === compactedThrough.createdAt,
  );
  const compactedTurnDelta = compactedThroughIndex >= 0 ? compactedThroughIndex + 1 : candidates.length;

  const merged = mergeSummary({
    existingSummary: input.existingSummary,
    selected,
    compactedThrough,
    compactedTurnDelta,
    latestQueryTerms,
  });

  return {
    summary: merged,
    summaryText: buildCompactionMemoryText(merged),
  };
}

export function buildCompactionMemoryText(summary: ChatCompactionSummary | null | undefined) {
  if (!summary) {
    return "";
  }

  const lines: string[] = [];
  lines.push("Compacted conversation memory (older turns):");
  if (summary.timeline.highlights.length > 0) {
    lines.push(`Timeline highlights: ${summary.timeline.highlights.join(" | ")}`);
  }
  if (summary.keyTerms.length > 0) {
    lines.push(`Key terms: ${summary.keyTerms.map((term) => term.term).join(", ")}`);
  }
  if (summary.resolvedFacts.length > 0) {
    lines.push(`Resolved points: ${summary.resolvedFacts.join(" | ")}`);
  }
  if (summary.openQuestions.length > 0) {
    lines.push(`Open questions: ${summary.openQuestions.join(" | ")}`);
  }
  if (summary.studentNeeds.length > 0) {
    lines.push(`Student needs: ${summary.studentNeeds.join(" | ")}`);
  }
  lines.push("If this memory conflicts with recent transcript turns, prefer the recent transcript.");
  return lines.join("\n");
}

function collectCompactionCandidates(
  chronologicalMessages: ClassChatMessage[],
  recentTurns: number,
  existingSummary: ChatCompactionSummary | null,
) {
  if (chronologicalMessages.length <= recentTurns) {
    return [];
  }

  const compactableWindow = chronologicalMessages.slice(0, chronologicalMessages.length - recentTurns);
  const anchor = existingSummary?.compactedThrough ?? null;
  if (!anchor) {
    return compactableWindow;
  }

  return compactableWindow.filter((message) => isAfterAnchor(message, anchor));
}

function isAfterAnchor(message: ClassChatMessage, anchor: CompactionAnchor) {
  if (message.createdAt !== anchor.createdAt) {
    return message.createdAt > anchor.createdAt;
  }
  return message.id > anchor.messageId;
}

function scoreTurn(input: {
  message: ClassChatMessage;
  index: number;
  total: number;
  latestQueryTerms: string[];
}) {
  const { message, index, total, latestQueryTerms } = input;
  const content = message.content.toLowerCase();
  const messageTerms = extractTerms(message.content);
  const overlapCount = messageTerms.filter((term) => latestQueryTerms.includes(term)).length;
  const recencyFactor = (index + 1) / Math.max(1, total);
  const asksQuestion = /[?]/.test(message.content);
  const hasConfusionSignal = /(stuck|confused|not sure|don't understand|help)/i.test(content);
  const hasResolutionSignal = /(therefore|so the answer|this means|remember)/i.test(content);

  let score = 1 + recencyFactor;
  score += overlapCount * 0.8;
  if (asksQuestion && message.authorKind !== "assistant") {
    score += 1.5;
  }
  if (hasConfusionSignal && message.authorKind !== "assistant") {
    score += 1.3;
  }
  if (message.authorKind === "assistant" && message.citations.length > 0) {
    score += 1.1;
  }
  if (hasResolutionSignal && message.authorKind === "assistant") {
    score += 0.7;
  }
  return score;
}

function selectChronologicalHighlights(scoredTurns: ScoredTurn[]) {
  const selectedCount = Math.min(18, scoredTurns.length);
  const top = [...scoredTurns]
    .sort((left, right) => right.score - left.score)
    .slice(0, selectedCount)
    .sort((left, right) => compareMessageChronology(left.message, right.message));

  return top.map((entry) => entry.message);
}

function mergeSummary(input: {
  existingSummary: ChatCompactionSummary | null;
  selected: ClassChatMessage[];
  compactedThrough: ClassChatMessage;
  compactedTurnDelta: number;
  latestQueryTerms: string[];
}): ChatCompactionSummary {
  const previous = input.existingSummary;
  const generatedAt = new Date().toISOString();
  const mergedTermMap = new Map<string, { weight: number; occurrences: number; lastSeen: string }>();

  for (const term of previous?.keyTerms ?? []) {
    mergedTermMap.set(term.term, {
      weight: term.weight,
      occurrences: term.occurrences,
      lastSeen: term.lastSeen,
    });
  }

  const latestQuerySet = new Set(input.latestQueryTerms);
  input.selected.forEach((message) => {
    for (const term of extractTerms(message.content)) {
      if (!latestQuerySet.has(term) && term.length < 4) {
        continue;
      }
      const existing = mergedTermMap.get(term);
      mergedTermMap.set(term, {
        weight: (existing?.weight ?? 0) + 1,
        occurrences: (existing?.occurrences ?? 0) + 1,
        lastSeen: message.createdAt,
      });
    }
  });

  const keyTerms = [...mergedTermMap.entries()]
    .map(([term, value]) => ({
      term,
      weight: Number(value.weight.toFixed(2)),
      occurrences: value.occurrences,
      lastSeen: value.lastSeen,
    }))
    .sort((left, right) => right.weight - left.weight || right.occurrences - left.occurrences)
    .slice(0, MAX_KEY_TERMS);

  const resolvedFacts = uniq([
    ...(previous?.resolvedFacts ?? []),
    ...input.selected
      .filter((message) => message.authorKind === "assistant")
      .map((message) => firstSentence(message.content))
      .filter(Boolean),
  ]).slice(-MAX_LIST_ITEMS);

  const openQuestions = uniq([
    ...(previous?.openQuestions ?? []),
    ...input.selected
      .filter((message) => message.authorKind !== "assistant")
      .filter((message) => /[?]/.test(message.content))
      .map((message) => firstSentence(message.content))
      .filter(Boolean),
  ]).slice(-MAX_LIST_ITEMS);

  const studentNeeds = uniq([
    ...(previous?.studentNeeds ?? []),
    ...input.selected
      .filter((message) => message.authorKind !== "assistant")
      .filter((message) => /(stuck|confused|not sure|don't understand|help)/i.test(message.content))
      .map((message) => firstSentence(message.content))
      .filter(Boolean),
  ]).slice(-MAX_LIST_ITEMS);

  const highlights = uniq([
    ...(previous?.timeline.highlights ?? []),
    ...input.selected.map((message) => compactLine(message.content)),
  ]).slice(-MAX_HIGHLIGHTS);

  const priorCount = previous?.compactedThrough.turnCount ?? 0;
  const summary: ChatCompactionSummary = {
    version: "v1",
    generatedAt,
    compactedThrough: {
      createdAt: input.compactedThrough.createdAt,
      messageId: input.compactedThrough.id,
      turnCount: priorCount + input.compactedTurnDelta,
    },
    keyTerms,
    resolvedFacts,
    openQuestions,
    studentNeeds,
    timeline: {
      from: previous?.timeline.from ?? input.selected[0]?.createdAt ?? input.compactedThrough.createdAt,
      to: input.compactedThrough.createdAt,
      highlights,
    },
  };

  return summary;
}

function firstSentence(text: string) {
  const sentence = text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return compactLine(sentence);
}

function compactLine(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 160) {
    return clean;
  }
  return `${clean.slice(0, 157).trim()}...`;
}

function extractTerms(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !STOP_WORDS.has(item));
}

function uniq(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
