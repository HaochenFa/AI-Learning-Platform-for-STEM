import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAuthenticatedUser } from "@/lib/activities/access";
import { getAuthContext } from "@/lib/auth/session";

vi.mock("@/lib/auth/session", () => ({
  getAuthContext: vi.fn(),
}));

describe("requireAuthenticatedUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns auth error when user is missing", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      supabase: {},
      user: null,
      profile: null,
      isEmailVerified: false,
      isGuest: false,
      sandboxId: null,
      guestRole: null,
      guestClassId: null,
    } as never);

    const result = await requireAuthenticatedUser();
    expect(result.authError).toBe("Please sign in.");
  });

  it("returns auth error when email is not verified", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      supabase: {},
      user: { id: "u1", email: "x@example.com" },
      profile: { id: "u1", account_type: "teacher" },
      isEmailVerified: false,
      isGuest: false,
      sandboxId: null,
      guestRole: null,
      guestClassId: null,
    } as never);

    const result = await requireAuthenticatedUser();
    expect(result.authError).toBe("Please verify your email before continuing.");
  });

  it("returns auth error when account type does not match", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      supabase: {},
      user: { id: "u1", email: "x@example.com" },
      profile: { id: "u1", account_type: "student" },
      isEmailVerified: true,
      isGuest: false,
      sandboxId: null,
      guestRole: null,
      guestClassId: null,
    } as never);

    const result = await requireAuthenticatedUser({ accountType: "teacher" });
    expect(result.authError).toBe("This action requires a teacher account.");
  });

  it("returns setup error when profile is missing account type", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      supabase: {},
      user: { id: "u1", email: "x@example.com" },
      profile: null,
      isEmailVerified: true,
      isGuest: false,
      sandboxId: null,
      guestRole: null,
      guestClassId: null,
    } as never);

    const result = await requireAuthenticatedUser({ accountType: "teacher" });
    expect(result.authError).toBe("Account setup is incomplete. Please sign in again.");
  });

  it("accepts guest actors when the requested role matches the guest view", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      supabase: {},
      user: { id: "guest-1", email: null },
      accessToken: "guest-token",
      profile: null,
      isEmailVerified: false,
      isGuest: true,
      sandboxId: "sandbox-1",
      guestRole: "teacher",
      guestClassId: "class-1",
    } as never);

    const result = await requireAuthenticatedUser({ accountType: "teacher" });
    expect(result.authError).toBeNull();
    expect(result.isGuest).toBe(true);
    expect(result.accountType).toBe("teacher");
  });
});
