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
  it("returns content from the first available provider", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.OPENROUTER_MODEL = "or-model";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse({
        choices: [
          {
            message: {
              content:
                '{"summary":"ok","topics":[{"key":"t","title":"T","sequence":1,"objectives":[{"statement":"s"}]}]}',
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    );

    const result = await generateTextWithFallback({
      system: "sys",
      user: "user",
    });

    expect(result.provider).toBe("openrouter");
    expect(result.usage?.totalTokens).toBe(30);
  });

  it("normalizes array-based content from openrouter", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.OPENROUTER_MODEL = "or-model";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: '{"summary":"wrapped"' },
                { type: "text", text: ',"topics":[]}' },
              ],
            },
          },
        ],
      }),
    );

    const result = await generateTextWithFallback({
      system: "sys",
      user: "user",
    });

    expect(result.content).toBe('{"summary":"wrapped","topics":[]}');
  });

  it("falls back when the first provider fails", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.OPENROUTER_MODEL = "or-model";
    process.env.OPENAI_API_KEY = "oa-key";
    process.env.OPENAI_MODEL = "oa-model";

    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: { message: "OpenRouter down" } }, false),
    );
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        choices: [
          {
            message: {
              content:
                '{"summary":"ok","topics":[{"key":"t","title":"T","sequence":1,"objectives":[{"statement":"s"}]}]}',
            },
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }),
    );

    const result = await generateTextWithFallback({
      system: "sys",
      user: "user",
    });

    expect(result.provider).toBe("openai");
    expect(result.usage?.totalTokens).toBe(5);
  });

  it("throws when the only configured provider fails", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.OPENROUTER_MODEL = "or-model";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse({ error: { message: "Nope" } }, false),
    );

    await expect(
      generateTextWithFallback({
        system: "sys",
        user: "user",
      }),
    ).rejects.toThrow("Nope");
  });

  it("normalizes object content from openai fallback responses", async () => {
    process.env.OPENAI_API_KEY = "oa-key";
    process.env.OPENAI_MODEL = "oa-model";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse({
        choices: [
          {
            message: {
              content: {
                text: '{"summary":"object-content","topics":[]}',
              },
            },
          },
        ],
      }),
    );

    const result = await generateTextWithFallback({
      system: "sys",
      user: "user",
    });

    expect(result.provider).toBe("openai");
    expect(result.content).toBe('{"summary":"object-content","topics":[]}');
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
});

describe("generateEmbeddingsWithFallback", () => {
  it("routes embeddings through python backend when enabled", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
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

    const result = await generateEmbeddingsWithFallback({ inputs: ["hello"] });
    expect(result.provider).toBe("openrouter");
    expect(result.embeddings).toHaveLength(1);
    expect(result.usage?.totalTokens).toBe(10);
  });
});

function makeJsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}
