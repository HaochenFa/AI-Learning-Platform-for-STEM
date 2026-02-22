import { describe, expect, it } from "vitest";
import {
  buildCompactionDecision,
  buildCompactionMemoryText,
  buildCompactionResult,
  parseCompactionSummary,
} from "@/lib/chat/compaction";
import type { ChatCompactionSummary, ClassChatMessage } from "@/lib/chat/types";

function makeMessage(input: {
  id: string;
  createdAt: string;
  authorKind: "student" | "teacher" | "assistant";
  content: string;
  citations?: { sourceLabel: string; snippet?: string }[];
}): ClassChatMessage {
  return {
    id: input.id,
    sessionId: "session-1",
    classId: "class-1",
    authorUserId: input.authorKind === "assistant" ? null : "user-1",
    authorKind: input.authorKind,
    content: input.content,
    citations: input.citations ?? [],
    safety: input.authorKind === "assistant" ? "ok" : null,
    provider: null,
    model: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    latencyMs: null,
    createdAt: input.createdAt,
  };
}

describe("chat compaction", () => {
  it("parses valid summary payloads", () => {
    const raw: ChatCompactionSummary = {
      version: "v1",
      generatedAt: "2026-02-10T00:00:00.000Z",
      compactedThrough: {
        createdAt: "2026-02-10T00:00:00.000Z",
        messageId: "m10",
        turnCount: 10,
      },
      keyTerms: [{ term: "checksum", weight: 3, occurrences: 2, lastSeen: "2026-02-10T00:00:00.000Z" }],
      resolvedFacts: ["Bitwise NOT flips all bits."],
      openQuestions: ["Why is the checksum complemented?"],
      studentNeeds: ["Clarify one's-complement arithmetic."],
      timeline: {
        from: "2026-02-09T00:00:00.000Z",
        to: "2026-02-10T00:00:00.000Z",
        highlights: ["Reviewed checksum arithmetic."],
      },
    };

    const parsed = parseCompactionSummary(raw);
    expect(parsed?.version).toBe("v1");
    expect(parsed?.compactedThrough.turnCount).toBe(10);
  });

  it("builds compaction output with key terms and highlights", () => {
    const messages = [
      makeMessage({
        id: "m1",
        createdAt: "2026-02-10T10:00:00.000Z",
        authorKind: "student",
        content: "I am stuck on checksum and one's complement.",
      }),
      makeMessage({
        id: "m2",
        createdAt: "2026-02-10T10:01:00.000Z",
        authorKind: "assistant",
        content: "Checksum uses one's complement sum and then bitwise NOT.",
        citations: [{ sourceLabel: "Source 1", snippet: "Checksum process" }],
      }),
      makeMessage({
        id: "m3",
        createdAt: "2026-02-10T10:02:00.000Z",
        authorKind: "student",
        content: "Why do we flip all bits at the end?",
      }),
      makeMessage({
        id: "m4",
        createdAt: "2026-02-10T10:03:00.000Z",
        authorKind: "assistant",
        content: "Flipping creates the one's complement checksum value for validation.",
        citations: [{ sourceLabel: "Blueprint Context", snippet: "Networking objective" }],
      }),
      makeMessage({
        id: "m5",
        createdAt: "2026-02-10T10:04:00.000Z",
        authorKind: "student",
        content: "Can we do one more example?",
      }),
      makeMessage({
        id: "m6",
        createdAt: "2026-02-10T10:05:00.000Z",
        authorKind: "assistant",
        content: "Sure, let's walk through another example.",
      }),
    ];

    const result = buildCompactionResult({
      messages,
      existingSummary: null,
      latestUserMessage: "Can you explain checksum complement again?",
      recentTurns: 2,
    });

    expect(result).not.toBeNull();
    expect(result?.summary.keyTerms.some((item) => item.term.includes("checksum"))).toBe(true);
    expect(result?.summary.timeline.highlights.length).toBeGreaterThan(0);
    expect(result?.summaryText).toContain("Compacted conversation memory");
  });

  it("triggers compaction under token pressure", () => {
    const messages = Array.from({ length: 35 }, (_, index) =>
      makeMessage({
        id: `m-${index}`,
        createdAt: `2026-02-10T10:${String(index).padStart(2, "0")}:00.000Z`,
        authorKind: index % 2 === 0 ? "student" : "assistant",
        content: `Detailed checksum explanation turn ${index} with many repeated terms checksum ones complement arithmetic`,
      }),
    );

    const decision = buildCompactionDecision({
      messages,
      existingSummary: null,
      pendingUserMessage: "Please continue this checksum analysis with more detail.",
      recentTurns: 10,
      triggerTurns: 10,
      minNewTurns: 4,
    });

    expect(decision.shouldCompact).toBe(true);
  });

  it("tracks compacted turn count through the selected anchor only", () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      makeMessage({
        id: `m${index + 1}`,
        createdAt: `2026-02-10T10:${String(index).padStart(2, "0")}:00.000Z`,
        authorKind: index % 2 === 0 ? "student" : "assistant",
        content:
          index < 20
            ? "Can you explain derivative chain rule checksum overlap terms again?"
            : "Thanks.",
      }),
    );

    const result = buildCompactionResult({
      messages,
      existingSummary: {
        version: "v1",
        generatedAt: "2026-02-09T09:00:00.000Z",
        compactedThrough: {
          createdAt: "2026-02-09T09:00:00.000Z",
          messageId: "m0",
          turnCount: 5,
        },
        keyTerms: [],
        resolvedFacts: [],
        openQuestions: [],
        studentNeeds: [],
        timeline: {
          from: "2026-02-09T09:00:00.000Z",
          to: "2026-02-09T09:00:00.000Z",
          highlights: [],
        },
      },
      latestUserMessage: "Explain derivative chain rule overlap terms.",
      recentTurns: 2,
    });

    expect(result).not.toBeNull();
    if (!result) {
      return;
    }

    const compactableCandidates = messages.slice(0, messages.length - 2);
    const anchorIndex = compactableCandidates.findIndex(
      (candidate) => candidate.id === result.summary.compactedThrough.messageId,
    );
    expect(anchorIndex).toBeGreaterThanOrEqual(0);
    expect(result.summary.compactedThrough.turnCount).toBe(5 + anchorIndex + 1);
  });

  it("builds readable memory context text", () => {
    const summary: ChatCompactionSummary = {
      version: "v1",
      generatedAt: "2026-02-10T00:00:00.000Z",
      compactedThrough: {
        createdAt: "2026-02-10T00:00:00.000Z",
        messageId: "m10",
        turnCount: 10,
      },
      keyTerms: [{ term: "checksum", weight: 4, occurrences: 3, lastSeen: "2026-02-10T00:00:00.000Z" }],
      resolvedFacts: ["Bitwise NOT flips bits."],
      openQuestions: ["Why complement at the end?"],
      studentNeeds: ["More worked examples."],
      timeline: {
        from: "2026-02-09T00:00:00.000Z",
        to: "2026-02-10T00:00:00.000Z",
        highlights: ["Discussed checksum process"],
      },
    };

    const context = buildCompactionMemoryText(summary);
    expect(context).toContain("Key terms");
    expect(context).toContain("prefer the recent transcript");
  });
});
