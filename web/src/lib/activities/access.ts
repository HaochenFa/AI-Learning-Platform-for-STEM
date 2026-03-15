import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ClassAccess } from "@/lib/activities/types";
import { getAuthContext, type AccountType } from "@/lib/auth/session";

export async function requireAuthenticatedUser(options?: {
  accountType?: AccountType;
  requireVerifiedEmail?: boolean;
}) {
  const { supabase, user, accessToken, profile, isEmailVerified } = await getAuthContext();
  const requiredRole = options?.accountType;
  const profileAccountType = profile?.account_type;
  const authError = !user
    ? "Please sign in."
    : options?.requireVerifiedEmail !== false && !isEmailVerified
      ? "Please verify your email before continuing."
      : !profileAccountType
        ? "Account setup is incomplete. Please sign in again."
        : requiredRole && profileAccountType !== requiredRole
        ? `This action requires a ${requiredRole} account.`
        : null;

  return {
    supabase,
    user,
    accessToken,
    profile,
    isEmailVerified,
    authError,
  };
}

export async function getClassAccess(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  classId: string,
  userId: string,
): Promise<ClassAccess> {
  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id,title,owner_id")
    .eq("id", classId)
    .single();

  if (classError || !classRow) {
    return {
      found: false,
      isTeacher: false,
      isMember: false,
      classTitle: "",
    };
  }

  if (classRow.owner_id === userId) {
    return {
      found: true,
      isTeacher: true,
      isMember: true,
      classTitle: classRow.title,
      classOwnerId: classRow.owner_id,
    };
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .single();

  const role = enrollment?.role;
  const isTeacher = role === "teacher" || role === "ta";
  const isMember = Boolean(role);

  return {
    found: true,
    isTeacher,
    isMember,
    classTitle: classRow.title,
    classOwnerId: classRow.owner_id,
  };
}
