import { describe, expect, it } from "vitest";
import {
  buildFlashcardsGenerationPrompt,
  parseFlashcardsGenerationResponse,
} from "@/lib/flashcards/generation";

describe("buildFlashcardsGenerationPrompt", () => {
  it("includes quality and grounding guidance", () => {
    const prompt = buildFlashcardsGenerationPrompt({
      classTitle: "Chemistry 101",
      cardCount: 4,
      instructions: "Prioritize acids and bases.",
      blueprintContext: "Topic 1: pH scale",
      materialContext: "Source 1 | Notes | page 1",
    });

    expect(prompt.system).toContain("learning designer");
    expect(prompt.user).toContain("Cover multiple blueprint topics/objectives");
    expect(prompt.user).toContain("Card count: 4");
  });
});

describe("parseFlashcardsGenerationResponse", () => {
  it("parses valid flashcards payload", () => {
    const parsed = parseFlashcardsGenerationResponse(
      JSON.stringify({
        cards: [
          {
            front: "What is pH?",
            back: "pH measures hydrogen ion concentration on a logarithmic acidity scale.",
          },
        ],
      }),
    );

    expect(parsed.cards).toHaveLength(1);
  });

  it("parses wrapped responses with multiple top-level objects", () => {
    const parsed = parseFlashcardsGenerationResponse(
      [
        '{"meta":"debug"}',
        JSON.stringify({
          cards: [
            {
              front: "Define neutralization reaction.",
              back: "Neutralization occurs when acid and base react to form salt and water.",
            },
          ],
        }),
      ].join("\n"),
    );

    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0]?.front).toContain("neutralization");
  });

  it("truncates oversized card arrays before validation", () => {
    const oversizedCards = Array.from({ length: 32 }, (_, index) => ({
      front: `Card ${index + 1} prompt`,
      back: `Card ${index + 1} has a grounded explanation for this concept.`,
    }));

    const parsed = parseFlashcardsGenerationResponse(JSON.stringify({ cards: oversizedCards }));
    expect(parsed.cards).toHaveLength(30);
  });

  it("keeps deterministic error when no valid object is present", () => {
    expect(() => parseFlashcardsGenerationResponse("No structured output.")).toThrow(
      "No JSON object found in flashcards generation response.",
    );
  });

  it("returns invalid JSON error for malformed object-only output", () => {
    expect(() => parseFlashcardsGenerationResponse('{"cards": [}')).toThrow(
      "Flashcards generation response is not valid JSON.",
    );
  });
});
