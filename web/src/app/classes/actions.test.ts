import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClass, joinClass, uploadMaterial } from "@/app/classes/actions";
import { redirect } from "next/navigation";
import { generateJoinCode } from "@/lib/join-code";
import {
  detectMaterialKind,
  extractTextFromBuffer,
  sanitizeFilename,
} from "@/lib/materials/extract-text";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("@/lib/join-code", () => ({
  generateJoinCode: vi.fn(),
}));

vi.mock("@/lib/materials/extract-text", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/materials/extract-text")
  >("@/lib/materials/extract-text");
  return {
    ...actual,
    detectMaterialKind: vi.fn(),
    extractTextFromBuffer: vi.fn(),
    sanitizeFilename: vi.fn((name: string) => name),
  };
});

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
const adminStorageMock = {
  from: vi.fn(() => ({
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  })),
};

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: adminFromMock,
    storage: adminStorageMock,
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
  builder.upsert = vi.fn(async () => resolveResult());
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
    upsert: () => Promise<unknown>;
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) => Promise<unknown>;
  };
}

function makeInsertSequenceBuilder(results: unknown[]) {
  let callIndex = 0;
  const builder = makeBuilder(results[0]);
  const insert = vi.fn(() => {
    const result = results[Math.min(callIndex, results.length - 1)];
    callIndex += 1;
    return makeBuilder(result);
  });
  (builder as unknown as { insert: typeof insert }).insert = insert;
  return builder;
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

describe("class actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects when class title is missing", async () => {
    const formData = new FormData();
    formData.set("title", "");

    await expectRedirect(
      () => createClass(formData),
      "/classes/new?error=Class%20title%20is%20required"
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("redirects to login if user is not authenticated", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: null } });

    const formData = new FormData();
    formData.set("title", "Physics");

    await expectRedirect(() => createClass(formData), "/login");
    expect(redirect).toHaveBeenCalled();
  });

  it("creates a class and enrollment when valid", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    vi.mocked(generateJoinCode).mockReturnValue("JOIN01");

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeInsertSequenceBuilder([
          { data: { id: "class-1" }, error: null },
        ]);
      }
      if (table === "enrollments") {
        return makeBuilder({ error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("title", "Physics");

    await expectRedirect(() => createClass(formData), "/classes/class-1");
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects empty join codes", async () => {
    const formData = new FormData();
    formData.set("join_code", "");
    await expectRedirect(
      () => joinClass(formData),
      "/join?error=Join%20code%20is%20required"
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects invalid join codes", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    adminFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({ data: null, error: { message: "not found" } });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("join_code", "BAD123");

    await expectRedirect(
      () => joinClass(formData),
      "/join?error=Invalid%20join%20code"
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("joins a class and redirects on success", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    adminFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({ data: { id: "class-2" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("join_code", "AB12CD");

    await expectRedirect(() => joinClass(formData), "/classes/class-2");
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects upload when file is missing", async () => {
    const formData = new FormData();
    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      "/classes/class-1?error=Material%20file%20is%20required"
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects upload when file type is unsupported", async () => {
    const formData = new FormData();
    const file = new File([Buffer.from("x")], "notes.txt", {
      type: "text/plain",
    });
    formData.set("file", file);

    vi.mocked(detectMaterialKind).mockReturnValue(null);

    const message =
      "Unsupported file type. Allowed: .pdf, .docx, .pptx, .png, .jpg, .jpeg, .webp, .gif";
    const encodedMessage = encodeURIComponent(message);

    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      `/classes/class-1?error=${encodedMessage}`
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("uploads a material and redirects with success", async () => {
    const file = new File([Buffer.from("hello")], "lecture.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", "Lecture 1");

    vi.mocked(detectMaterialKind).mockReturnValue("pdf");
    vi.mocked(extractTextFromBuffer).mockResolvedValue({
      text: "hello",
      status: "ready",
      warnings: [],
    });
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");

    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", owner_id: "u1" },
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
        return makeBuilder({ error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      "/classes/class-1?uploaded=1"
    );
    expect(redirect).toHaveBeenCalled();
  });
});
