"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { redirect } from "next/navigation";

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
  const email = getFormValue(formData, "email");
  const password = getFormValue(formData, "password");
  const accountType = parseAccountType(getFormValue(formData, "account_type"));

  if (!accountType) {
    redirect("/register?error=Select%20an%20account%20type");
  }

  const passwordValidation = validatePasswordPolicy(password);
  if (!passwordValidation.ok) {
    redirect(`/register?error=${encodeURIComponent(passwordValidation.message)}`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        account_type: accountType,
      },
    },
  });

  if (error) {
    redirect(`/register?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/login?verify=1");
}

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
