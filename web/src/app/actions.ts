"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/session";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { isGuestModeEnabled } from "@/lib/guest/config";
import { type GuestProvisionFailureCode } from "@/lib/guest/errors";
import {
  discardGuestSandbox,
  provisionGuestSandboxWithOptions,
  resetGuestSandbox,
  switchGuestRole,
} from "@/lib/guest/sandbox";
import {
  buildRedirectUrl,
  sanitizeInternalRedirectPath,
} from "@/lib/auth/ui";
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

  redirect(buildRedirectUrl(path, { error: message ?? "Unexpected authentication error" }));
}

function getAuthReturnTo(
  formData: FormData,
  fallbackPath: string,
  fieldName = "auth_return_to",
) {
  return sanitizeInternalRedirectPath(formData.get(fieldName)) ?? fallbackPath;
}

export async function signIn(formData: FormData) {
  const email = getFormValue(formData, "email");
  const password = getFormValue(formData, "password");
  const authReturnTo = getAuthReturnTo(formData, "/login");

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(buildRedirectUrl(authReturnTo, { error: error.message }));
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
  const authReturnTo = getAuthReturnTo(formData, "/register");
  const authSuccessTo = getAuthReturnTo(formData, "/login", "auth_success_to");

  if (!accountType) {
    redirect(buildRedirectUrl(authReturnTo, { error: "Select an account type" }));
  }

  const passwordValidation = validatePasswordPolicy(password);
  if (!passwordValidation.ok) {
    redirect(buildRedirectUrl(authReturnTo, { error: passwordValidation.message }));
  }

  const existingContext = await getAuthContext();
  if (existingContext.guestSessionError) {
    redirect(buildRedirectUrl(authReturnTo, { error: existingContext.guestSessionError }));
  }

  if (existingContext.isGuest && existingContext.sandboxId) {
    const discarded = await discardGuestSandbox(existingContext.sandboxId);
    if (!discarded.ok) {
      redirect(buildRedirectUrl(authReturnTo, { error: discarded.error ?? "Unable to discard guest sandbox." }));
    }

    const signOutResult = await existingContext.supabase.auth.signOut();
    if (signOutResult?.error) {
      redirect(buildRedirectUrl(authReturnTo, { error: signOutResult.error.message }));
    }

    redirect(
      buildRedirectUrl(authReturnTo, {
        guest: "ready",
        email: email || null,
        account_type: accountType,
      }),
    );
  }

  const supabase = await createServerSupabaseClient();
  const authRedirectUrl = getAuthRedirectUrl();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { account_type: accountType },
      emailRedirectTo: authRedirectUrl,
    },
  });

  if (error) {
    const msg = isEmailAlreadyRegisteredError(error)
      ? DUPLICATE_SIGN_UP_ERROR_MESSAGE
      : error.message;

    redirect(buildRedirectUrl(authReturnTo, { error: msg }));
  }

  redirect(buildRedirectUrl(authSuccessTo, { verify: "1" }));
}

export async function requestPasswordReset(formData: FormData) {
  const email = getFormValue(formData, "email").toLowerCase();
  const authReturnTo = getAuthReturnTo(formData, "/forgot-password");

  if (!email) {
    redirectToAuthPage(authReturnTo, "Enter your email address.");
  }

  const supabase = await createServerSupabaseClient();
  const authRedirectUrl = getAuthRedirectUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectUrl,
  });

  if (error) {
    redirectToAuthPage(authReturnTo, error.message);
  }

  redirect(buildRedirectUrl(authReturnTo, { sent: "1" }));
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
  code?: GuestProvisionFailureCode;
  error?: string;
}> {
  if (!isGuestModeEnabled()) {
    return {
      ok: false,
      code: "guest-unavailable",
      error: "Guest mode is not enabled.",
    };
  }

  const result = await provisionGuestSandboxWithOptions({
    ipAddress: input?.ipAddress ?? null,
  });
  if (!result.ok) {
    const env =
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV ??
      "unknown";
    const payload = {
      code: result.code,
      reason: result.reason ?? "unspecified",
      message: result.error,
      env,
      hasIpAddress: Boolean(input?.ipAddress),
    };

    if (result.code === "too-many-guest-sessions") {
      console.warn("Guest session start blocked by rate limit", payload);
    } else {
      console.error("Guest session start failed", payload);
    }

    return { ok: false, code: result.code, error: result.error };
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
