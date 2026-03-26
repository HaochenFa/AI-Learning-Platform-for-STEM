import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateEmbeddingsWithFallback,
  generateTextWithFallback,
  resolveProviderOrder,
} from "@/lib/ai/providers";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveProviderOrder", () => {
  it("throws when no providers are configured", () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;

    expect(() => resolveProviderOrder()).toThrow("No AI providers are configured.");
  });

  it("prioritizes the default provider when configured", () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.OPENROUTER_MODEL = "or-model";
    process.env.OPENAI_API_KEY = "oa-key";
    process.env.OPENAI_MODEL = "oa-model";
    process.env.AI_PROVIDER_DEFAULT = "openai";

    const order = resolveProviderOrder();
    expect(order[0]).toBe("openai");
    expect(order).toEqual(["openai", "openrouter"]);
  });

  it("ignores invalid default providers", () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.OPENROUTER_MODEL = "or-model";
    process.env.AI_PROVIDER_DEFAULT = "invalid";

    const order = resolveProviderOrder();
    expect(order).toEqual(["openrouter"]);
  });
});

describe("generateTextWithFallback", () => {
  it("throws when PYTHON_BACKEND_URL is not set", async () => {
    delete process.env.PYTHON_BACKEND_URL;

    await expect(
      generateTextWithFallback({ system: "sys", user: "user" }),
    ).rejects.toThrow("PYTHON_BACKEND_URL is not configured.");
  });

  it("routes generation through python backend when enabled", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: {
          provider: "openai",
          model: "gpt-test",
          content: '{"summary":"from-python","topics":[]}',
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          latency_ms: 42,
        },
        meta: { request_id: "req-1" },
      }),
    );

    const result = await generateTextWithFallback({
      system: "sys",
      user: "user",
    });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-test");
    expect(result.usage?.totalTokens).toBe(3);
  });

  it("routes generation through python backend when url is configured", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: {
          provider: "openrouter",
          model: "or-test",
          content: '{"summary":"python-only","topics":[]}',
          usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
          latency_ms: 35,
        },
      }),
    );

    const result = await generateTextWithFallback({
      system: "sys",
      user: "user",
    });

    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("or-test");
    expect(result.usage?.totalTokens).toBe(12);
  });

  it("throws when python backend fails while python routing is active", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(
        {
          ok: false,
          error: { message: "backend unavailable" },
        },
        false,
      ),
    );
    await expect(
      generateTextWithFallback({
        system: "sys",
        user: "user",
      }),
    ).rejects.toThrow("backend unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when python backend returns an error", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse(
        {
          ok: false,
          error: { message: "python backend hard fail" },
        },
        false,
      ),
    );

    await expect(
      generateTextWithFallback({
        system: "sys",
        user: "user",
      }),
    ).rejects.toThrow("python backend hard fail");
  });

  it("throws a backend status error when python backend returns an invalid envelope body", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeInvalidJsonResponse(true));

    await expect(
      generateTextWithFallback({
        system: "sys",
        user: "user",
      }),
    ).rejects.toThrow("Python backend request failed with 200.");
  });
});

describe("generateEmbeddingsWithFallback", () => {
  it("routes embeddings through python backend when enabled", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: {
          provider: "openrouter",
          model: "embed-model",
          embeddings: [[0.1, 0.2]],
          usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
          latency_ms: 25,
        },
      }),
    );

    const result = await generateEmbeddingsWithFallback({
      inputs: ["hello"],
      accessToken: "guest-token",
      sandboxId: "sandbox-1",
    });
    expect(result.provider).toBe("openrouter");
    expect(result.embeddings).toHaveLength(1);
    expect(result.usage?.totalTokens).toBe(10);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8001/v1/llm/embeddings",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer guest-token",
        }),
        body: expect.stringContaining('"sandbox_id":"sandbox-1"'),
      }),
    );
  });
});

function makeJsonResponse(payload: unknown, ok = true) {
  return new Response(JSON.stringify(payload), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
}

function makeInvalidJsonResponse(ok = true) {
  return new Response("{not-valid-json", {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
}
