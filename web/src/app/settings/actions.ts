"use server";

import { redirect } from "next/navigation";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 60;

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

/**
 * Internal redirect helper for settings server actions.
 *
 * Builds a `/settings` URL with `section`, `status`, and optional `message`
 * and `step` query params, then calls `redirect()` (which throws in Next.js).
 *
 * The `step` param drives multi-step UI flows — currently only `"otp"` is used
 * to advance the password change flow to the OTP verification screen.
 *
 * @param section Settings panel to activate: `"profile"` or `"password"`.
 * @param status Outcome indicator shown as a feedback banner.
 * @param message Optional human-readable status message.
 * @param step Optional step token for multi-step flows.
 */
function redirectSettings(
  section: "profile" | "password",
  status: "success" | "error",
  message?: string,
  step?: string,
) {
  const search = new URLSearchParams({
    section,
    status,
  });
  if (message) {
    search.set("message", message);
  }
  if (step) {
    search.set("step", step);
  }
  redirect(`/settings?${search.toString()}`);
}

/**
 * Server action — updates the authenticated user's display name.
 *
 * Validates that the display name is between `DISPLAY_NAME_MIN` (2) and
 * `DISPLAY_NAME_MAX` (60) characters, then writes to `profiles.display_name`.
 * Redirects to `/settings?section=profile&status=success|error` on completion.
 *
 * @param formData Must contain `display_name` (string, trimmed automatically).
 */
export async function updateDisplayName(formData: FormData) {
  const displayName = getFormValue(formData, "display_name");

  if (displayName.length < DISPLAY_NAME_MIN) {
    redirectSettings("profile", "error", "Display name must be at least 2 characters.");
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    redirectSettings("profile", "error", "Display name must be 60 characters or less.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id);

  if (error) {
    redirectSettings("profile", "error", error.message);
  }

  redirectSettings("profile", "success", "Display name updated.");
}

/**
 * Server action — step 1 of the two-step password change flow.
 *
 * Verifies the user's current password via `signInWithPassword`, then triggers
 * `reauthenticate()` which sends a one-time password (OTP) to the user's email.
 * On success, redirects to `/settings?step=otp` so the UI advances to the OTP
 * entry screen.
 *
 * **Why two calls?** `signInWithPassword` confirms the user knows their current
 * password; `reauthenticate()` is Supabase's mechanism for issuing a nonce that
 * `updateUser({ nonce })` will consume in step 2 to authorise the password change.
 *
 * @param formData Must contain `current_password` (string).
 */
export async function verifyAndSendOtp(formData: FormData) {
  const currentPassword = getFormValue(formData, "current_password");

  if (!currentPassword) {
    redirectSettings("password", "error", "Enter your current password.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    redirect("/login");
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) {
    redirectSettings("password", "error", "Current password is incorrect.");
  }

  const { error: reauthError } = await supabase.auth.reauthenticate();
  if (reauthError) {
    redirectSettings("password", "error", reauthError.message);
  }

  redirectSettings("password", "success", "Verification code sent to your email.", "otp");
}

/**
 * Server action — step 2 of the two-step password change flow.
 *
 * Validates the 6-digit OTP and new password against the password policy,
 * then calls `updateUser({ password, nonce: otp })` to complete the change.
 * The `nonce` is the OTP issued by `reauthenticate()` in step 1; Supabase
 * consumes it to authorise the update without requiring a fresh sign-in.
 *
 * On success, redirects to `/settings?section=password&status=success` with
 * no `step` param — clearing the OTP screen in the UI.
 *
 * @param formData Must contain `otp` (6-digit string), `new_password`, and
 *   `confirm_password`.
 */
export async function changePasswordWithOtp(formData: FormData) {
  const otp = getFormValue(formData, "otp");
  const newPassword = getFormValue(formData, "new_password");
  const confirmPassword = getFormValue(formData, "confirm_password");

  if (!otp || otp.length < 6) {
    redirectSettings("password", "error", "Enter the 6-digit verification code.", "otp");
  }

  const passwordValidation = validatePasswordPolicy(newPassword);
  if (!passwordValidation.ok) {
    redirectSettings("password", "error", passwordValidation.message, "otp");
  }

  if (newPassword !== confirmPassword) {
    redirectSettings("password", "error", "New password confirmation does not match.", "otp");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
    nonce: otp,
  });
  if (error) {
    redirectSettings("password", "error", error.message, "otp");
  }

  redirectSettings("password", "success", "Password changed successfully.");
}
