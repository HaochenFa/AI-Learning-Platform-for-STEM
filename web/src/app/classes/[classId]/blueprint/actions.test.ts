import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveBlueprint,
  createDraftFromPublished,
  generateBlueprint,
  publishBlueprint,
  saveDraft,
} from "@/app/classes/[classId]/blueprint/actions";
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


function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.neq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.single = vi.fn(async () => resolveResult());
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.upsert = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.then = (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
    Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    in: () => typeof builder;
    neq: () => typeof builder;
    order: () => typeof builder;
    limit: () => typeof builder;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
    insert: () => typeof builder;
    update: () => typeof builder;
    upsert: () => typeof builder;
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

function mockTeacherAccess() {
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
    let blueprintCall = 0;
    let topicCall = 0;

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

describe("blueprint workflow actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a draft and redirects", async () => {
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
      if (table === "blueprints") {
        return makeBuilder({
          data: { id: "bp-1", status: "draft" },
          error: null,
        });
      }
      if (table === "topics") {
        return makeBuilder({
          data: [{ id: "t1" }],
          error: null,
        });
      }
      if (table === "objectives") {
        return makeBuilder({ data: [], error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set(
      "draft",
      JSON.stringify({
        summary: "Summary",
        topics: [
          {
            id: "t1",
            clientId: "t1",
            title: "Limits",
            description: "Intro",
            section: "",
            sequence: 1,
            prerequisiteClientIds: [],
            objectives: [{ statement: "Define limits.", level: "Remember" }],
          },
        ],
      })
    );

    await expectRedirect(
      () => saveDraft("class-1", "bp-1", formData),
      "/classes/class-1/blueprint?saved=1"
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects duplicate topic sequences", async () => {
    mockTeacherAccess();
    const formData = new FormData();
    formData.set(
      "draft",
      JSON.stringify({
        summary: "Summary",
        topics: [
          {
            clientId: "t1",
            title: "Limits",
            description: "Intro",
            sequence: 1,
            prerequisiteClientIds: [],
            objectives: [{ statement: "Define limits." }],
          },
          {
            clientId: "t2",
            title: "Derivatives",
            description: "Rates",
            sequence: 1,
            prerequisiteClientIds: [],
            objectives: [{ statement: "Differentiate functions." }],
          },
        ],
      })
    );

    await expectRedirect(
      () => saveDraft("class-1", "bp-1", formData),
      "/classes/class-1/blueprint?error=Topic%202%20sequence%20must%20be%20unique."
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects out-of-range or non-integer sequences", async () => {
    mockTeacherAccess();
    const formData = new FormData();
    formData.set(
      "draft",
      JSON.stringify({
        summary: "Summary",
        topics: [
          {
            clientId: "t1",
            title: "Limits",
            description: "Intro",
            sequence: 0,
            prerequisiteClientIds: [],
            objectives: [{ statement: "Define limits." }],
          },
        ],
      })
    );

    await expectRedirect(
      () => saveDraft("class-1", "bp-1", formData),
      "/classes/class-1/blueprint?error=Topic%201%20sequence%20must%20be%20between%201%20and%201000."
    );

    mockTeacherAccess();
    const nonInteger = new FormData();
    nonInteger.set(
      "draft",
      JSON.stringify({
        summary: "Summary",
        topics: [
          {
            clientId: "t1",
            title: "Limits",
            description: "Intro",
            sequence: 1.5,
            prerequisiteClientIds: [],
            objectives: [{ statement: "Define limits." }],
          },
        ],
      })
    );

    await expectRedirect(
      () => saveDraft("class-1", "bp-1", nonInteger),
      "/classes/class-1/blueprint?error=Topic%201%20sequence%20must%20be%20an%20integer."
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects cyclic prerequisites", async () => {
    mockTeacherAccess();
    const formData = new FormData();
    formData.set(
      "draft",
      JSON.stringify({
        summary: "Summary",
        topics: [
          {
            clientId: "t1",
            title: "Limits",
            description: "Intro",
            sequence: 1,
            prerequisiteClientIds: ["t2"],
            objectives: [{ statement: "Define limits." }],
          },
          {
            clientId: "t2",
            title: "Derivatives",
            description: "Rates",
            sequence: 2,
            prerequisiteClientIds: ["t1"],
            objectives: [{ statement: "Differentiate functions." }],
          },
        ],
      })
    );

    await expectRedirect(
      () => saveDraft("class-1", "bp-1", formData),
      "/classes/class-1/blueprint?error=Prerequisite%20graph%20contains%20a%20cycle."
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects missing prerequisite references", async () => {
    mockTeacherAccess();
    const formData = new FormData();
    formData.set(
      "draft",
      JSON.stringify({
        summary: "Summary",
        topics: [
          {
            clientId: "t1",
            title: "Limits",
            description: "Intro",
            sequence: 1,
            prerequisiteClientIds: ["missing"],
            objectives: [{ statement: "Define limits." }],
          },
        ],
      })
    );

    await expectRedirect(
      () => saveDraft("class-1", "bp-1", formData),
      "/classes/class-1/blueprint?error=Prerequisite%20references%20a%20missing%20topic."
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects self-referencing prerequisites", async () => {
    mockTeacherAccess();
    const formData = new FormData();
    formData.set(
      "draft",
      JSON.stringify({
        summary: "Summary",
        topics: [
          {
            clientId: "t1",
            title: "Limits",
            description: "Intro",
            sequence: 1,
            prerequisiteClientIds: ["t1"],
            objectives: [{ statement: "Define limits." }],
          },
        ],
      })
    );

    await expectRedirect(
      () => saveDraft("class-1", "bp-1", formData),
      "/classes/class-1/blueprint?error=Prerequisite%20cannot%20reference%20itself."
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("creates a draft from a published blueprint", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    let blueprintsCall = 0;
    let topicsCall = 0;
    let objectivesCall = 0;

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
      if (table === "blueprints") {
        blueprintsCall += 1;
        if (blueprintsCall === 1) {
          return makeBuilder({ data: { id: "bp-pub", summary: "Summary" }, error: null });
        }
        if (blueprintsCall === 2) {
          return makeBuilder({ data: { version: 1 }, error: null });
        }
        if (blueprintsCall === 3) {
          return makeBuilder({ data: { id: "bp-new" }, error: null });
        }
        return makeBuilder({ error: null });
      }
      if (table === "topics") {
        topicsCall += 1;
        if (topicsCall === 1) {
          return makeBuilder({
            data: [
              {
                id: "t1",
                title: "Limits",
                description: null,
                section: null,
                sequence: 1,
                prerequisite_topic_ids: [],
              },
            ],
            error: null,
          });
        }
        if (topicsCall === 2) {
          return makeBuilder({ data: { id: "t1-new" }, error: null });
        }
        return makeBuilder({ error: null });
      }
      if (table === "objectives") {
        objectivesCall += 1;
        if (objectivesCall === 1) {
          return makeBuilder({
            data: [
              {
                id: "o1",
                topic_id: "t1",
                statement: "Define limits.",
                level: "Remember",
              },
            ],
            error: null,
          });
        }
        return makeBuilder({ error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => createDraftFromPublished("class-1"),
      "/classes/class-1/blueprint?draft=1"
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("redirects when no published blueprint exists", async () => {
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
      if (table === "blueprints") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => createDraftFromPublished("class-1"),
      "/classes/class-1/blueprint?error=No%20published%20blueprint%20found."
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("redirects when draft creation fails", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    let blueprintsCall = 0;
    let topicsCall = 0;

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
      if (table === "blueprints") {
        blueprintsCall += 1;
        if (blueprintsCall === 1) {
          return makeBuilder({ data: { id: "bp-pub", summary: "Summary" }, error: null });
        }
        if (blueprintsCall === 2) {
          return makeBuilder({ data: { version: 1 }, error: null });
        }
        if (blueprintsCall === 3) {
          return makeBuilder({ data: { id: "bp-new" }, error: null });
        }
        return makeBuilder({ error: null });
      }
      if (table === "topics") {
        topicsCall += 1;
        if (topicsCall === 1) {
          return makeBuilder({
            data: [
              {
                id: "t1",
                title: "Limits",
                description: null,
                section: null,
                sequence: 1,
                prerequisite_topic_ids: [],
              },
            ],
            error: null,
          });
        }
        if (topicsCall === 2) {
          return makeBuilder({ data: null, error: { message: "insert failed" } });
        }
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => createDraftFromPublished("class-1"),
      "/classes/class-1/blueprint?error=insert%20failed"
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects invalid topic ids in the payload", async () => {
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
      if (table === "blueprints") {
        return makeBuilder({
          data: { id: "bp-1", status: "draft" },
          error: null,
        });
      }
      if (table === "topics") {
        return makeBuilder({
          data: [{ id: "t1" }],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set(
      "draft",
      JSON.stringify({
        summary: "Summary",
        topics: [
          {
            id: "t2",
            clientId: "t2",
            title: "Limits",
            description: "Intro",
            sequence: 1,
            prerequisiteClientIds: [],
            objectives: [{ statement: "Define limits." }],
          },
        ],
      })
    );

    await expectRedirect(
      () => saveDraft("class-1", "bp-1", formData),
      "/classes/class-1/blueprint?error=Invalid%20topic%20reference."
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects invalid objective ids in the payload", async () => {
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
      if (table === "blueprints") {
        return makeBuilder({
          data: { id: "bp-1", status: "draft" },
          error: null,
        });
      }
      if (table === "topics") {
        return makeBuilder({
          data: [{ id: "t1" }],
          error: null,
        });
      }
      if (table === "objectives") {
        return makeBuilder({
          data: [{ id: "o-1", topic_id: "t1" }],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set(
      "draft",
      JSON.stringify({
        summary: "Summary",
        topics: [
          {
            id: "t1",
            clientId: "t1",
            title: "Limits",
            description: "Intro",
            sequence: 1,
            prerequisiteClientIds: [],
            objectives: [
              { id: "o-2", statement: "Define limits.", level: "Remember" },
            ],
          },
        ],
      })
    );

    await expectRedirect(
      () => saveDraft("class-1", "bp-1", formData),
      "/classes/class-1/blueprint?error=Invalid%20objective%20reference."
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("approves a draft and redirects to overview", async () => {
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
      if (table === "blueprints") {
        return makeBuilder({
          data: { id: "bp-1", status: "draft" },
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => approveBlueprint("class-1", "bp-1"),
      "/classes/class-1/blueprint/overview?approved=1"
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("publishes an approved blueprint", async () => {
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
      if (table === "blueprints") {
        return makeBuilder({
          data: { id: "bp-1", status: "approved" },
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => publishBlueprint("class-1", "bp-1"),
      "/classes/class-1/blueprint?published=1"
    );
    expect(redirect).toHaveBeenCalled();
  });
});
