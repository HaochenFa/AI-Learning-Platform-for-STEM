import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateBlueprint } from "@/app/classes/[classId]/blueprint/actions";
import { redirect } from "next/navigation";
import { buildBlueprintPrompt, parseBlueprintResponse } from "@/lib/ai/blueprint";
import { generateTextWithFallback } from "@/lib/ai/providers";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("@/lib/ai/blueprint", () => ({
  buildBlueprintPrompt: vi.fn(() => ({
    system: "system",
    user: "user",
  })),
  parseBlueprintResponse: vi.fn(),
}));

vi.mock("@/lib/ai/providers", () => ({
  generateTextWithFallback: vi.fn(),
}));

const supabaseAuth = {
  getUser: vi.fn(),
};
const supabaseFromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: supabaseAuth,
    from: supabaseFromMock,
  }),
}));

const adminFromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: adminFromMock,
  }),
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.single = vi.fn(async () => resolveResult());
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.then = (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
    Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    order: () => typeof builder;
    limit: () => typeof builder;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
    insert: () => typeof builder;
    update: () => typeof builder;
    delete: () => typeof builder;
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) => Promise<unknown>;
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

describe("generateBlueprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when unauthenticated", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: null } });
    await expectRedirect(() => generateBlueprint("class-1"), "/login");
    expect(redirect).toHaveBeenCalled();
  });

  it("redirects when no materials are ready", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", owner_id: "u1", title: "Math" },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    adminFromMock.mockImplementation((table: string) => {
      if (table === "materials") {
        return makeBuilder({ data: [], error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => generateBlueprint("class-1"),
      "/classes/class-1/blueprint?error=Upload%20at%20least%20one%20processed%20material"
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("generates a blueprint and redirects on success", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: {
            id: "class-1",
            owner_id: "u1",
            title: "Math",
            subject: "Mathematics",
            level: "College",
          },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    let blueprintCall = 0;
    let topicCall = 0;

    adminFromMock.mockImplementation((table: string) => {
      if (table === "materials") {
        return makeBuilder({
          data: [
            { id: "m1", title: "Lecture", extracted_text: "content", status: "ready" },
          ],
          error: null,
        });
      }
      if (table === "blueprints") {
        blueprintCall += 1;
        if (blueprintCall === 1) {
          return makeBuilder({ data: null, error: null });
        }
        return makeBuilder({ data: { id: "bp-1" }, error: null });
      }
      if (table === "topics") {
        topicCall += 1;
        return makeBuilder({ data: { id: `topic-${topicCall}` }, error: null });
      }
      if (table === "objectives") {
        return makeBuilder({ error: null });
      }
      if (table === "ai_requests") {
        return makeBuilder({ error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    vi.mocked(generateTextWithFallback).mockResolvedValue({
      provider: "openrouter",
      model: "model",
      content: "{\"summary\":\"ok\"}",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      latencyMs: 10,
    });

    vi.mocked(buildBlueprintPrompt).mockReturnValue({
      system: "system",
      user: "user",
    });

    vi.mocked(parseBlueprintResponse).mockReturnValue({
      summary: "Summary",
      topics: [
        {
          key: "topic-1",
          title: "Limits",
          sequence: 1,
          objectives: [{ statement: "Define limits." }],
        },
      ],
    });

    await expectRedirect(
      () => generateBlueprint("class-1"),
      "/classes/class-1/blueprint?generated=1"
    );
    expect(redirect).toHaveBeenCalled();
  });
});
