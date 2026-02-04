import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTextWithFallback, resolveProviderOrder } from "@/lib/ai/providers";

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
        choices: [{ message: { content: "{\"summary\":\"ok\",\"topics\":[{\"key\":\"t\",\"title\":\"T\",\"sequence\":1,\"objectives\":[{\"statement\":\"s\"}]}]}" } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      })
    );

    const result = await generateTextWithFallback({
      system: "sys",
      user: "user",
    });

    expect(result.provider).toBe("openrouter");
    expect(result.usage?.totalTokens).toBe(30);
  });

  it("falls back when the first provider fails", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.OPENROUTER_MODEL = "or-model";
    process.env.OPENAI_API_KEY = "oa-key";
    process.env.OPENAI_MODEL = "oa-model";

    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: { message: "OpenRouter down" } }, false)
    );
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        choices: [{ message: { content: "{\"summary\":\"ok\",\"topics\":[{\"key\":\"t\",\"title\":\"T\",\"sequence\":1,\"objectives\":[{\"statement\":\"s\"}]}]}" } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      })
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
      makeJsonResponse({ error: { message: "Nope" } }, false)
    );

    await expect(
      generateTextWithFallback({
        system: "sys",
        user: "user",
      })
    ).rejects.toThrow("Nope");
  });
});

function makeJsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}
