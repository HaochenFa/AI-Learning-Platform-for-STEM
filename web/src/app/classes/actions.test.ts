import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClass, joinClass, uploadMaterial } from "@/app/classes/actions";
import { redirect } from "next/navigation";
import { generateJoinCode } from "@/lib/join-code";
import {
  detectMaterialKind,
  sanitizeFilename,
} from "@/lib/materials/extract-text";
import { requireVerifiedUser } from "@/lib/auth/session";

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
  const actual = await vi.importActual<typeof import("@/lib/materials/extract-text")>(
    "@/lib/materials/extract-text",
  );
  return {
    ...actual,
    detectMaterialKind: vi.fn(),
    sanitizeFilename: vi.fn((name: string) => name),
  };
});

const supabaseFromMock = vi.fn();
const supabaseRpcMock = vi.fn();
const supabaseStorageMock = {
  from: vi.fn(() => ({
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  })),
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    from: supabaseFromMock,
    rpc: supabaseRpcMock,
    storage: supabaseStorageMock,
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  requireVerifiedUser: vi.fn(),
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
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
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

describe("class actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PYTHON_BACKEND_URL;
    delete process.env.PYTHON_BACKEND_API_KEY;
    vi.mocked(requireVerifiedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
        rpc: supabaseRpcMock,
        storage: supabaseStorageMock,
      },
      user: { id: "u1", email: "user@example.com" },
      profile: { id: "u1", account_type: "teacher" },
      accountType: "teacher",
      isEmailVerified: true,
      accessToken: "session-token",
    } as never);
  });

  it("redirects when class title is missing", async () => {
    const formData = new FormData();
    formData.set("title", "");

    await expectRedirect(
      () => createClass(formData),
      "/classes/new?error=Class%20title%20is%20required",
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("redirects to login if user is not authenticated", async () => {
    vi.mocked(requireVerifiedUser).mockImplementationOnce(async () => {
      redirect("/login");
      throw new Error("unreachable");
    });

    const formData = new FormData();
    formData.set("title", "Physics");

    await expectRedirect(() => createClass(formData), "/login");
    expect(redirect).toHaveBeenCalled();
  });

  it("creates a class via python backend when valid", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.mocked(generateJoinCode).mockReturnValue("JOIN01");

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: { class_id: "class-python-1" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const formData = new FormData();
    formData.set("title", "Physics");

    await expectRedirect(() => createClass(formData), "/classes/class-python-1");
    expect(redirect).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock).not.toHaveBeenCalledWith("create_class", expect.anything());
  });

  it("retries python class creation when join code collides", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.mocked(generateJoinCode).mockReturnValueOnce("JOIN01").mockReturnValueOnce("JOIN02");

    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: { message: "Join code already exists.", code: "join_code_conflict" },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: { class_id: "class-python-2" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const formData = new FormData();
    formData.set("title", "Chemistry");

    await expectRedirect(() => createClass(formData), "/classes/class-python-2");
    expect(generateJoinCode).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exhausts join code attempts after repeated python collisions", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.mocked(generateJoinCode).mockReturnValue("JOIN01");

    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          ok: false,
          error: { message: "Join code already exists.", code: "join_code_conflict" },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    });

    const formData = new FormData();
    formData.set("title", "Biology");

    await expectRedirect(
      () => createClass(formData),
      "/classes/new?error=Unable%20to%20generate%20a%20join%20code",
    );
    expect(redirect).toHaveBeenCalled();
    expect(generateJoinCode).toHaveBeenCalledTimes(5);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("rejects empty join codes", async () => {
    const formData = new FormData();
    formData.set("join_code", "");
    await expectRedirect(() => joinClass(formData), "/join?error=Join%20code%20is%20required");
    expect(redirect).toHaveBeenCalled();
  });

  it("rejects invalid join codes", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: { message: "Invalid join code.", code: "class_not_found" },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );

    const formData = new FormData();
    formData.set("join_code", "BAD123");

    await expectRedirect(() => joinClass(formData), "/join?error=Invalid%20join%20code");
    expect(redirect).toHaveBeenCalled();
  });

  it("joins a class and redirects on success", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: { class_id: "class-2" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const formData = new FormData();
    formData.set("join_code", "AB12CD");

    await expectRedirect(() => joinClass(formData), "/classes/class-2");
    expect(redirect).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("joins a class via python backend", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    process.env.PYTHON_BACKEND_API_KEY = "test-key";

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: { class_id: "class-python-join" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const formData = new FormData();
    formData.set("join_code", "AB12CD");

    await expectRedirect(() => joinClass(formData), "/classes/class-python-join");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock).not.toHaveBeenCalledWith("join_class_by_code", expect.anything());
  });

  it("keeps invalid join code UX when python backend returns class_not_found", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: { message: "Invalid join code.", code: "class_not_found" },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );

    const formData = new FormData();
    formData.set("join_code", "BAD123");

    await expectRedirect(() => joinClass(formData), "/join?error=Invalid%20join%20code");
  });

  it("rejects upload when file is missing", async () => {
    const formData = new FormData();
    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      "/classes/class-1?error=Material%20file%20is%20required",
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

    const message = "Unsupported file type. Allowed: .pdf, .docx, .pptx";
    const encodedMessage = encodeURIComponent(message);

    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      `/classes/class-1?error=${encodedMessage}`,
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("uploads a material and redirects with success", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    const file = new File([Buffer.from("hello")], "lecture.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", "Lecture 1");

    vi.mocked(detectMaterialKind).mockReturnValue("pdf");
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: { enqueued: true, triggered: true } }),
    } as Response);

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
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      "/classes/class-1?uploaded=processing",
    );
    expect(redirect).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [dispatchUrl, dispatchInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(dispatchUrl)).toContain("/v1/materials/dispatch");
    expect(dispatchInit).toEqual(
      expect.objectContaining({
        method: "POST",
      }),
    );
    const dispatchPayload = JSON.parse(String((dispatchInit as RequestInit)?.body ?? "{}")) as {
      class_id?: string;
      material_id?: string;
      trigger_worker?: boolean;
    };
    expect(dispatchPayload.class_id).toBe("class-1");
    expect(typeof dispatchPayload.material_id).toBe("string");
    expect(dispatchPayload.trigger_worker).toBe(true);
    expect(supabaseRpcMock).not.toHaveBeenCalledWith(
      "enqueue_material_job",
      expect.anything(),
    );
  });

  it("returns an upload error when python dispatch fails", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    const file = new File([Buffer.from("hello")], "lecture.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", "Lecture 1");

    vi.mocked(detectMaterialKind).mockReturnValue("pdf");
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, error: { message: "python down" } }),
    } as Response);
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
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      `/classes/class-1?error=${encodeURIComponent("Failed to queue material processing: python down")}`,
    );
    expect(supabaseRpcMock).not.toHaveBeenCalledWith("enqueue_material_job", expect.anything());
  });

  it("keeps uploaded material when python dispatch failure is ambiguous", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    const file = new File([Buffer.from("hello")], "lecture.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", "Lecture 1");

    vi.mocked(detectMaterialKind).mockReturnValue("pdf");
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, error: { message: "python down" } }),
    } as Response);

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
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      `/classes/class-1?error=${encodeURIComponent("Failed to queue material processing: python down")}`,
    );

    const materialsCalls = supabaseFromMock.mock.calls.filter((call) => call[0] === "materials");
    expect(materialsCalls).toHaveLength(1);
    expect(supabaseStorageMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseRpcMock).not.toHaveBeenCalledWith(
      "enqueue_material_job",
      expect.anything(),
    );
  });

  it("rolls back uploaded material when python dispatch fails before enqueue", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    const file = new File([Buffer.from("hello")], "lecture.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", "Lecture 1");

    vi.mocked(detectMaterialKind).mockReturnValue("pdf");
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        data: { enqueued: false },
        error: { message: "invalid request" },
      }),
    } as Response);

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
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      `/classes/class-1?error=${encodeURIComponent(
        "Failed to queue material processing: invalid request",
      )}`,
    );

    const materialsCalls = supabaseFromMock.mock.calls.filter((call) => call[0] === "materials");
    expect(materialsCalls).toHaveLength(2);
    expect(supabaseStorageMock.from).toHaveBeenCalledTimes(2);
  });

  it("rolls back uploaded material when python dispatch fails with deterministic transport error", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";

    const file = new File([Buffer.from("hello")], "lecture.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", "Lecture 1");

    vi.mocked(detectMaterialKind).mockReturnValue("pdf");
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    const transportError = new TypeError("fetch failed") as TypeError & {
      cause?: { code?: string };
    };
    transportError.cause = { code: "ENOTFOUND" };
    vi.spyOn(global, "fetch").mockRejectedValueOnce(transportError);

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
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () => uploadMaterial("class-1", formData),
      `/classes/class-1?error=${encodeURIComponent("Failed to queue material processing: fetch failed")}`,
    );

    const materialsCalls = supabaseFromMock.mock.calls.filter((call) => call[0] === "materials");
    expect(materialsCalls).toHaveLength(2);
    expect(supabaseStorageMock.from).toHaveBeenCalledTimes(2);
  });

  it("blocks class creation for student accounts", async () => {
    vi.mocked(requireVerifiedUser).mockImplementationOnce(async () => {
      redirect(
        "/student/dashboard?error=This%20action%20requires%20a%20teacher%20account.",
      );
      throw new Error("unreachable");
    });

    const formData = new FormData();
    formData.set("title", "Physics");

    await expectRedirect(
      () => createClass(formData),
      "/student/dashboard?error=This%20action%20requires%20a%20teacher%20account.",
    );
  });

  it("blocks class join for teacher accounts", async () => {
    vi.mocked(requireVerifiedUser).mockImplementationOnce(async () => {
      redirect(
        "/teacher/dashboard?error=This%20action%20requires%20a%20student%20account.",
      );
      throw new Error("unreachable");
    });

    const formData = new FormData();
    formData.set("join_code", "AB12CD");

    await expectRedirect(
      () => joinClass(formData),
      "/teacher/dashboard?error=This%20action%20requires%20a%20student%20account.",
    );
  });
});
