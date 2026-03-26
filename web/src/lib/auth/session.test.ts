import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "./session";

function makeBuilder<T>(data: T | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data,
      error: data ? null : { code: "PGRST116" },
    }),
  };
}

function mockSupabase(overrides: {
  sessionUser?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  sandbox?: Record<string, unknown> | null;
}) {
  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: overrides.sessionUser
            ? {
                access_token: "test-token",
                user: overrides.sessionUser,
              }
            : null,
        },
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "profiles") {
        return makeBuilder(overrides.profile ?? null);
      }
      if (table === "guest_sandboxes") {
        return makeBuilder(overrides.sandbox ?? null);
      }
      return makeBuilder(null);
    }),
  };

  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
  return supabase;
}

describe("getAuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns anonymous-free context when there is no session", async () => {
    mockSupabase({ sessionUser: null });

    const context = await getAuthContext();

    expect(context.user).toBeNull();
    expect(context.isGuest).toBe(false);
    expect(context.guestSessionError).toBeNull();
    expect(context.sandboxId).toBeNull();
  });

  it("returns real user profile data for verified accounts", async () => {
    mockSupabase({
      sessionUser: {
        id: "user-1",
        email: "teacher@example.com",
        email_confirmed_at: "2026-03-20T00:00:00.000Z",
        app_metadata: { provider: "email" },
      },
      profile: {
        id: "user-1",
        account_type: "teacher",
        display_name: "Teacher Example",
      },
    });

    const context = await getAuthContext();

    expect(context.user?.id).toBe("user-1");
    expect(context.isGuest).toBe(false);
    expect(context.guestSessionError).toBeNull();
    expect(context.profile?.account_type).toBe("teacher");
    expect(context.profile?.display_name).toBe("Teacher Example");
    expect(context.isEmailVerified).toBe(true);
  });

  it("returns guest sandbox data for anonymous users with an active sandbox", async () => {
    mockSupabase({
      sessionUser: {
        id: "anon-1",
        email: null,
        email_confirmed_at: null,
        is_anonymous: true,
        app_metadata: { provider: "anonymous" },
      },
      sandbox: {
        id: "sandbox-1",
        class_id: "class-1",
        guest_role: "teacher",
        status: "active",
      },
    });

    const context = await getAuthContext();

    expect(context.user?.id).toBe("anon-1");
    expect(context.isGuest).toBe(true);
    expect(context.guestSessionError).toBeNull();
    expect(context.sandboxId).toBe("sandbox-1");
    expect(context.guestRole).toBe("teacher");
    expect(context.guestClassId).toBe("class-1");
    expect(context.profile).toBeNull();
  });

  it("keeps anonymous users without an active sandbox out of guest mode", async () => {
    mockSupabase({
      sessionUser: {
        id: "anon-2",
        email: null,
        email_confirmed_at: null,
        app_metadata: { provider: "anonymous" },
      },
      sandbox: null,
    });

    const context = await getAuthContext();

    expect(context.user?.id).toBe("anon-2");
    expect(context.isGuest).toBe(false);
    expect(context.guestSessionError).toBeNull();
    expect(context.sandboxId).toBeNull();
    expect(context.guestRole).toBeNull();
  });

  it("surfaces sandbox lookup failures for anonymous users", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "guest-token",
              user: {
                id: "anon-3",
                email: null,
                email_confirmed_at: null,
                is_anonymous: true,
                app_metadata: { provider: "anonymous" },
              },
            },
          },
        }),
      },
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "500", message: "db unavailable" },
        }),
      })),
    };

    vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);

    const context = await getAuthContext();

    expect(context.isGuest).toBe(false);
    expect(context.guestSessionError).toBe(
      "We couldn't verify your guest session right now. Please try again.",
    );
    expect(context.sandboxId).toBeNull();
  });
});
