import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateFlashcardsDraft } from "@/app/classes/[classId]/flashcards/actions";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

const {
  requireAuthenticatedUser,
  getClassAccess,
  requirePublishedBlueprintId,
  loadPublishedBlueprintContext,
  retrieveMaterialContext,
  buildFlashcardsGenerationPrompt,
  parseFlashcardsGenerationResponse,
  generateTextWithFallback,
} = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getClassAccess: vi.fn(),
  requirePublishedBlueprintId: vi.fn(),
  loadPublishedBlueprintContext: vi.fn(),
  retrieveMaterialContext: vi.fn(),
  buildFlashcardsGenerationPrompt: vi.fn(),
  parseFlashcardsGenerationResponse: vi.fn(),
  generateTextWithFallback: vi.fn(),
}));

vi.mock("@/lib/activities/access", () => ({
  requireAuthenticatedUser,
  getClassAccess,
}));

vi.mock("@/lib/activities/assignments", () => ({
  requirePublishedBlueprintId,
  createWholeClassAssignment: vi.fn(),
  loadStudentAssignmentContext: vi.fn(),
}));

vi.mock("@/lib/chat/context", () => ({
  loadPublishedBlueprintContext,
}));

vi.mock("@/lib/materials/retrieval", () => ({
  retrieveMaterialContext,
}));

vi.mock("@/lib/flashcards/generation", () => ({
  buildFlashcardsGenerationPrompt,
  parseFlashcardsGenerationResponse,
}));

vi.mock("@/lib/ai/providers", () => ({
  generateTextWithFallback,
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.single = vi.fn(async () => resolveResult());
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    order: () => typeof builder;
    insert: () => typeof builder;
    update: () => typeof builder;
    delete: () => typeof builder;
    single: () => Promise<unknown>;
    maybeSingle: () => Promise<unknown>;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

async function expectRedirect(action: () => Promise<void> | void, path: string) {
  try {
    await Promise.resolve().then(action);
    throw new Error("Expected redirect");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) {
      expect(String((error as { digest?: string }).digest)).toContain(`;${path};`);
      return;
    }
    throw error;
  }
}

describe("flashcards actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PYTHON_BACKEND_ENABLED;
    delete process.env.PYTHON_BACKEND_FLASHCARDS_ENABLED;
    delete process.env.PYTHON_BACKEND_URL;
    delete process.env.PYTHON_BACKEND_API_KEY;
    delete process.env.PYTHON_BACKEND_STRICT;
    getClassAccess.mockResolvedValue({
      found: true,
      isTeacher: true,
      isMember: true,
      classTitle: "Calculus",
    });
    requirePublishedBlueprintId.mockResolvedValue("bp-1");
    loadPublishedBlueprintContext.mockResolvedValue({
      blueprintContext: "Limits and derivatives",
    });
    retrieveMaterialContext.mockResolvedValue("Material context");
    buildFlashcardsGenerationPrompt.mockReturnValue({ system: "system", user: "user" });
    generateTextWithFallback.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      content: "{}",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 12,
    });
  });

  it("redirects to edit page after successfully generating a draft", async () => {
    const supabaseFromMock = vi.fn();
    requireAuthenticatedUser.mockResolvedValue({
      supabase: { from: supabaseFromMock },
      user: { id: "teacher-1" },
    });
    parseFlashcardsGenerationResponse.mockReturnValue({
      cards: [
        {
          front: "What is 1 + 1?",
          back: "2",
        },
      ],
    });

    const activityInsertBuilder = makeBuilder({ data: { id: "activity-1" }, error: null });
    const cardsInsertBuilder = makeBuilder({ error: null });
    const aiRequestsBuilder = makeBuilder({ error: null });

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "activities") {
        return activityInsertBuilder;
      }
      if (table === "flashcards") {
        return cardsInsertBuilder;
      }
      if (table === "ai_requests") {
        return aiRequestsBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("title", "Generated Flashcards");
    formData.set("instructions", "Use only class notes.");
    formData.set("card_count", "1");

    await expectRedirect(
      () => generateFlashcardsDraft("class-1", formData),
      "/classes/class-1/activities/flashcards/activity-1/edit?created=1",
    );

    expect(aiRequestsBuilder.insert).toHaveBeenCalledTimes(1);
    expect(aiRequestsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        class_id: "class-1",
        user_id: "teacher-1",
        provider: "openai",
        status: "success",
      }),
    );
  });

  it("routes flashcards generation through python backend when enabled", async () => {
    process.env.PYTHON_BACKEND_ENABLED = "true";
    process.env.PYTHON_BACKEND_FLASHCARDS_ENABLED = "true";
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    process.env.PYTHON_BACKEND_API_KEY = "secret";

    const supabaseFromMock = vi.fn();
    requireAuthenticatedUser.mockResolvedValue({
      supabase: { from: supabaseFromMock },
      user: { id: "teacher-1" },
    });

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: {
          payload: {
            cards: [
              {
                front: "What is 1 + 1?",
                back: "The sum equals 2.",
              },
            ],
          },
          provider: "openrouter",
          model: "or-model",
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          latency_ms: 30,
        },
      }),
    );

    const activityInsertBuilder = makeBuilder({ data: { id: "activity-1" }, error: null });
    const cardsInsertBuilder = makeBuilder({ error: null });
    const aiRequestsBuilder = makeBuilder({ error: null });

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "activities") {
        return activityInsertBuilder;
      }
      if (table === "flashcards") {
        return cardsInsertBuilder;
      }
      if (table === "ai_requests") {
        return aiRequestsBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("title", "Generated Flashcards");
    formData.set("instructions", "Use only class notes.");
    formData.set("card_count", "1");

    await expectRedirect(
      () => generateFlashcardsDraft("class-1", formData),
      "/classes/class-1/activities/flashcards/activity-1/edit?created=1",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(buildFlashcardsGenerationPrompt).not.toHaveBeenCalled();
    expect(generateTextWithFallback).not.toHaveBeenCalled();
    expect(parseFlashcardsGenerationResponse).not.toHaveBeenCalled();
    expect(aiRequestsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        model: "or-model",
      }),
    );
    fetchMock.mockRestore();
  });

  it("shows a friendly message when an internal redirect token is raised as an error", async () => {
    const supabaseFromMock = vi.fn();
    requireAuthenticatedUser.mockResolvedValue({
      supabase: { from: supabaseFromMock },
      user: { id: "teacher-1" },
    });
    parseFlashcardsGenerationResponse.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    const aiRequestsBuilder = makeBuilder({ error: null });

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "ai_requests") {
        return aiRequestsBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("title", "Generated Flashcards");
    formData.set("instructions", "Use only class notes.");
    formData.set("card_count", "1");

    await expectRedirect(
      () => generateFlashcardsDraft("class-1", formData),
      "/classes/class-1/activities/flashcards/new?error=Unable%20to%20generate%20flashcards%20draft%20right%20now.%20Please%20try%20again.",
    );

    expect(aiRequestsBuilder.insert).toHaveBeenCalledTimes(1);
    expect(aiRequestsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
      }),
    );
  });
});

function makeJsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}
