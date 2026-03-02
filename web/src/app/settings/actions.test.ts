import { beforeEach, describe, expect, it, vi } from "vitest";
import { changePassword } from "@/app/settings/actions";
import { PASSWORD_POLICY_ERROR_MESSAGE } from "@/lib/auth/password-policy";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

const supabaseAuth = {
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: supabaseAuth,
  }),
}));

function settingsPath(status: "success" | "error", message?: string) {
  const search = new URLSearchParams({ section: "password", status });
  if (message) {
    search.set("message", message);
  }
  return `/settings?${search.toString()}`;
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

describe("settings password actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects weak new password using shared policy", async () => {
    const formData = new FormData();
    formData.set("current_password", "Oldpass1");
    formData.set("new_password", "short1");
    formData.set("confirm_password", "short1");

    await expectRedirect(
      () => changePassword(formData),
      settingsPath("error", PASSWORD_POLICY_ERROR_MESSAGE),
    );
    expect(supabaseAuth.getUser).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation", async () => {
    const formData = new FormData();
    formData.set("current_password", "Oldpass1");
    formData.set("new_password", "Newpass1");
    formData.set("confirm_password", "Mismatch1");

    await expectRedirect(
      () => changePassword(formData),
      settingsPath("error", "New password confirmation does not match."),
    );
    expect(supabaseAuth.getUser).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password", async () => {
    const formData = new FormData();
    formData.set("current_password", "Samepass1");
    formData.set("new_password", "Samepass1");
    formData.set("confirm_password", "Samepass1");

    await expectRedirect(
      () => changePassword(formData),
      settingsPath("error", "New password must be different from current password."),
    );
    expect(supabaseAuth.getUser).not.toHaveBeenCalled();
  });

  it("updates password when validation and verification succeed", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({
      data: { user: { email: "teacher@example.com" } },
    });
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({ error: null });
    supabaseAuth.updateUser.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    formData.set("current_password", "Oldpass1");
    formData.set("new_password", "Newpass1");
    formData.set("confirm_password", "Newpass1");

    await expectRedirect(
      () => changePassword(formData),
      settingsPath("success", "Password changed successfully."),
    );
    expect(supabaseAuth.signInWithPassword).toHaveBeenCalledWith({
      email: "teacher@example.com",
      password: "Oldpass1",
    });
    expect(supabaseAuth.updateUser).toHaveBeenCalledWith({ password: "Newpass1" });
    expect(redirect).toHaveBeenCalled();
  });
});
