import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateGroundedChatResponse } from "@/lib/chat/generate";

const {
  generateTextWithFallback,
  generateChatViaPythonBackend,
  buildChatPrompt,
  loadPublishedBlueprintContext,
  parseChatModelResponse,
  retrieveMaterialContext,
  createServerSupabaseClient,
} = vi.hoisted(() => ({
  generateTextWithFallback: vi.fn(),
  generateChatViaPythonBackend: vi.fn(),
  buildChatPrompt: vi.fn(),
  loadPublishedBlueprintContext: vi.fn(),
  parseChatModelResponse: vi.fn(),
  retrieveMaterialContext: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/ai/providers", () => ({
  generateTextWithFallback,
}));

vi.mock("@/lib/ai/python-chat", () => ({
  generateChatViaPythonBackend,
}));

vi.mock("@/lib/chat/context", () => ({
  buildChatPrompt,
  loadPublishedBlueprintContext,
}));

vi.mock("@/lib/chat/validation", () => ({
  parseChatModelResponse,
}));

vi.mock("@/lib/materials/retrieval", () => ({
  retrieveMaterialContext,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient,
}));

describe("generateGroundedChatResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CHAT_GENERATION_MAX_TOKENS;
    delete process.env.PYTHON_BACKEND_ENABLED;
    delete process.env.PYTHON_BACKEND_CHAT_ENABLED;
    delete process.env.PYTHON_BACKEND_STRICT;
    delete process.env.PYTHON_BACKEND_MODE;
    delete process.env.PYTHON_BACKEND_URL;
    delete process.env.PYTHON_BACKEND_CHAT_ENGINE;
    delete process.env.PYTHON_BACKEND_CHAT_TOOL_MODE;
    delete process.env.PYTHON_BACKEND_CHAT_TOOL_CATALOG;

    const insertMock = vi.fn(async () => ({ error: null }));
    createServerSupabaseClient.mockResolvedValue({
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "session-token" } },
        })),
      },
      from: vi.fn(() => ({
        insert: insertMock,
      })),
    });

    loadPublishedBlueprintContext.mockResolvedValue({
      blueprintId: "bp-1",
      summary: "Summary",
      topicCount: 1,
      blueprintContext: "Blueprint Context | Summary and topics",
    });
    retrieveMaterialContext.mockResolvedValue("Source 1 | Material snippet");
    buildChatPrompt.mockReturnValue({ system: "system", user: "user" });
    parseChatModelResponse.mockReturnValue({
      safety: "ok",
      answer: "Grounded response",
      citations: [{ sourceLabel: "Source 1", rationale: "Based on class material." }],
    });
  });

  it("routes grounded chat generation through python backend when enabled", async () => {
    process.env.PYTHON_BACKEND_ENABLED = "true";
    process.env.PYTHON_BACKEND_CHAT_ENABLED = "true";
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    generateChatViaPythonBackend.mockResolvedValue({
      payload: {
        safety: "ok",
        answer: "Grounded response",
        citations: [{ sourceLabel: "Source 1", rationale: "Based on class material." }],
      },
      provider: "openrouter",
      model: "or-model",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      latencyMs: 15,
      orchestration: {
        engine: "direct_v1",
        tool_mode: "off",
        tool_calls: [],
      },
    });

    await generateGroundedChatResponse({
      classId: "class-1",
      classTitle: "Physics",
      userId: "student-1",
      userMessage: "Can we review kinematics?",
      transcript: [],
      purpose: "student_chat_open_v2",
    });

    expect(generateChatViaPythonBackend).toHaveBeenCalledTimes(1);
    expect(generateChatViaPythonBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: "class-1",
        userId: "student-1",
        toolMode: "off",
        toolCatalog: ["grounding_context.read", "memory.search", "memory.save"],
        orchestrationHints: expect.objectContaining({
          engine: "direct_v1",
        }),
      }),
    );
    expect(generateTextWithFallback).not.toHaveBeenCalled();
    expect(parseChatModelResponse).not.toHaveBeenCalled();
  });

  it("keeps grounded chat on local generation when only PYTHON_BACKEND_ENABLED is set", async () => {
    process.env.PYTHON_BACKEND_ENABLED = "true";

    generateTextWithFallback.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      content: "{}",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 12,
    });

    await generateGroundedChatResponse({
      classId: "class-1",
      classTitle: "Physics",
      userId: "student-1",
      userMessage: "Can we review kinematics?",
      transcript: [],
      purpose: "student_chat_open_v2",
    });

    expect(generateChatViaPythonBackend).not.toHaveBeenCalled();
    expect(generateTextWithFallback).toHaveBeenCalledTimes(1);
    expect(parseChatModelResponse).toHaveBeenCalledTimes(1);
  });

  it("routes grounded chat generation through python backend when mode is python_only", async () => {
    process.env.PYTHON_BACKEND_MODE = "python_only";
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    generateChatViaPythonBackend.mockResolvedValue({
      payload: {
        safety: "ok",
        answer: "Grounded response",
        citations: [{ sourceLabel: "Source 1", rationale: "Based on class material." }],
      },
      provider: "openrouter",
      model: "or-model",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      latencyMs: 15,
      orchestration: {
        engine: "langgraph_v1",
        tool_mode: "auto",
        tool_calls: [],
      },
    });

    await generateGroundedChatResponse({
      classId: "class-1",
      classTitle: "Physics",
      userId: "student-1",
      userMessage: "Can we review kinematics?",
      transcript: [],
      purpose: "student_chat_open_v2",
    });

    expect(generateChatViaPythonBackend).toHaveBeenCalledTimes(1);
    expect(generateTextWithFallback).not.toHaveBeenCalled();
    expect(parseChatModelResponse).not.toHaveBeenCalled();
  });

  it("passes langgraph engine and tool mode hints to python chat adapter when configured", async () => {
    process.env.PYTHON_BACKEND_ENABLED = "true";
    process.env.PYTHON_BACKEND_CHAT_ENABLED = "true";
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    process.env.PYTHON_BACKEND_CHAT_ENGINE = "langgraph_v1";
    process.env.PYTHON_BACKEND_CHAT_TOOL_MODE = "plan";
    process.env.PYTHON_BACKEND_CHAT_TOOL_CATALOG = "grounding_context.read,web.search";

    generateChatViaPythonBackend.mockResolvedValue({
      payload: {
        safety: "ok",
        answer: "Grounded response",
        citations: [{ sourceLabel: "Source 1", rationale: "Based on class material." }],
      },
      provider: "openrouter",
      model: "or-model",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      latencyMs: 15,
      orchestration: {
        engine: "langgraph_v1",
        tool_mode: "plan",
        tool_calls: [],
      },
    });

    await generateGroundedChatResponse({
      classId: "class-1",
      classTitle: "Physics",
      userId: "student-1",
      userMessage: "Can we review kinematics?",
      transcript: [],
      purpose: "student_chat_open_v2",
    });

    expect(generateChatViaPythonBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: "class-1",
        userId: "student-1",
        toolMode: "plan",
        toolCatalog: ["grounding_context.read", "web.search"],
        orchestrationHints: expect.objectContaining({
          engine: "langgraph_v1",
        }),
      }),
    );
  });

  it("throws when python backend chat fails while python routing is active", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    generateChatViaPythonBackend.mockRejectedValue(new Error("Python backend chat request failed with 502."));

    await expect(
      generateGroundedChatResponse({
        classId: "class-1",
        classTitle: "Physics",
        userId: "student-1",
        userMessage: "Can we review kinematics?",
        transcript: [],
        purpose: "student_chat_open_v2",
      }),
    ).rejects.toThrow("Python backend chat request failed with 502.");

    expect(generateChatViaPythonBackend).toHaveBeenCalledTimes(1);
    expect(generateTextWithFallback).not.toHaveBeenCalled();
    expect(parseChatModelResponse).not.toHaveBeenCalled();
  });

  it("uses a default max token budget above other generators", async () => {
    generateTextWithFallback.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      content: "{}",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 12,
    });

    await generateGroundedChatResponse({
      classId: "class-1",
      classTitle: "Physics",
      userId: "student-1",
      userMessage: "Can we review kinematics?",
      transcript: [],
      purpose: "student_chat_open_v2",
    });

    expect(generateTextWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 9000,
      }),
    );
  });

  it("returns a friendly message when generation throws internal redirect tokens", async () => {
    generateTextWithFallback.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(
      generateGroundedChatResponse({
        classId: "class-1",
        classTitle: "Physics",
        userId: "student-1",
        userMessage: "Can we review kinematics?",
        transcript: [],
        purpose: "student_chat_open_v2",
      }),
    ).rejects.toThrow("Unable to generate a chat response right now. Please try again.");
  });
});
