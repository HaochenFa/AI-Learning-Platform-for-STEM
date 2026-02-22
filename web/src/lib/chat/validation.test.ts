import { describe, expect, it } from "vitest";
import {
  buildChatAssignmentSubmissionContent,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_TURNS,
  MAX_REFLECTION_CHARS,
  parseChatMessage,
  parseChatModelResponse,
  parseChatTurns,
  parseDueAt,
  parseHighlights,
  parseOptionalScore,
  parseChatCompactionSummary,
  parseReflection,
} from "@/lib/chat/validation";

describe("chat validation", () => {
  it("parses a valid chat message", () => {
    expect(parseChatMessage("  Explain limits  ")).toBe("Explain limits");
  });

  it("rejects long chat messages", () => {
    const raw = "x".repeat(MAX_CHAT_MESSAGE_CHARS + 1);
    expect(() => parseChatMessage(raw)).toThrow("Message exceeds");
  });

  it("parses transcript turns", () => {
    const turns = parseChatTurns(
      JSON.stringify([
        {
          role: "student",
          message: "What is a derivative?",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]?.role).toBe("student");
  });

  it("rejects transcript beyond turn limit", () => {
    const turns = Array.from({ length: MAX_CHAT_TURNS + 1 }, (_, index) => ({
      role: "student",
      message: `Turn ${index}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    expect(() => parseChatTurns(JSON.stringify(turns))).toThrow("Transcript cannot exceed");
  });

  it("parses model response JSON deterministically", () => {
    const parsed = parseChatModelResponse(
      JSON.stringify({
        safety: "ok",
        answer: "Use the limit definition first.",
        citations: [{ sourceLabel: "Source 1", rationale: "Defines formal limit notation." }],
      }),
    );
    expect(parsed.safety).toBe("ok");
    expect(parsed.citations[0]?.sourceLabel).toBe("Source 1");
  });

  it("extracts a nested object from wrapped model output", () => {
    const raw = `Model reply:\n${JSON.stringify({
      safety: "ok",
      answer: "Compare f(x) at {a+h} and {a}.",
      citations: [
        {
          sourceLabel: "Lecture 2",
          rationale: "Shows nested algebraic manipulation for a derivative.",
        },
      ],
    })}\nEnd.`;

    const parsed = parseChatModelResponse(raw);
    expect(parsed.answer).toContain("{a+h}");
  });

  it("rejects responses containing multiple JSON objects", () => {
    const first = JSON.stringify({
      safety: "ok",
      answer: "First object",
      citations: [],
    });
    const second = JSON.stringify({
      safety: "ok",
      answer: "Second object",
      citations: [],
    });

    expect(() => parseChatModelResponse(`${first}\n${second}`)).toThrow(
      "Multiple JSON objects found",
    );
  });

  it("rejects invalid model safety values", () => {
    expect(() =>
      parseChatModelResponse(
        JSON.stringify({
          safety: "unsafe",
          answer: "No",
          citations: [],
        }),
      ),
    ).toThrow("Model response safety");
  });

  it("enforces reflection size and non-empty requirement", () => {
    expect(parseReflection("  I learned chain rule setup. ")).toBe("I learned chain rule setup.");
    expect(() => parseReflection(" ")).toThrow("Reflection is required");
    expect(() => parseReflection("x".repeat(MAX_REFLECTION_CHARS + 1))).toThrow(
      "Reflection exceeds",
    );
  });

  it("parses optional score within bounds", () => {
    expect(parseOptionalScore("88")).toBe(88);
    expect(parseOptionalScore("")).toBeNull();
    expect(() => parseOptionalScore("101")).toThrow("between 0 and 100");
  });

  it("normalizes highlights and limits to 10 entries", () => {
    const veryLongLine = "A".repeat(5000);
    const raw = [
      "  First concept  ",
      "",
      "Second concept",
      "  ", // whitespace-only line should be removed
      "Special chars: !@#$%^&*() && [] {}",
      veryLongLine,
      "h5",
      "h6",
      "h7",
      "h8",
      "h9",
      "h10",
      "h11 should be dropped",
    ].join("\n");

    const highlights = parseHighlights(raw);
    expect(highlights).toHaveLength(10);
    expect(highlights[0]).toBe("First concept");
    expect(highlights[1]).toBe("Second concept");
    expect(highlights[2]).toContain("!@#$%");
    expect(highlights[3]).toBe(veryLongLine);
    expect(highlights[9]).toBe("h10");
    expect(highlights).not.toContain("h11 should be dropped");
  });

  it("returns empty highlights for null or blank input", () => {
    expect(parseHighlights(null)).toEqual([]);
    expect(parseHighlights("\n   \n\t")).toEqual([]);
  });

  it("parses due dates and returns ISO string", () => {
    expect(parseDueAt("2026-02-01T15:30:00-05:00")).toBe("2026-02-01T20:30:00.000Z");
  });

  it("returns null for empty due date input", () => {
    expect(parseDueAt(null)).toBeNull();
    expect(parseDueAt("   ")).toBeNull();
  });

  it("rejects invalid due dates", () => {
    expect(() => parseDueAt("not-a-date")).toThrow("Due date is invalid.");
    expect(() => parseDueAt("2026-13-40")).toThrow("Due date is invalid.");
  });

  it("builds assignment submission content", () => {
    const content = buildChatAssignmentSubmissionContent({
      activityId: "activity-1",
      transcript: [
        {
          role: "student",
          message: "How does this work?",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      reflection: "I should review prerequisites first.",
    });

    expect(content.mode).toBe("chat_assignment");
    expect(content.activityId).toBe("activity-1");
    expect(content.transcript).toHaveLength(1);
    expect(content.reflection).toContain("review");
  });

  it("parses chat compaction summary payloads", () => {
    const parsed = parseChatCompactionSummary({
      version: "v1",
      generatedAt: "2026-02-10T00:00:00.000Z",
      compactedThrough: {
        createdAt: "2026-02-10T00:00:00.000Z",
        messageId: "m-1",
        turnCount: 10,
      },
      keyTerms: [
        {
          term: "checksum",
          weight: 2,
          occurrences: 2,
          lastSeen: "2026-02-10T00:00:00.000Z",
        },
      ],
      resolvedFacts: ["checksum uses one's complement"],
      openQuestions: ["why complement output?"],
      studentNeeds: ["more examples"],
      timeline: {
        from: "2026-02-09T00:00:00.000Z",
        to: "2026-02-10T00:00:00.000Z",
        highlights: ["reviewed algorithm"],
      },
    });
    expect(parsed?.version).toBe("v1");
    expect(parsed?.keyTerms[0]?.term).toBe("checksum");
  });
});
