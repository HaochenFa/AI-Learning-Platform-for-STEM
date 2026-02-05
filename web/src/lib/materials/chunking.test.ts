import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaterialSegment } from "@/lib/materials/extract-text";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

async function loadChunking(overrides: Record<string, string> = {}) {
  process.env = { ...ORIGINAL_ENV, ...overrides };
  vi.resetModules();
  return import("@/lib/materials/chunking");
}

describe("estimateTokenCount", () => {
  it("returns at least one token", async () => {
    const { estimateTokenCount } = await loadChunking();
    expect(estimateTokenCount("")).toBe(1);
    expect(estimateTokenCount("   ")).toBe(1);
  });

  it("rounds up by character length", async () => {
    const { estimateTokenCount } = await loadChunking();
    expect(estimateTokenCount("abcd")).toBe(1);
    expect(estimateTokenCount("abcde")).toBe(2);
    expect(estimateTokenCount("abcdefgh")).toBe(2);
  });
});

describe("chunkSegments", () => {
  it("skips segments with only whitespace", async () => {
    const { chunkSegments } = await loadChunking();
    const segments: MaterialSegment[] = [
      {
        text: "   ",
        sourceType: "page",
        sourceIndex: 1,
        extractionMethod: "text",
      },
    ];
    expect(chunkSegments(segments)).toEqual([]);
  });

  it("returns a single chunk when under the limit", async () => {
    const { chunkSegments, estimateTokenCount } = await loadChunking({
      CHUNK_TOKENS: "100",
    });
    const segment: MaterialSegment = {
      text: "Short chunk text",
      sourceType: "page",
      sourceIndex: 2,
      sectionTitle: "Section 1",
      extractionMethod: "text",
      qualityScore: 0.72,
    };

    const chunks = chunkSegments([segment]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(segment.text);
    expect(chunks[0]?.sourceType).toBe(segment.sourceType);
    expect(chunks[0]?.sourceIndex).toBe(segment.sourceIndex);
    expect(chunks[0]?.sectionTitle).toBe(segment.sectionTitle);
    expect(chunks[0]?.extractionMethod).toBe(segment.extractionMethod);
    expect(chunks[0]?.qualityScore).toBe(segment.qualityScore);
    expect(chunks[0]?.tokenCount).toBe(estimateTokenCount(segment.text));
  });

  it("splits long segments and applies overlap", async () => {
    const { chunkSegments, estimateTokenCount } = await loadChunking({
      CHUNK_TOKENS: "3",
      CHUNK_OVERLAP: "1",
    });

    const segment: MaterialSegment = {
      text: "alpha bravo charl delta",
      sourceType: "page",
      sourceIndex: 3,
      sectionTitle: "Section 2",
      extractionMethod: "text",
    };

    const chunks = chunkSegments([segment]);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "alpha bravo",
      "bravo charl",
      "charl delta",
    ]);
    expect(chunks.map((chunk) => chunk.tokenCount)).toEqual([
      estimateTokenCount("alpha bravo"),
      estimateTokenCount("bravo charl"),
      estimateTokenCount("charl delta"),
    ]);
    chunks.forEach((chunk) => {
      expect(chunk.sourceType).toBe(segment.sourceType);
      expect(chunk.sourceIndex).toBe(segment.sourceIndex);
      expect(chunk.sectionTitle).toBe(segment.sectionTitle);
      expect(chunk.extractionMethod).toBe(segment.extractionMethod);
    });
  });

  it("derives overlap in words from token overlap", async () => {
    const { chunkSegments } = await loadChunking({
      CHUNK_TOKENS: "4",
      CHUNK_OVERLAP: "3",
    });

    const segment: MaterialSegment = {
      text: "aaaa bbbbb cccc dddd",
      sourceType: "page",
      sourceIndex: 4,
      extractionMethod: "text",
    };

    const chunks = chunkSegments([segment]);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["aaaa bbbbb cccc", "bbbbb cccc dddd"]);
  });

  it("makes progress on extremely long single words", async () => {
    const { chunkSegments } = await loadChunking({
      CHUNK_TOKENS: "2",
      CHUNK_OVERLAP: "1",
    });

    const segment: MaterialSegment = {
      text: `${"a".repeat(50)} ok`,
      sourceType: "page",
      sourceIndex: 5,
      extractionMethod: "text",
    };

    const chunks = chunkSegments([segment]);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["a".repeat(50), "ok"]);
  });
});
