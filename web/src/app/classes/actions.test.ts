import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClass,
  joinClass,
  prepareMaterialUpload,
  finalizeMaterialUpload,
  triggerMaterialProcessing,
  getMaterialSignedUrl,
  deleteMaterial,
} from "@/app/classes/actions";
import { redirect } from "next/navigation";
import { generateJoinCode } from "@/lib/join-code";
import { sanitizeFilename } from "@/lib/materials/extract-text";
import { requireGuestOrVerifiedUser, requireVerifiedUser } from "@/lib/auth/session";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
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
    sanitizeFilename: vi.fn((name: string) => name),
  };
});

const supabaseFromMock = vi.fn();
const supabaseRpcMock = vi.fn();
const supabaseStorageMock = {
  from: vi.fn(),
};

const adminBucketMock = {
  upload: vi.fn().mockResolvedValue({ error: null }),
  remove: vi.fn().mockResolvedValue({ error: null }),
  createSignedUploadUrl: vi.fn().mockResolvedValue({
    data: {
      signedUrl: "https://test.supabase.co/storage/v1/upload/sign/file.pdf?token=test-token",
      token: "test-token",
    },
    error: null,
  }),
  createSignedUrl: vi.fn().mockResolvedValue({
    data: { signedUrl: "https://test.supabase.co/storage/v1/sign/file.pdf" },
    error: null,
  }),
  info: vi.fn().mockResolvedValue({
    data: {
      id: "obj-1",
      name: "file.pdf",
      bucketId: "materials",
      size: 1024,
      contentType: "application/pdf",
    },
    error: null,
  }),
};

const adminStorageMock = {
  from: vi.fn(() => adminBucketMock),
};

const bucketMock = {
  upload: vi.fn().mockResolvedValue({ error: null }),
  remove: vi.fn().mockResolvedValue({ error: null }),
  createSignedUploadUrl: vi.fn().mockResolvedValue({
    data: {
      signedUrl: "https://test.supabase.co/storage/v1/upload/sign/file.pdf?token=test-token",
      token: "test-token",
    },
    error: null,
  }),
  createSignedUrl: vi.fn().mockResolvedValue({
    data: { signedUrl: "https://test.supabase.co/storage/v1/sign/file.pdf" },
    error: null,
  }),
  info: vi.fn().mockResolvedValue({
    data: {
      id: "obj-1",
      name: "file.pdf",
      bucketId: "materials",
      size: 1024,
      contentType: "application/pdf",
    },
    error: null,
  }),
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
  requireGuestOrVerifiedUser: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    storage: adminStorageMock,
    from: vi.fn(),
    rpc: vi.fn(),
  })),
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
    supabaseStorageMock.from.mockReturnValue(bucketMock);
    adminStorageMock.from.mockReturnValue(adminBucketMock);
    bucketMock.upload.mockResolvedValue({ error: null });
    bucketMock.remove.mockResolvedValue({ error: null });
    bucketMock.createSignedUploadUrl.mockResolvedValue({
      data: {
        signedUrl: "https://test.supabase.co/storage/v1/upload/sign/file.pdf?token=test-token",
        token: "test-token",
      },
      error: null,
    });
    bucketMock.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://test.supabase.co/storage/v1/sign/file.pdf" },
      error: null,
    });
    bucketMock.info.mockResolvedValue({
      data: {
        id: "obj-1",
        name: "file.pdf",
        bucketId: "materials",
        size: 1024,
        contentType: "application/pdf",
      },
      error: null,
    });
    adminBucketMock.upload.mockResolvedValue({ error: null });
    adminBucketMock.remove.mockResolvedValue({ error: null });
    adminBucketMock.createSignedUploadUrl.mockResolvedValue({
      data: {
        signedUrl: "https://test.supabase.co/storage/v1/upload/sign/file.pdf?token=test-token",
        token: "test-token",
      },
      error: null,
    });
    adminBucketMock.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://test.supabase.co/storage/v1/sign/file.pdf" },
      error: null,
    });
    adminBucketMock.info.mockResolvedValue({
      data: {
        id: "obj-1",
        name: "file.pdf",
        bucketId: "materials",
        size: 1024,
        contentType: "application/pdf",
      },
      error: null,
    });
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
    vi.mocked(requireGuestOrVerifiedUser).mockResolvedValue({
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
      isGuest: false,
      sandboxId: null,
      guestRole: null,
      guestClassId: null,
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

  it("rejects prepareMaterialUpload when the file metadata is invalid", async () => {
    const result = await prepareMaterialUpload("class-1", {
      filename: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 1024,
    });

    expect(result).toEqual({
      ok: false,
      error: "Unsupported file type. Allowed: .pdf, .docx, .pptx",
    });
  });

  it("returns a signed upload URL for a valid file", async () => {
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
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

    const result = await prepareMaterialUpload("class-1", {
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.storagePath).toBe(`classes/class-1/${result.materialId}/lecture.pdf`);
      expect(result.uploadToken).toBe("test-token");
    }
    expect(supabaseFromMock).not.toHaveBeenCalledWith("materials");
    expect(bucketMock.createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("uses the admin storage client for guest prepareMaterialUpload calls", async () => {
    vi.mocked(requireGuestOrVerifiedUser).mockResolvedValueOnce({
      supabase: {
        from: supabaseFromMock,
        rpc: supabaseRpcMock,
        storage: supabaseStorageMock,
      },
      user: { id: "guest-1", email: null },
      profile: { id: "guest-1", account_type: "teacher" },
      accountType: "teacher",
      isEmailVerified: true,
      accessToken: "guest-token",
      isGuest: true,
      sandboxId: "sandbox-1",
      guestRole: "teacher",
      guestClassId: "class-1",
    } as never);
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", owner_id: "guest-1" },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const result = await prepareMaterialUpload("class-1", {
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(result.ok).toBe(true);
    expect(supabaseFromMock).not.toHaveBeenCalledWith("materials");
    expect(adminStorageMock.from).toHaveBeenCalledWith("materials");
    expect(adminBucketMock.createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("finalizes a direct upload and enqueues processing without waking the worker", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: { enqueued: true, triggered: false } }),
    } as Response);

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({ data: { id: "class-1", owner_id: "u1" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const result = await finalizeMaterialUpload("class-1", {
      materialId: "mat-1",
      storagePath: "classes/class-1/mat-1/lecture.pdf",
      title: "Lecture 1",
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      triggerWorker: false,
    });

    expect(result).toEqual({
      ok: true,
      materialId: "m1",
      uploadNotice: "processing",
    });

    const fetchMock = vi.mocked(global.fetch);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init as RequestInit)?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer session-token",
      }),
    );
    const dispatchPayload = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as {
      trigger_worker?: boolean;
    };
    expect(dispatchPayload.trigger_worker).toBe(false);
    expect(bucketMock.info).toHaveBeenCalledWith("classes/class-1/mat-1/lecture.pdf");
  });

  it("rejects finalizeMaterialUpload when the storage object is missing", async () => {
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({ data: { id: "class-1", owner_id: "u1" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });
    bucketMock.info.mockResolvedValueOnce({ data: null, error: { message: "not found" } });

    const result = await finalizeMaterialUpload("class-1", {
      materialId: "mat-1",
      storagePath: "classes/class-1/mat-1/lecture.pdf",
      title: "Lecture 1",
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      triggerWorker: false,
    });

    expect(result).toEqual({
      ok: false,
      error: "Uploaded file was not found in storage. Please upload it again.",
    });
  });

  it("marks the material as failed when dispatch returns an ambiguous 5xx", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, error: { message: "python down" } }),
    } as Response);

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({ data: { id: "class-1", owner_id: "u1" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const result = await finalizeMaterialUpload("class-1", {
      materialId: "mat-1",
      storagePath: "classes/class-1/mat-1/lecture.pdf",
      title: "Lecture 1",
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      triggerWorker: false,
    });

    expect(result).toEqual({
      ok: false,
      error: "Processing could not be started. Please delete this file and upload it again.",
    });

    const materialsCalls = supabaseFromMock.mock.calls.filter((call) => call[0] === "materials");
    expect(materialsCalls).toHaveLength(2);
    expect(bucketMock.remove).not.toHaveBeenCalled();
  });

  it("rolls back the material when the upload context has no session token", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    vi.mocked(requireGuestOrVerifiedUser).mockResolvedValueOnce({
      supabase: {
        from: supabaseFromMock,
        rpc: supabaseRpcMock,
        storage: supabaseStorageMock,
      },
      user: { id: "u1", email: "user@example.com" },
      profile: { id: "u1", account_type: "teacher" },
      accountType: "teacher",
      isEmailVerified: true,
      accessToken: null,
      isGuest: false,
      sandboxId: null,
      guestRole: null,
      guestClassId: null,
    } as never);

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({ data: { id: "class-1", owner_id: "u1" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const result = await finalizeMaterialUpload("class-1", {
      materialId: "mat-1",
      storagePath: "classes/class-1/mat-1/lecture.pdf",
      title: "Lecture 1",
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      triggerWorker: false,
    });

    expect(result).toEqual({
      ok: false,
      error: "Failed to queue material processing: Session token is missing. Please sign in again.",
    });
    expect(bucketMock.remove).toHaveBeenCalledWith(["classes/class-1/mat-1/lecture.pdf"]);
  });

  it("rolls back finalized uploads when dispatch fails deterministically", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
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
        return makeBuilder({ data: { id: "class-1", owner_id: "u1" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const result = await finalizeMaterialUpload("class-1", {
      materialId: "mat-1",
      storagePath: "classes/class-1/mat-1/lecture.pdf",
      title: "Lecture 1",
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      triggerWorker: false,
    });

    expect(result).toEqual({
      ok: false,
      error: "Failed to queue material processing: invalid request",
    });
    expect(bucketMock.remove).toHaveBeenCalledWith(["classes/class-1/mat-1/lecture.pdf"]);
  });

  it("triggers the worker once per batch via the process endpoint", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: { triggered: true } }),
    } as Response);
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({ data: { id: "class-1", owner_id: "u1" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const result = await triggerMaterialProcessing("class-1", 4);

    expect(result).toEqual({ ok: true });
    const fetchMock = vi.mocked(global.fetch);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/materials/process");
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

describe("getMaterialSignedUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireGuestOrVerifiedUser).mockResolvedValue({
      supabase: { from: supabaseFromMock, storage: supabaseStorageMock } as never,
      user: { id: "user-1" } as never,
      accessToken: "tok",
      isGuest: false,
      sandboxId: null,
    } as never);
    supabaseStorageMock.from.mockReturnValue(bucketMock);
  });

  it("returns error when teacher access is denied", async () => {
    supabaseFromMock.mockReturnValueOnce(
      makeBuilder({ data: null, error: { message: "Access denied" } })
    );
    const result = await getMaterialSignedUrl("class-1", "mat-1");
    expect(result.ok).toBe(false);
  });

  it("returns error when material not found", async () => {
    // First call: requireTeacherAccess (classes lookup) → success
    supabaseFromMock.mockReturnValueOnce(
      makeBuilder({ data: { id: "class-1", owner_id: "user-1" }, error: null })
    );
    // Second call: materials lookup → not found
    supabaseFromMock.mockReturnValueOnce(
      makeBuilder({ data: null, error: { message: "Row not found" } })
    );
    const result = await getMaterialSignedUrl("class-1", "mat-1");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: "Material not found." });
  });

  it("returns error when createSignedUrl fails", async () => {
    supabaseFromMock
      .mockReturnValueOnce(makeBuilder({ data: { id: "class-1", owner_id: "user-1" }, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: { id: "mat-1", storage_path: "classes/c1/m1/file.pdf" }, error: null }));
    bucketMock.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: "storage error" } });
    const result = await getMaterialSignedUrl("class-1", "mat-1");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: "storage error" });
  });

  it("returns signed URL on success", async () => {
    supabaseFromMock
      .mockReturnValueOnce(makeBuilder({ data: { id: "class-1", owner_id: "user-1" }, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: { id: "mat-1", storage_path: "classes/c1/m1/file.pdf" }, error: null }));
    const result = await getMaterialSignedUrl("class-1", "mat-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toContain("https://");
  });
});

describe("deleteMaterial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireGuestOrVerifiedUser).mockResolvedValue({
      supabase: { from: supabaseFromMock, storage: supabaseStorageMock } as never,
      user: { id: "user-1" } as never,
      accessToken: "tok",
      isGuest: false,
      sandboxId: null,
    } as never);
    supabaseStorageMock.from.mockReturnValue(bucketMock);
    bucketMock.remove.mockResolvedValue({ error: null });
  });

  it("returns error when teacher access is denied", async () => {
    supabaseFromMock.mockReturnValueOnce(
      makeBuilder({ data: null, error: { message: "Access denied" } })
    );
    const result = await deleteMaterial("class-1", "mat-1");
    expect(result.ok).toBe(false);
  });

  it("returns error when material not found", async () => {
    supabaseFromMock
      .mockReturnValueOnce(makeBuilder({ data: { id: "class-1", owner_id: "user-1" }, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: null, error: { message: "Not found" } }));
    const result = await deleteMaterial("class-1", "mat-1");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: "Material not found." });
  });

  it("returns error when material status is 'processing'", async () => {
    supabaseFromMock
      .mockReturnValueOnce(makeBuilder({ data: { id: "class-1", owner_id: "user-1" }, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: { id: "mat-1", storage_path: "classes/c1/m1/file.pdf", status: "processing" }, error: null }));
    const result = await deleteMaterial("class-1", "mat-1");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: "Cannot delete a material while it is processing." });
  });

  it("returns error when storage delete fails", async () => {
    supabaseFromMock
      .mockReturnValueOnce(makeBuilder({ data: { id: "class-1", owner_id: "user-1" }, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: { id: "mat-1", storage_path: "classes/c1/m1/file.pdf", status: "ready" }, error: null }));
    bucketMock.remove.mockResolvedValueOnce({ error: { message: "storage error" } });
    const result = await deleteMaterial("class-1", "mat-1");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: "storage error" });
  });

  it("deletes storage and DB row on success, returns ok:true", async () => {
    const deleteBuilder = makeBuilder({ error: null });
    supabaseFromMock
      .mockReturnValueOnce(makeBuilder({ data: { id: "class-1", owner_id: "user-1" }, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: { id: "mat-1", storage_path: "classes/c1/m1/file.pdf", status: "ready" }, error: null }))
      .mockReturnValueOnce(deleteBuilder);
    const result = await deleteMaterial("class-1", "mat-1");
    expect(result.ok).toBe(true);
    expect(bucketMock.remove).toHaveBeenCalledWith(["classes/c1/m1/file.pdf"]);
    expect(deleteBuilder.delete).toHaveBeenCalled();
  });

  it("returns error when DB delete fails", async () => {
    supabaseFromMock
      .mockReturnValueOnce(makeBuilder({ data: { id: "class-1", owner_id: "user-1" }, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: { id: "mat-1", storage_path: "classes/c1/m1/file.pdf", status: "ready" }, error: null }))
      .mockReturnValueOnce(makeBuilder({ error: { message: "db error" } }));
    const result = await deleteMaterial("class-1", "mat-1");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: "db error" });
  });
});
