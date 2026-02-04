import { afterEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "@/lib/materials/retrieval";

const supabaseRpcMock = vi.fn();
const generateEmbeddingsWithFallback = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    rpc: supabaseRpcMock,
  }),
}));

vi.mock("@/lib/ai/providers", () => ({
  generateEmbeddingsWithFallback,
}));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  supabaseRpcMock.mockReset();
  generateEmbeddingsWithFallback.mockReset();
});

async function loadRetrieval(overrides: Record<string, string> = {}) {
  process.env = { ...ORIGINAL_ENV, ...overrides };
  vi.resetModules();
  return import("@/lib/materials/retrieval");
}

describe("buildContext", () => {
  it("returns an empty string when no chunks exist", async () => {
    const { buildContext } = await loadRetrieval();
    expect(buildContext([])).toBe("");
  });

  it("formats chunk headers with separators", async () => {
    const { buildContext } = await loadRetrieval();
    const chunks: RetrievedChunk[] = [
      {
        id: "c1",
        material_id: "m1",
        material_title: "Intro Notes",
        source_type: "page",
        source_index: 1,
        section_title: null,
        text: "Alpha",
        token_count: 4,
        similarity: 0.9,
      },
      {
        id: "c2",
        material_id: "m2",
        material_title: "Lab Manual",
        source_type: "page",
        source_index: 3,
        section_title: null,
        text: "Beta",
        token_count: 4,
        similarity: 0.8,
      },
    ];

    expect(buildContext(chunks)).toBe(
      "Source 1 | Intro Notes | page 1\nAlpha\n\n---\n\nSource 2 | Lab Manual | page 3\nBeta",
    );
  });
});

describe("retrieveMaterialContext", () => {
  it("selects chunks within budget and per-material limits", async () => {
    const { retrieveMaterialContext } = await loadRetrieval({
      RAG_MAX_PER_MATERIAL: "2",
      RAG_MATCH_COUNT: "5",
    });

    generateEmbeddingsWithFallback.mockResolvedValueOnce({
      provider: "openai",
      model: "embedding",
      embeddings: [[0.1, 0.2]],
      latencyMs: 10,
    });

    const chunks: RetrievedChunk[] = [
      {
        id: "c1",
        material_id: "m1",
        material_title: "Doc A",
        source_type: "page",
        source_index: 1,
        section_title: null,
        text: "Alpha",
        token_count: 4,
        similarity: 0.9,
      },
      {
        id: "c2",
        material_id: "m1",
        material_title: "Doc A",
        source_type: "page",
        source_index: 2,
        section_title: null,
        text: "Beta",
        token_count: 4,
        similarity: 0.8,
      },
      {
        id: "c3",
        material_id: "m1",
        material_title: "Doc A",
        source_type: "page",
        source_index: 3,
        section_title: null,
        text: "Gamma",
        token_count: 4,
        similarity: 0.7,
      },
      {
        id: "c4",
        material_id: "m2",
        material_title: "Doc B",
        source_type: "page",
        source_index: 1,
        section_title: null,
        text: "Delta",
        token_count: 4,
        similarity: 0.6,
      },
    ];

    supabaseRpcMock.mockResolvedValueOnce({ data: chunks, error: null });

    const result = await retrieveMaterialContext("class-1", "query", 10);

    expect(generateEmbeddingsWithFallback).toHaveBeenCalledWith({ inputs: ["query"] });
    expect(supabaseRpcMock).toHaveBeenCalledWith("match_material_chunks", {
      p_class_id: "class-1",
      query_embedding: [0.1, 0.2],
      match_count: 5,
    });

    expect(result).toBe(
      "Source 1 | Doc A | page 1\nAlpha\n\n---\n\nSource 2 | Doc A | page 2\nBeta",
    );
  });

  it("uses estimated tokens when token_count is missing", async () => {
    const { retrieveMaterialContext } = await loadRetrieval({
      RAG_MATCH_COUNT: "1",
      RAG_MAX_PER_MATERIAL: "3",
    });

    generateEmbeddingsWithFallback.mockResolvedValueOnce({
      provider: "openai",
      model: "embedding",
      embeddings: [[0.3, 0.4]],
      latencyMs: 10,
    });

    const chunks: RetrievedChunk[] = [
      {
        id: "c1",
        material_id: "m1",
        material_title: "Doc A",
        source_type: "page",
        source_index: 1,
        section_title: null,
        text: "This text is long enough to exceed the budget.",
        token_count: 0,
        similarity: 0.9,
      },
    ];

    supabaseRpcMock.mockResolvedValueOnce({ data: chunks, error: null });

    const result = await retrieveMaterialContext("class-1", "query", 3);

    expect(result).toBe("");
  });

  it("throws when the RPC call fails", async () => {
    const { retrieveMaterialContext } = await loadRetrieval();

    generateEmbeddingsWithFallback.mockResolvedValueOnce({
      provider: "openai",
      model: "embedding",
      embeddings: [[0.1, 0.2]],
      latencyMs: 10,
    });

    supabaseRpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "RPC failed" },
    });

    await expect(retrieveMaterialContext("class-1", "query")).rejects.toThrow("RPC failed");
  });
});
