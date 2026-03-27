"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/session";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { isGuestModeEnabled } from "@/lib/guest/config";
import {
  discardGuestSandbox,
  provisionGuestSandboxWithOptions,
  resetGuestSandbox,
  switchGuestRole,
} from "@/lib/guest/sandbox";
import { getAuthRedirectUrl } from "@/lib/site-url";
import { redirect } from "next/navigation";

const DUPLICATE_SIGN_UP_ERROR_MESSAGE =
  "We couldn't create an account with that email. Try signing in or resetting your password.";

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function parseAccountType(value: string): "teacher" | "student" | null {
  return value === "teacher" || value === "student" ? value : null;
}

function isEmailAlreadyRegisteredError(error: {
  status?: number;
  code?: string;
}): boolean {
  const normalizedCode = (error.code ?? "").toLowerCase();
  return (
    error.status === 422 ||
    normalizedCode === "email_exists" ||
    normalizedCode === "user_already_exists" ||
    normalizedCode === "23505"
  );
}

function redirectToAuthPage(path: string, message?: string) {
  if (!message) {
    redirect(path);
  }

  const resolvedMessage = message ?? "Unexpected authentication error";
  const url = new URL(path, "http://localhost");
  url.searchParams.set("error", resolvedMessage);
  redirect(`${url.pathname}?${url.searchParams.toString()}`);
}

export async function signIn(formData: FormData) {
  const email = getFormValue(formData, "email");
  const password = getFormValue(formData, "password");

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  if (data?.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("account_type")
      .eq("id", data.user.id)
      .maybeSingle<{ account_type: "teacher" | "student" | null }>();

    if (profile?.account_type === "teacher") {
      redirect("/teacher/dashboard");
    }
    if (profile?.account_type === "student") {
      redirect("/student/dashboard");
    }
  }

  redirect("/dashboard");
}

export async function signUp(formData: FormData) {
  const email = getFormValue(formData, "email").toLowerCase();
  const password = getFormValue(formData, "password");
  const accountType = parseAccountType(getFormValue(formData, "account_type"));

  if (!accountType) {
    redirect("/register?error=Select%20an%20account%20type");
  }

  const passwordValidation = validatePasswordPolicy(password);
  if (!passwordValidation.ok) {
    redirect(`/register?error=${encodeURIComponent(passwordValidation.message)}`);
  }

  const existingContext = await getAuthContext();
  if (existingContext.guestSessionError) {
    redirect(`/register?error=${encodeURIComponent(existingContext.guestSessionError)}`);
  }

  if (existingContext.isGuest && existingContext.sandboxId) {
    const discarded = await discardGuestSandbox(existingContext.sandboxId);
    if (!discarded.ok) {
      redirect(
        `/register?error=${encodeURIComponent(
          discarded.error ?? "Unable to discard guest sandbox.",
        )}`,
      );
    }

    const signOutResult = await existingContext.supabase.auth.signOut();
    if (signOutResult?.error) {
      redirect(`/register?error=${encodeURIComponent(signOutResult.error.message)}`);
    }

    const redirectUrl = new URL("/register", "http://localhost");
    redirectUrl.searchParams.set("guest", "ready");
    if (email) {
      redirectUrl.searchParams.set("email", email);
    }
    redirectUrl.searchParams.set("account_type", accountType);
    redirect(redirectUrl.pathname + "?" + redirectUrl.searchParams.toString());
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { account_type: accountType },
      emailRedirectTo: getAuthRedirectUrl(),
    },
  });

  if (error) {
    const msg = isEmailAlreadyRegisteredError(error)
      ? DUPLICATE_SIGN_UP_ERROR_MESSAGE
      : error.message;

    redirect(`/register?error=${encodeURIComponent(msg)}`);
  }

  redirect("/login?verify=1");
}

export async function requestPasswordReset(formData: FormData) {
  const email = getFormValue(formData, "email").toLowerCase();

  if (!email) {
    redirectToAuthPage("/forgot-password", "Enter your email address.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRedirectUrl(),
  });

  if (error) {
    redirectToAuthPage("/forgot-password", error.message);
  }

  redirect("/forgot-password?sent=1");
}

export async function completePasswordRecovery(formData: FormData) {
  const newPassword = getFormValue(formData, "new_password");
  const confirmPassword = getFormValue(formData, "confirm_password");

  const passwordValidation = validatePasswordPolicy(newPassword);
  if (!passwordValidation.ok) {
    redirectToAuthPage("/reset-password", passwordValidation.message);
  }

  if (newPassword !== confirmPassword) {
    redirectToAuthPage("/reset-password", "New password confirmation does not match.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirectToAuthPage(
      "/forgot-password",
      "Your password reset session expired. Request a new reset link.",
    );
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    redirectToAuthPage("/reset-password", error.message);
  }

  await supabase.auth.signOut();
  redirect("/login?reset=1");
}

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function startGuestSession(input?: {
  ipAddress?: string | null;
}): Promise<{
  ok: boolean;
  redirectTo?: string;
  error?: string;
}> {
  if (!isGuestModeEnabled()) {
    return { ok: false, error: "Guest mode is not enabled." };
  }

  const result = await provisionGuestSandboxWithOptions({
    ipAddress: input?.ipAddress ?? null,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    redirectTo: `/classes/${result.classId}`,
  };
}

export async function resetGuestSessionAction(): Promise<{
  ok: boolean;
  redirectTo?: string;
  error?: string;
}> {
  const context = await getAuthContext();
  if (context.guestSessionError) {
    return { ok: false, error: context.guestSessionError };
  }
  if (!context.user || !context.isGuest) {
    return { ok: false, error: "Guest session not found." };
  }

  const result = await resetGuestSandbox(context.user.id);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    redirectTo: `/classes/${result.classId}`,
  };
}

export async function switchGuestRoleAction(
  nextRole: "teacher" | "student",
): Promise<{ ok: boolean; error?: string }> {
  const context = await getAuthContext();
  if (context.guestSessionError) {
    return { ok: false, error: context.guestSessionError };
  }
  if (!context.isGuest || !context.sandboxId) {
    return { ok: false, error: "Guest session not found." };
  }

  return switchGuestRole(context.sandboxId, nextRole);
}
