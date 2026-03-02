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

function redirectSettings(
  section: "profile" | "password",
  status: "success" | "error",
  message?: string,
) {
  const search = new URLSearchParams({
    section,
    status,
  });
  if (message) {
    search.set("message", message);
  }
  redirect(`/settings?${search.toString()}`);
}

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

export async function changePassword(formData: FormData) {
  const currentPassword = getFormValue(formData, "current_password");
  const newPassword = getFormValue(formData, "new_password");
  const confirmPassword = getFormValue(formData, "confirm_password");

  if (!currentPassword) {
    redirectSettings("password", "error", "Enter your current password.");
  }
  const passwordValidation = validatePasswordPolicy(newPassword);
  if (!passwordValidation.ok) {
    redirectSettings("password", "error", passwordValidation.message);
  }
  if (newPassword !== confirmPassword) {
    redirectSettings("password", "error", "New password confirmation does not match.");
  }
  if (newPassword === currentPassword) {
    redirectSettings("password", "error", "New password must be different from current password.");
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

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    redirectSettings("password", "error", updateError.message);
  }

  redirectSettings("password", "success", "Password changed successfully.");
}
