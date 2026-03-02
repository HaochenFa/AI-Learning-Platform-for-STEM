import { beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, signOut, signUp } from "@/app/actions";
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
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: supabaseAuth,
  }),
}));

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

describe("auth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("redirects to dashboard on successful sign in", async () => {
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass");

    await expectRedirect(() => signIn(formData), "/dashboard");
    expect(redirect).toHaveBeenCalled();
  });

  it("redirects to register with error on failed sign up", async () => {
    supabaseAuth.signUp.mockResolvedValueOnce({
      error: { message: "Email already used" },
    });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass1");
    formData.set("account_type", "teacher");

    await expectRedirect(() => signUp(formData), "/register?error=Email%20already%20used");
    expect(redirect).toHaveBeenCalled();
  });

  it("redirects to login with verify on successful sign up", async () => {
    supabaseAuth.signUp.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("password", "goodpass1");
    formData.set("account_type", "student");

    await expectRedirect(() => signUp(formData), "/login?verify=1");
    expect(redirect).toHaveBeenCalled();
    expect(supabaseAuth.signUp).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "goodpass1",
      options: { data: { account_type: "student" } },
    });
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
});
