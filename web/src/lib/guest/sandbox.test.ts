import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { provisionGuestSandbox, resetGuestSandbox, switchGuestRole } from "./sandbox";

function makeMutableBuilder(result: { data?: unknown; error?: { message: string } | null }) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: result.data ?? null,
      error: result.error ?? null,
    }),
  };
}

function mockSupabase(overrides: Partial<Record<string, unknown>> = {}) {
  const guestSandboxBuilder = makeMutableBuilder({ data: null });
  const classesBuilder = makeMutableBuilder({ data: null });
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
  return { supabase, guestSandboxBuilder, classesBuilder };
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
    const { supabase } = mockSupabase({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "guest-token",
              user: { id: "anon-existing" },
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
      error: "Anonymous auth disabled",
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
});
