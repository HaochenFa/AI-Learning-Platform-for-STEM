import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resendConfirmationEmail,
  resendPasswordReset,
  signIn,
  signOut,
  signUp,
} from "@/app/actions";
import { PASSWORD_POLICY_ERROR_MESSAGE } from "@/lib/auth/password-policy";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

const {
  supabaseAuth,
  getAuthContextMock,
  discardGuestSandboxMock,
} = vi.hoisted(() => ({
  supabaseAuth: {
    getSession: vi.fn(),
    getUser: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    resend: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
    updateUser: vi.fn(),
  },
  getAuthContextMock: vi.fn(),
  discardGuestSandboxMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: supabaseAuth,
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthContext: getAuthContextMock,
}));

vi.mock("@/lib/guest/sandbox", async () => {
  const actual = await vi.importActual<typeof import("@/lib/guest/sandbox")>("@/lib/guest/sandbox");
  return {
    ...actual,
    discardGuestSandbox: discardGuestSandboxMock,
  };
});

async function expectRedirect(action: () => Promise<void> | void, path: string | RegExp) {
  try {
    await Promise.resolve().then(action);
    throw new Error("Expected redirect");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) {
      const digest = String((error as { digest?: string }).digest);
      if (typeof path === "string") {
        expect(digest).toContain(`;${path};`);
      } else {
        expect(digest).toMatch(path);
      }
      return;
    }
    throw error;
  }
}

describe("auth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_VERCEL_URL;
    delete process.env.VERCEL_URL;
    supabaseAuth.getSession.mockResolvedValue({ data: { session: null } });
    getAuthContextMock.mockResolvedValue({
      isGuest: false,
      sandboxId: null,
      supabase: { auth: supabaseAuth },
    });
    discardGuestSandboxMock.mockResolvedValue({ ok: true });
    supabaseAuth.signOut.mockResolvedValue({ error: null });
  });

  it("redirects to login with error on failed sign in", async () => {
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login" },
    });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "bad");

    await expectRedirect(() => signIn(formData), "/login?error=Invalid%20login");
    expect(redirect).toHaveBeenCalled();
  });

  it("returns sign-in errors back to the home auth modal when requested", async () => {
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login" },
    });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "bad");
    formData.set("auth_return_to", "/?auth=sign-in");

    await expectRedirect(() => signIn(formData), "/?auth=sign-in&error=Invalid%20login");
  });

  it("redirects to dashboard on successful sign in", async () => {
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass");

    await expectRedirect(() => signIn(formData), "/dashboard");
    expect(redirect).toHaveBeenCalled();
  });

  it("falls back to the raw sign up error for non-duplicate failures", async () => {
    supabaseAuth.signUp.mockResolvedValueOnce({
      error: { message: "Unexpected auth failure" },
    });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass1");
    formData.set("account_type", "teacher");

    await expectRedirect(
      () => signUp(formData),
      "/register?error=Unexpected%20auth%20failure",
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("maps stable duplicate error code from sign up to a generic recovery hint", async () => {
    supabaseAuth.signUp.mockResolvedValueOnce({
      error: {
        message: "Database conflict",
        code: "23505",
      },
    });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass1");
    formData.set("account_type", "teacher");

    await expectRedirect(
      () => signUp(formData),
      "/register?error=We%20couldn't%20create%20an%20account%20with%20that%20email.%20Try%20signing%20in%20or%20resetting%20your%20password.",
    );
  });

  it("discards the guest sandbox and redirects back to register before creating a real account", async () => {
    getAuthContextMock.mockResolvedValue({
      isGuest: true,
      sandboxId: "sandbox-1",
      supabase: { auth: supabaseAuth },
    });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass1");
    formData.set("account_type", "teacher");

    await expectRedirect(
      () => signUp(formData),
      "/register?guest=ready&email=test%40example.com&account_type=teacher",
    );

    expect(discardGuestSandboxMock).toHaveBeenCalledWith("sandbox-1");
    expect(supabaseAuth.signOut).toHaveBeenCalled();
    expect(supabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it("fails closed when guest sandbox discard fails", async () => {
    getAuthContextMock.mockResolvedValue({
      isGuest: true,
      sandboxId: "sandbox-1",
      supabase: { auth: supabaseAuth },
    });
    discardGuestSandboxMock.mockResolvedValueOnce({ ok: false, error: "discard failed" });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass1");
    formData.set("account_type", "teacher");

    await expectRedirect(
      () => signUp(formData),
      "/register?error=discard%20failed",
    );

    expect(discardGuestSandboxMock).toHaveBeenCalledWith("sandbox-1");
    expect(supabaseAuth.signOut).not.toHaveBeenCalled();
    expect(supabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it("fails closed when guest sign out fails", async () => {
    getAuthContextMock.mockResolvedValue({
      isGuest: true,
      sandboxId: "sandbox-1",
      supabase: { auth: supabaseAuth },
    });
    discardGuestSandboxMock.mockResolvedValueOnce({ ok: true });
    supabaseAuth.signOut.mockResolvedValueOnce({ error: { message: "sign out failed" } });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass1");
    formData.set("account_type", "teacher");

    await expectRedirect(
      () => signUp(formData),
      "/register?error=sign%20out%20failed",
    );

    expect(discardGuestSandboxMock).toHaveBeenCalledWith("sandbox-1");
    expect(supabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it("redirects to login with verify on successful sign up", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ai-stem-learning-platform-group-8.vercel.app";
    supabaseAuth.signUp.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass1");
    formData.set("account_type", "student");

    await expectRedirect(
      () => signUp(formData),
      /;\/register\?account_type=student&email=test%40example\.com&resend=confirmation&resend_started_at=\d+&verify=1;/,
    );
    expect(redirect).toHaveBeenCalled();
    expect(supabaseAuth.signUp).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "goodpass1",
      options: {
        data: { account_type: "student" },
        emailRedirectTo: "https://ai-stem-learning-platform-group-8.vercel.app",
      },
    });
  });

  it("can return successful sign up verification to the home auth modal", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ai-stem-learning-platform-group-8.vercel.app";
    supabaseAuth.signUp.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass1");
    formData.set("account_type", "student");
    formData.set("auth_return_to", "/?auth=sign-up");
    formData.set("auth_success_to", "/?auth=sign-up");

    await expectRedirect(
      () => signUp(formData),
      /;\/\?auth=sign-up&account_type=student&email=test%40example\.com&resend=confirmation&resend_started_at=\d+&verify=1;/,
    );
  });

  it("rejects sign up password shorter than 8 characters", async () => {
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "abc123");
    formData.set("account_type", "teacher");

    await expectRedirect(
      () => signUp(formData),
      `/register?error=${encodeURIComponent(PASSWORD_POLICY_ERROR_MESSAGE)}`,
    );
    expect(supabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it("rejects sign up password without digits", async () => {
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "abcdefgh");
    formData.set("account_type", "teacher");

    await expectRedirect(
      () => signUp(formData),
      `/register?error=${encodeURIComponent(PASSWORD_POLICY_ERROR_MESSAGE)}`,
    );
    expect(supabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it("rejects sign up password without letters", async () => {
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "12345678");
    formData.set("account_type", "teacher");

    await expectRedirect(
      () => signUp(formData),
      `/register?error=${encodeURIComponent(PASSWORD_POLICY_ERROR_MESSAGE)}`,
    );
    expect(supabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it("redirects to register when account type is missing", async () => {
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass");

    await expectRedirect(
      () => signUp(formData),
      "/register?error=Select%20an%20account%20type",
    );
    expect(supabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it("signs out and redirects to login", async () => {
    supabaseAuth.signOut.mockResolvedValueOnce({});

    await expectRedirect(() => signOut(), "/login");
    expect(supabaseAuth.signOut).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalled();
  });

  it("requests a password reset email using the canonical app URL", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ai-stem-learning-platform-group-8.vercel.app";
    supabaseAuth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

    const { requestPasswordReset } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");

    await expectRedirect(
      () => requestPasswordReset(formData),
      /;\/forgot-password\?email=test%40example\.com&resend=reset&resend_started_at=\d+&sent=1;/,
    );
    expect(supabaseAuth.resetPasswordForEmail).toHaveBeenCalledWith("test@example.com", {
      redirectTo: "https://ai-stem-learning-platform-group-8.vercel.app",
    });
  });

  it("returns password reset status to the home auth modal when requested", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ai-stem-learning-platform-group-8.vercel.app";
    supabaseAuth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

    const { requestPasswordReset } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("auth_return_to", "/?auth=forgot-password");

    await expectRedirect(
      () => requestPasswordReset(formData),
      /;\/\?auth=forgot-password&email=test%40example\.com&resend=reset&resend_started_at=\d+&sent=1;/,
    );
  });

  it("resends confirmation email and restarts the cooldown state", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ai-stem-learning-platform-group-8.vercel.app";
    supabaseAuth.resend.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    formData.set("email", "Edited@example.com");
    formData.set("auth_return_to", "/register");

    await expectRedirect(
      () => resendConfirmationEmail(formData),
      /;\/register\?email=edited%40example\.com&resend=confirmation&resend_started_at=\d+&verify=1;/,
    );
    expect(supabaseAuth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "edited@example.com",
      options: {
        emailRedirectTo: "https://ai-stem-learning-platform-group-8.vercel.app",
      },
    });
  });

  it("preserves account_type in the redirect after confirmation resend", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ai-stem-learning-platform-group-8.vercel.app";
    supabaseAuth.resend.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    formData.set("email", "teacher@example.com");
    formData.set("auth_return_to", "/register?account_type=teacher");

    await expectRedirect(
      () => resendConfirmationEmail(formData),
      /;\/register\?account_type=teacher&email=teacher%40example\.com&resend=confirmation&resend_started_at=\d+&verify=1;/,
    );
  });

  it("returns confirmation resend errors to the register surface", async () => {
    supabaseAuth.resend.mockResolvedValueOnce({ error: { message: "Too many requests" } });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("auth_return_to", "/?auth=sign-up");

    await expectRedirect(
      () => resendConfirmationEmail(formData),
      "/?auth=sign-up&email=test%40example.com&error=Too%20many%20requests&resend=confirmation",
    );
  });

  it("resends password reset email and restarts the cooldown state", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ai-stem-learning-platform-group-8.vercel.app";
    supabaseAuth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    formData.set("email", "Edited@example.com");
    formData.set("auth_return_to", "/forgot-password");

    await expectRedirect(
      () => resendPasswordReset(formData),
      /;\/forgot-password\?email=edited%40example\.com&resend=reset&resend_started_at=\d+&sent=1;/,
    );
    expect(supabaseAuth.resetPasswordForEmail).toHaveBeenCalledWith("edited@example.com", {
      redirectTo: "https://ai-stem-learning-platform-group-8.vercel.app",
    });
  });

  it("returns password reset resend errors to the same auth surface", async () => {
    supabaseAuth.resetPasswordForEmail.mockResolvedValueOnce({
      error: { message: "Reset disabled" },
    });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("auth_return_to", "/?auth=forgot-password");

    await expectRedirect(
      () => resendPasswordReset(formData),
      "/?auth=forgot-password&email=test%40example.com&error=Reset%20disabled&resend=reset",
    );
  });

  it("updates the password during recovery and redirects back to login", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "test@example.com" } },
    });
    supabaseAuth.updateUser.mockResolvedValueOnce({ error: null });
    supabaseAuth.signOut.mockResolvedValueOnce({});

    const { completePasswordRecovery } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("new_password", "Newpass1");
    formData.set("confirm_password", "Newpass1");

    await expectRedirect(() => completePasswordRecovery(formData), "/login?reset=1");
    expect(supabaseAuth.updateUser).toHaveBeenCalledWith({ password: "Newpass1" });
    expect(supabaseAuth.signOut).toHaveBeenCalled();
  });
});
