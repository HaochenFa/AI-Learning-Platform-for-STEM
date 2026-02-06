import { createServerSupabaseClient } from "@/lib/supabase/server";

export function isDueDateLocked(dueAt: string | null, now = new Date()) {
  if (!dueAt) {
    return false;
  }
  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }
  return now.getTime() > dueDate.getTime();
}

export function getBestScorePercent(
  submissions: Array<{ score: number | null }>,
  fallbackPercent: number,
) {
  const numericScores = submissions
    .map((submission) => submission.score)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (numericScores.length === 0) {
    return fallbackPercent;
  }

  return Math.max(...numericScores, fallbackPercent);
}

export async function listStudentSubmissions(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  assignmentId: string;
  studentId: string;
}) {
  const { data, error } = await input.supabase
    .from("submissions")
    .select("id,assignment_id,student_id,content,score,submitted_at")
    .eq("assignment_id", input.assignmentId)
    .eq("student_id", input.studentId)
    .order("submitted_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function markRecipientStatus(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  assignmentId: string;
  studentId: string;
  status: "assigned" | "in_progress" | "submitted" | "reviewed";
}) {
  const { error } = await input.supabase
    .from("assignment_recipients")
    .update({ status: input.status })
    .eq("assignment_id", input.assignmentId)
    .eq("student_id", input.studentId);

  if (error) {
    throw new Error(error.message);
  }
}
