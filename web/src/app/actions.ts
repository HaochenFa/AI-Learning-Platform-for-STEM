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

function getEmailValue(formData: FormData, key = "email") {
  return getFormValue(formData, key).toLowerCase();
}

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

/**
 * Detects whether a Supabase auth error signals that the email address is
 * already registered, regardless of which layer raised the error.
 *
 * Three distinct codes must be handled because the error origin varies:
 *  - `email_exists` / `user_already_exists` — raised by Supabase GoTrue (auth
 *    service) when a sign-up is attempted for an existing email.
 *  - `23505` — PostgreSQL unique-violation code; surfaced when the profiles
 *    trigger fires and a duplicate insert is attempted at the DB layer.
 *  - HTTP 422 — the Supabase REST gateway wraps the same condition as an
 *    Unprocessable Entity when the GoTrue JSON body is not yet parsed.
 *
 * Normalising all three to a single boolean lets callers show a consistent
 * "try signing in" message without branching on the source.
 *
 * @param error   Partial error shape returned by Supabase auth calls.
 * @returns       `true` when the email is already in use.
 */
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

function getResendStartedAt() {
  return String(Date.now());
}

/**
 * Builds the URL query-parameter bag used by the resend / email-sent UI pages
 * to know which flow is in progress and whether to show the "email sent"
 * confirmation banner.
 *
 * Two separate boolean-style fields are used instead of one because the
 * UI components for the "confirmation" and "reset" flows are rendered on
 * different pages and listen for different parameter names:
 *  - `verify=1`  is read by the email-confirmation waiting screen.
 *  - `sent=1`    is read by the password-reset waiting screen.
 *
 * Keeping them distinct means adding a single `?sent=1` to a reset URL never
 * accidentally triggers the confirmation banner, and vice-versa — even though
 * both flows share the same `buildResendStateParams` utility.
 *
 * @param input.flow              Which email flow is in progress.
 * @param input.accountType       Account type to carry through the redirect
 *                                (used by confirmation page to show correct copy).
 * @param input.email             Pre-fills the resend form so the user does
 *                                not have to retype their address.
 * @param input.sent              When `true`, signals that an email was just
 *                                dispatched and the "check your inbox" banner
 *                                should be shown.
 * @param input.error             Inline error message to surface on the page.
 * @param input.resendStartedAt   Unix-millisecond timestamp used to drive the
 *                                cooldown timer that prevents rapid resends.
 * @returns                       A flat record of nullable string values ready
 *                                to be spread into `buildRedirectUrl`.
 */
function buildResendStateParams(input: {
  flow: "confirmation" | "reset";
  accountType?: "teacher" | "student" | null;
  email?: string;
  sent?: boolean;
  error?: string;
  resendStartedAt?: string | null;
}) {
  return {
    ...(input.accountType !== undefined ? { account_type: input.accountType } : {}),
    email: input.email ?? null,
    error: input.error ?? null,
    resend: input.flow,
    resend_started_at: input.resendStartedAt ?? null,
    // `sent` is only set for the password-reset flow; `verify` for confirmation.
    // Using distinct params prevents cross-flow banner activation (see JSDoc above).
    sent: input.flow === "reset" && input.sent ? "1" : null,
    verify: input.flow === "confirmation" && input.sent ? "1" : null,
  };
}

/**
 * Signs an existing user in with email and password, then redirects to their
 * role-appropriate dashboard.
 *
 * On success the user is redirected to `/teacher/dashboard`, `/student/dashboard`,
 * or the generic `/dashboard` fallback when the profile's `account_type` is not
 * yet set.  On failure the error message is appended to the return-to URL so the
 * auth surface can surface it inline.
 *
 * @param formData   Must contain `email`, `password`, and optionally
 *                   `auth_return_to` (the page to redirect back to on error).
 */
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

/**
 * Creates a new email/password account and immediately sends a confirmation email.
 *
 * Handles the special case where the submitting browser already holds an active
 * guest (anonymous) session: the guest sandbox is discarded and the anonymous
 * session is signed out **before** calling `supabase.auth.signUp`.  Doing both
 * operations in-process (rather than via a redirect) avoids a redirect loop
 * described below.
 *
 * Guest → real-account sequence detail:
 *   1. **Discard the sandbox** — cleans up the guest-specific DB rows (class
 *      membership, rate-limit tracking, etc.) so they do not pollute the new
 *      real account.
 *   2. **Sign out the anonymous session** — clears the Supabase auth cookie so
 *      that `getAuthContext()` on the immediately following `signUp` call no
 *      longer detects a guest user.  If we were to redirect instead of falling
 *      through, the cookie-clearing might not persist across the redirect; the
 *      next `getAuthContext()` would see the (stale) anonymous user, classify
 *      it as a guest again, and loop back to step 1 indefinitely.
 *   3. **Create the real account** — only reached after both clean-up steps
 *      succeed in the same server request, guaranteeing a clean state.
 *
 * On duplicate email the error is mapped to a user-friendly message via
 * `isEmailAlreadyRegisteredError`.
 *
 * @param formData   Must contain `email`, `password`, `account_type`
 *                   (`"teacher"` | `"student"`), and optionally
 *                   `auth_return_to` / `auth_success_to` redirect paths.
 */
export async function signUp(formData: FormData) {
  const email = getEmailValue(formData);
  const password = getFormValue(formData, "password");
  const accountType = parseAccountType(getFormValue(formData, "account_type"));
  const authReturnTo = getAuthReturnTo(formData, "/register");
  const authSuccessTo = getAuthReturnTo(formData, "/register", "auth_success_to");

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

  // --- Guest session cleanup ---
  if (existingContext.isGuest && existingContext.sandboxId) {
    // Step 1: Remove all guest-specific DB rows for this sandbox.
    const discarded = await discardGuestSandbox(existingContext.sandboxId);
    if (!discarded.ok) {
      redirect(buildRedirectUrl(authReturnTo, { error: discarded.error ?? "Unable to discard guest sandbox." }));
    }

    // --- Sign out anonymous session ---
    // Step 2: Clear the anonymous auth cookie so the next getAuthContext() call
    // does not re-detect this browser as a guest.
    const signOutResult = await existingContext.supabase.auth.signOut();
    if (signOutResult?.error) {
      redirect(buildRedirectUrl(authReturnTo, { error: signOutResult.error.message }));
    }

    // After signing out the anonymous session, fall through to create the real account
    // immediately. Redirecting back with guest=ready and asking the user to re-submit
    // is unreliable: if the signOut cookie-clearing does not persist across the redirect,
    // getAuthContext() on the next submit re-detects the user as a guest, causing a loop.
  }

  // --- Account creation ---
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
    // Map duplicate-email errors to a friendlier message that suggests signing in
    // instead of revealing that the address is already registered (minor privacy guard).
    const msg = isEmailAlreadyRegisteredError(error)
      ? DUPLICATE_SIGN_UP_ERROR_MESSAGE
      : error.message;

    redirect(buildRedirectUrl(authReturnTo, { error: msg }));
  }

  // --- Redirect to email-confirmation waiting screen ---
  redirect(
    buildRedirectUrl(
      authSuccessTo,
      buildResendStateParams({
        accountType,
        flow: "confirmation",
        email,
        sent: true,
        resendStartedAt: getResendStartedAt(),
      }),
    ),
  );
}

/**
 * Sends a password-reset email to the supplied address.
 *
 * Always redirects to the forgot-password page — on success with the resend
 * state params so the waiting UI is shown, on failure with an error message.
 * The action never reveals whether the address is registered (Supabase's
 * `resetPasswordForEmail` is intentionally silent for unknown addresses).
 *
 * @param formData   Must contain `email` and optionally `auth_return_to`.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = getEmailValue(formData);
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

  redirect(
    buildRedirectUrl(
      authReturnTo,
      buildResendStateParams({
        flow: "reset",
        email,
        sent: true,
        resendStartedAt: getResendStartedAt(),
      }),
    ),
  );
}

/**
 * Resends the sign-up confirmation email for an address that has not yet been
 * verified.
 *
 * Called when the user clicks "Resend email" on the confirmation waiting screen.
 * On success, resets the `resend_started_at` timestamp so the cooldown timer
 * restarts from now.
 *
 * @param formData   Must contain `email` and optionally `auth_return_to`.
 */
export async function resendConfirmationEmail(formData: FormData) {
  const email = getEmailValue(formData);
  const authReturnTo = getAuthReturnTo(formData, "/register");

  if (!email) {
    redirect(
      buildRedirectUrl(
        authReturnTo,
        buildResendStateParams({
          flow: "confirmation",
          error: "Enter your email address.",
        }),
      ),
    );
  }

  const supabase = await createServerSupabaseClient();
  const authRedirectUrl = getAuthRedirectUrl();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: authRedirectUrl,
    },
  });

  if (error) {
    redirect(
      buildRedirectUrl(
        authReturnTo,
        buildResendStateParams({
          flow: "confirmation",
          email,
          error: error.message,
        }),
      ),
    );
  }

  redirect(
    buildRedirectUrl(
      authReturnTo,
      buildResendStateParams({
        flow: "confirmation",
        email,
        sent: true,
        resendStartedAt: getResendStartedAt(),
      }),
    ),
  );
}

/**
 * Resends the password-reset email for an address that missed or lost the
 * original link.
 *
 * Structurally identical to `resendConfirmationEmail` but operates on the
 * `"reset"` flow so that `buildResendStateParams` sets `sent=1` instead of
 * `verify=1`.
 *
 * @param formData   Must contain `email` and optionally `auth_return_to`.
 */
export async function resendPasswordReset(formData: FormData) {
  const email = getEmailValue(formData);
  const authReturnTo = getAuthReturnTo(formData, "/forgot-password");

  if (!email) {
    redirect(
      buildRedirectUrl(
        authReturnTo,
        buildResendStateParams({
          flow: "reset",
          error: "Enter your email address.",
        }),
      ),
    );
  }

  const supabase = await createServerSupabaseClient();
  const authRedirectUrl = getAuthRedirectUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectUrl,
  });

  if (error) {
    redirect(
      buildRedirectUrl(
        authReturnTo,
        buildResendStateParams({
          flow: "reset",
          email,
          error: error.message,
        }),
      ),
    );
  }

  redirect(
    buildRedirectUrl(
      authReturnTo,
      buildResendStateParams({
        flow: "reset",
        email,
        sent: true,
        resendStartedAt: getResendStartedAt(),
      }),
    ),
  );
}

/**
 * Completes the password-recovery flow by setting the user's new password.
 *
 * This action is only reachable after the user has clicked the password-reset
 * link in their email, which lands them on `/reset-password` with a valid
 * Supabase recovery session cookie.  If that session has expired, `getUser()`
 * returns `null` and the user is redirected to request a new link.
 *
 * After a successful update the session is signed out so the user must log in
 * with the new password — this prevents stale recovery tokens from remaining
 * active.
 *
 * @param formData   Must contain `new_password` and `confirm_password`.
 */
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

  // Sign out the recovery session so the browser must authenticate with the
  // new password; leaving the session active would allow the old recovery
  // token to be reused.
  await supabase.auth.signOut();
  redirect("/login?reset=1");
}

/**
 * Signs the current user out and redirects to the login page.
 *
 * Works for both regular and guest (anonymous) sessions — Supabase's `signOut`
 * clears the cookie regardless of the session type.
 */
export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Provisions a new guest (anonymous) session and returns the redirect URL for
 * the guest's sandboxed class.
 *
 * This action is called from the `/guest/enter` page.  It returns a result
 * object rather than redirecting so the client component can handle rate-limit
 * feedback without a full page reload.
 *
 * Rate-limit hits are logged at `warn` level; other failures at `error` level,
 * because rate limiting is an expected operational event rather than an
 * application fault.
 *
 * @param input.ipAddress   Caller's IP address, forwarded from the request
 *                          headers to enforce per-IP session rate limits.
 * @returns                 `{ ok: true, redirectTo }` on success, or
 *                          `{ ok: false, code, error }` with a structured
 *                          failure code on any error.
 */
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

    // Rate-limit hits are expected operational events; use warn rather than error.
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

/**
 * Resets the current guest's sandbox to a clean state (new class, fresh data)
 * without issuing a new anonymous sign-in.
 *
 * Used by the guest UI when the user clicks "Start over".  Returns a result
 * object (not a redirect) so the caller can update the client-side router.
 *
 * @returns   `{ ok: true, redirectTo }` on success, or `{ ok: false, error }`
 *            if the session is missing or the reset fails.
 */
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

/**
 * Switches the active guest session between the teacher and student roles
 * within the same sandbox.
 *
 * Guest sandboxes support both roles so a single anonymous user can explore
 * the platform from either perspective.  The switch is persisted in the DB
 * via `switchGuestRole` and takes effect on the next page load.
 *
 * @param nextRole   The role to switch to (`"teacher"` or `"student"`).
 * @returns          `{ ok: true }` on success, or `{ ok: false, error }`.
 */
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
