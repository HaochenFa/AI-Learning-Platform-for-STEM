"use server";

import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth/session";
import {
  requestClassTeachingBrief,
  type TeachingBriefActionResult,
  type TeachingBriefPayload,
  type TeachingBriefStatus,
} from "@/lib/ai/python-backend";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type { TeachingBriefPayload, TeachingBriefStatus, TeachingBriefActionResult };

function invalidClassResult(error: string): TeachingBriefActionResult {
  return {
    status: "error",
    generatedAt: null,
    isStale: false,
    isRefreshing: false,
    hasEvidence: false,
    payload: null,
    error,
  };
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function toFriendlyError(message: string): string {
  if (/timed out/i.test(message)) {
    return "Teaching brief request timed out. Please try again.";
  }

  return message || "Failed to load teaching brief.";
}

async function loadTeachingBrief(
  classId: string,
  forceRefresh: boolean,
): Promise<TeachingBriefActionResult> {
  let userId: string;
  let accessToken: string | null = null;

  try {
    const auth = await requireVerifiedUser({ accountType: "teacher" });
    userId = auth.user.id;
    accessToken = auth.accessToken;
  } catch {
    redirect("/login");
  }

  if (!isValidUuid(classId)) {
    return invalidClassResult("Invalid class.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: classRow, error: enrollmentError } = await supabase
    .from("enrollments").select("role")
    .eq("class_id", classId).eq("user_id", userId).maybeSingle();

  if (enrollmentError) {
    return invalidClassResult("Failed to verify class access.");
  }

  if (!["teacher", "ta"].includes(classRow?.role ?? "")) {
    return invalidClassResult("Unauthorized.");
  }

  try {
    return await requestClassTeachingBrief({
      classId,
      userId,
      forceRefresh,
      accessToken,
    });
  } catch (error) {
    return invalidClassResult(
      toFriendlyError(error instanceof Error ? error.message : "Failed to load teaching brief."),
    );
  }
}

export async function getClassTeachingBrief(
  classId: string,
): Promise<TeachingBriefActionResult> {
  return loadTeachingBrief(classId, false);
}

export async function refreshClassTeachingBrief(
  classId: string,
): Promise<TeachingBriefActionResult> {
  return loadTeachingBrief(classId, true);
}
