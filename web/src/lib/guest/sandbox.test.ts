import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  discardGuestSandbox,
  provisionGuestSandbox,
  provisionGuestSandboxWithOptions,
  resetGuestSandbox,
  switchGuestRole,
  touchGuestSandbox,
} from "./sandbox";

function makeMutableBuilder(result: { data?: unknown; error?: { message: string } | null }) {
  const builder = {
    data: result.data ?? null,
    error: result.error ?? null,
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: result.data ?? null,
      error: result.error ?? null,
    }),
  };
  return Object.assign(builder, {
    then: (
      onFulfilled: (value: { data: unknown; error: { message: string } | null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
      }).then(onFulfilled, onRejected),
  });
}

function makeAdminRpcMock(
  responses: Partial<Record<string, { data?: unknown; error?: { message: string } | null }>> = {},
) {
  return vi.fn().mockImplementation((fn: string) =>
    Promise.resolve(
      responses[fn] ??
        (fn === "acquire_guest_session_service"
          ? {
              data: { ok: true },
              error: null,
            }
          : {
              data: null,
              error: null,
            }),
    ),
  );
}

function mockSupabase(overrides: Partial<Record<string, unknown>> = {}) {
  const guestSandboxBuilder = makeMutableBuilder({ data: null });
  const materialsBuilder = makeMutableBuilder({ data: [] });
  const classesBuilder = makeMutableBuilder({ data: null });
  const adminRpcMock =
    (overrides.adminRpc as ReturnType<typeof makeAdminRpcMock> | undefined) ?? makeAdminRpcMock();
  const adminBucket = {
    remove: vi.fn().mockResolvedValue({ error: null }),
  };
  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
      }),
      signInAnonymously: vi.fn().mockResolvedValue({
        data: {
          user: { id: "anon-1" },
          session: { access_token: "guest-token" },
        },
        error: null,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "guest_sandboxes") {
        return guestSandboxBuilder;
      }
      if (table === "materials") {
        return materialsBuilder;
      }
      if (table === "classes") {
        return classesBuilder;
      }
      return makeMutableBuilder({ data: null });
    }),
    rpc: vi.fn().mockResolvedValue({
      data: "class-1",
      error: null,
    }),
    ...overrides,
  };

  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
  vi.mocked(createAdminSupabaseClient).mockReturnValue({
    rpc: adminRpcMock,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "materials") {
        return materialsBuilder;
      }
      return makeMutableBuilder({ data: null });
    }),
    storage: {
      from: vi.fn(() => adminBucket),
    },
  } as never);
  return {
    supabase,
    guestSandboxBuilder,
    materialsBuilder,
    classesBuilder,
    adminBucket,
    adminRpcMock,
  };
}

describe("provisionGuestSandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an anonymous session and clones a guest sandbox", async () => {
    const { supabase } = mockSupabase();

    const result = await provisionGuestSandbox();

    expect(supabase.auth.signInAnonymously).toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      "clone_guest_sandbox",
      expect.objectContaining({
        p_sandbox_id: expect.any(String),
        p_guest_user_id: "anon-1",
      }),
    );
    expect(result).toEqual({
      ok: true,
      classId: "class-1",
      sandboxId: expect.any(String),
    });
  });

  it("reuses an existing active sandbox when one is already attached to the session", async () => {
    const { supabase, adminRpcMock } = mockSupabase({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "guest-token",
              user: { id: "anon-existing", is_anonymous: true },
            },
          },
        }),
        signInAnonymously: vi.fn(),
        signOut: vi.fn(),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "guest_sandboxes") {
          return makeMutableBuilder({
            data: {
              id: "sandbox-existing",
              class_id: "class-existing",
              status: "active",
              guest_role: "teacher",
              expires_at: "2099-12-31T23:59:59.000Z",
              last_seen_at: "2099-12-31T12:00:00.000Z",
            },
          });
        }
        return makeMutableBuilder({ data: null });
      }),
    });

    const result = await provisionGuestSandbox();

    expect(supabase.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      classId: "class-existing",
      sandboxId: "sandbox-existing",
    });
    expect(adminRpcMock).not.toHaveBeenCalledWith("acquire_guest_session_service", {});
  });

  it("reuses an existing anonymous session instead of replacing it", async () => {
    const { supabase } = mockSupabase({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "guest-token",
              user: { id: "anon-existing", is_anonymous: true },
            },
          },
        }),
        signInAnonymously: vi.fn(),
        signOut: vi.fn(),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "guest_sandboxes") {
          return makeMutableBuilder({ data: null });
        }
        return makeMutableBuilder({ data: null });
      }),
    });

    const result = await provisionGuestSandbox();

    expect(supabase.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      classId: "class-1",
      sandboxId: expect.any(String),
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "clone_guest_sandbox",
      expect.objectContaining({
        p_guest_user_id: "anon-existing",
      }),
    );
  });

  it("acquires a global session quota slot when provisioning a new sandbox", async () => {
    const { adminRpcMock } = mockSupabase();

    const result = await provisionGuestSandboxWithOptions();

    expect(result.ok).toBe(true);
    expect(adminRpcMock).toHaveBeenCalledWith("acquire_guest_session_service", {});
  });

  it("does not reuse an expired anonymous sandbox", async () => {
    const { supabase, adminRpcMock } = mockSupabase({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "guest-token",
              user: { id: "anon-existing", is_anonymous: true },
            },
          },
        }),
        signInAnonymously: vi.fn().mockResolvedValue({
          data: {
            user: { id: "anon-new" },
            session: { access_token: "guest-token-2" },
          },
          error: null,
        }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "guest_sandboxes") {
          return makeMutableBuilder({
            data: {
              id: "sandbox-expired",
              class_id: "class-existing",
              status: "active",
              guest_role: "teacher",
              expires_at: "2026-03-26T23:59:59.000Z",
              last_seen_at: "2026-03-27T00:00:00.000Z",
            },
          });
        }
        if (table === "materials") {
          return makeMutableBuilder({ data: [] });
        }
        return makeMutableBuilder({ data: null });
      }),
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T00:00:00.000Z"));

    const result = await provisionGuestSandbox();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(supabase.auth.signInAnonymously).toHaveBeenCalled();
    expect(adminRpcMock).toHaveBeenCalledWith("release_guest_session_slot_service", {});
    expect(adminRpcMock).toHaveBeenCalledWith("acquire_guest_session_service", {});
    expect(result).toEqual({
      ok: true,
      classId: "class-1",
      sandboxId: expect.any(String),
    });

    vi.useRealTimers();
  });

  it("rotates anonymous auth when the latest sandbox was already reconciled to expired", async () => {
    let guestSandboxLookupCount = 0;
    const { supabase } = mockSupabase({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "guest-token",
              user: { id: "anon-existing", is_anonymous: true },
            },
          },
        }),
        signInAnonymously: vi.fn().mockResolvedValue({
          data: {
            user: { id: "anon-new" },
            session: { access_token: "guest-token-2" },
          },
          error: null,
        }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "guest_sandboxes") {
          guestSandboxLookupCount += 1;
          if (guestSandboxLookupCount === 1) {
            return makeMutableBuilder({ data: null });
          }

          return makeMutableBuilder({
            data: {
              id: "sandbox-expired",
              class_id: "class-existing",
              status: "expired",
              guest_role: "teacher",
              expires_at: "2026-03-26T23:59:59.000Z",
              last_seen_at: "2026-03-27T00:00:00.000Z",
              created_at: "2026-03-26T23:00:00.000Z",
            },
          });
        }
        return makeMutableBuilder({ data: null });
      }),
    });

    const result = await provisionGuestSandbox();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(supabase.auth.signInAnonymously).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      classId: "class-1",
      sandboxId: expect.any(String),
    });
  });

  it("blocks guest provisioning when a real session already exists", async () => {
    const { supabase } = mockSupabase({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "real-token",
              user: {
                id: "teacher-1",
                is_anonymous: false,
                app_metadata: { provider: "email" },
              },
            },
          },
        }),
        signInAnonymously: vi.fn(),
        signOut: vi.fn(),
      },
    });

    const result = await provisionGuestSandbox();

    expect(supabase.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      code: "guest-session-conflict",
      error: "Please sign out before starting a guest session.",
      reason: "existing-authenticated-session",
    });
  });

  it("surfaces anonymous-auth failures", async () => {
    mockSupabase({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
        }),
        signInAnonymously: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "Anonymous auth disabled" },
        }),
        signOut: vi.fn(),
      },
    });

    const result = await provisionGuestSandbox();

    expect(result).toEqual({
      ok: false,
      code: "guest-auth-unavailable",
      error: "Anonymous auth disabled",
      reason: "anonymous-auth",
    });
  });

  it("fails closed when verifying an existing sandbox errors", async () => {
    mockSupabase({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "guest-token",
              user: { id: "anon-existing", is_anonymous: true },
            },
          },
        }),
        signInAnonymously: vi.fn(),
        signOut: vi.fn(),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "guest_sandboxes") {
          return {
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { code: "500", message: "db unavailable" },
            }),
          };
        }
        return makeMutableBuilder({ data: null });
      }),
    });

    const result = await provisionGuestSandbox();

    expect(result).toEqual({
      ok: false,
      code: "guest-session-check-failed",
      error: "We couldn't verify your current guest session. Please try again.",
      reason: "existing-session-check",
    });
  });

  it("returns guest unavailable when the session quota check errors", async () => {
    mockSupabase({
      adminRpc: makeAdminRpcMock({
        acquire_guest_session_service: {
          data: null,
          error: { message: "quota unavailable" },
        },
      }),
    });

    const result = await provisionGuestSandboxWithOptions();

    expect(result).toEqual({
      ok: false,
      code: "guest-unavailable",
      error: "guest-unavailable",
      reason: "session-quota-check",
    });
  });

  it("returns the new-session cap code when hourly creation quota is exhausted", async () => {
    mockSupabase({
      adminRpc: makeAdminRpcMock({
        acquire_guest_session_service: {
          data: { ok: false, reason: "cap_creation" },
          error: null,
        },
      }),
    });

    const result = await provisionGuestSandbox();

    expect(result).toEqual({
      ok: false,
      code: "too-many-new-sessions",
      error: "too-many-new-sessions",
      reason: "creation-rate-cap",
    });
  });

  it("returns the active-session cap code when the global slot limit is exhausted", async () => {
    mockSupabase({
      adminRpc: makeAdminRpcMock({
        acquire_guest_session_service: {
          data: { ok: false, reason: "cap_active" },
          error: null,
        },
      }),
    });

    const result = await provisionGuestSandbox();

    expect(result).toEqual({
      ok: false,
      code: "too-many-active-sessions",
      error: "too-many-active-sessions",
      reason: "active-session-cap",
    });
  });

  it("returns a typed sandbox provisioning failure when cloning fails", async () => {
    mockSupabase({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "clone failed" },
      }),
    });

    const result = await provisionGuestSandbox();

    expect(result).toEqual({
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: "clone failed",
      reason: "sandbox-clone",
    });
  });
});

describe("switchGuestRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the active guest role", async () => {
    const { guestSandboxBuilder } = mockSupabase();

    const result = await switchGuestRole("sandbox-1", "student");

    expect(guestSandboxBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        guest_role: "student",
      }),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("touchGuestSandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error when the guest heartbeat update fails", async () => {
    mockSupabase({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "guest_sandboxes") {
          return makeMutableBuilder({ data: null, error: { message: "write failed" } });
        }
        return makeMutableBuilder({ data: null });
      }),
    });

    const result = await touchGuestSandbox("sandbox-1");

    expect(result).toEqual({ ok: false, error: "write failed" });
  });
});

describe("resetGuestSandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("discards the old sandbox and provisions a fresh class", async () => {
    let callCount = 0;
    mockSupabase({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "guest_sandboxes") {
          callCount += 1;
          if (callCount === 1) {
            return makeMutableBuilder({ data: { id: "sandbox-old" } });
          }
          return makeMutableBuilder({ data: null });
        }
        if (table === "classes") {
          return makeMutableBuilder({ data: null });
        }
        return makeMutableBuilder({ data: null });
      }),
    });

    const result = await resetGuestSandbox("anon-1");

    expect(result).toEqual({
      ok: true,
      classId: "class-1",
      sandboxId: expect.any(String),
    });
  });

  it("fails closed when verifying the current sandbox errors", async () => {
    mockSupabase({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "guest_sandboxes") {
          return {
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { code: "500", message: "db unavailable" },
            }),
          };
        }
        return makeMutableBuilder({ data: null });
      }),
    });

    const result = await resetGuestSandbox("anon-1");

    expect(result).toEqual({
      ok: false,
      code: "guest-session-check-failed",
      error: "We couldn't verify your current guest session. Please try again.",
      reason: "existing-session-check",
    });
  });

  it("returns a typed provisioning failure when discarding the old sandbox fails", async () => {
    let callCount = 0;
    mockSupabase({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "guest_sandboxes") {
          callCount += 1;
          if (callCount === 1) {
            return makeMutableBuilder({ data: { id: "sandbox-old" } });
          }
          return makeMutableBuilder({ data: null });
        }
        if (table === "materials") {
          return makeMutableBuilder({
            data: [{ storage_path: "classes/class-1/sandboxes/sandbox-old/material-1/file.pdf" }],
          });
        }
        return makeMutableBuilder({ data: null });
      }),
    });

    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      rpc: makeAdminRpcMock(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "materials") {
          return makeMutableBuilder({
            data: [{ storage_path: "classes/class-1/sandboxes/sandbox-old/material-1/file.pdf" }],
          });
        }
        return makeMutableBuilder({ data: null });
      }),
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn().mockResolvedValue({
            error: { message: "cleanup failed" },
          }),
        })),
      },
    } as never);

    const result = await resetGuestSandbox("anon-1");

    expect(result).toEqual({
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: "cleanup failed",
      reason: "discard-existing-sandbox",
    });
  });
});

describe("discardGuestSandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the atomic discard rpc", async () => {
    const { supabase, adminBucket } = mockSupabase();
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "materials") {
          return makeMutableBuilder({
            data: [
              { storage_path: "classes/class-1/sandboxes/sandbox-1/material-1/file.pdf" },
              { storage_path: "guest-seed/demo.pdf" },
            ],
          });
        }
        return makeMutableBuilder({ data: null });
      }),
      storage: {
        from: vi.fn(() => adminBucket),
      },
    } as never);

    const result = await discardGuestSandbox("sandbox-1");

    expect(adminBucket.remove).toHaveBeenCalledWith([
      "classes/class-1/sandboxes/sandbox-1/material-1/file.pdf",
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith("discard_guest_sandbox", {
      p_sandbox_id: "sandbox-1",
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns an error when sandbox storage cleanup fails", async () => {
    const { supabase, adminBucket } = mockSupabase();
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "materials") {
          return makeMutableBuilder({
            data: [{ storage_path: "classes/class-1/sandboxes/sandbox-1/material-1/file.pdf" }],
          });
        }
        return makeMutableBuilder({ data: null });
      }),
      storage: {
        from: vi.fn(() => adminBucket),
      },
    } as never);
    adminBucket.remove.mockResolvedValueOnce({ error: { message: "storage remove failed" } });

    const result = await discardGuestSandbox("sandbox-1");

    expect(result).toEqual({ ok: false, error: "storage remove failed" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns an error when the atomic discard rpc fails", async () => {
    mockSupabase({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "discard failed" },
      }),
    });

    const result = await discardGuestSandbox("sandbox-1");

    expect(result).toEqual({ ok: false, error: "discard failed" });
  });
});
