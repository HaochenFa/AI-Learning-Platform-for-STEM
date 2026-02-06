import type { ActivityType, AssignmentContext } from "@/lib/activities/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function requirePublishedBlueprintId(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  classId: string,
) {
  const { data: publishedBlueprint, error: publishedBlueprintError } = await supabase
    .from("blueprints")
    .select("id")
    .eq("class_id", classId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (publishedBlueprintError) {
    throw new Error(publishedBlueprintError.message);
  }

  if (!publishedBlueprint) {
    throw new Error("Publish a blueprint before creating assignments.");
  }

  return publishedBlueprint.id;
}

export async function createWholeClassAssignment(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  activityId: string;
  teacherId: string;
  dueAt: string | null;
}) {
  const { data: assignment, error: assignmentError } = await input.supabase
    .from("assignments")
    .insert({
      class_id: input.classId,
      activity_id: input.activityId,
      assigned_by: input.teacherId,
      due_at: input.dueAt,
    })
    .select("id")
    .single();

  if (assignmentError || !assignment) {
    throw new Error(assignmentError?.message ?? "Failed to create assignment.");
  }

  const rollbackAssignment = async () => {
    const { error } = await input.supabase
      .from("assignments")
      .delete()
      .eq("id", assignment.id)
      .eq("class_id", input.classId);

    return error;
  };

  const { data: students, error: studentsError } = await input.supabase
    .from("enrollments")
    .select("user_id")
    .eq("class_id", input.classId)
    .eq("role", "student");

  if (studentsError) {
    const rollbackError = await rollbackAssignment();
    if (rollbackError) {
      throw new Error(`${studentsError.message} (rollback failed: ${rollbackError.message})`);
    }

    throw new Error(studentsError.message);
  }

  if ((students ?? []).length > 0) {
    const recipients = students!.map((student) => ({
      assignment_id: assignment.id,
      student_id: student.user_id,
      status: "assigned",
    }));

    const { error: recipientsError } = await input.supabase
      .from("assignment_recipients")
      .insert(recipients);

    if (recipientsError) {
      const rollbackError = await rollbackAssignment();
      if (rollbackError) {
        throw new Error(`${recipientsError.message} (rollback failed: ${rollbackError.message})`);
      }

      throw new Error(recipientsError.message);
    }
  }

  return assignment.id;
}

export async function loadStudentAssignmentContext(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  assignmentId: string;
  userId: string;
  expectedType?: ActivityType;
}) {
  const { data: recipient, error: recipientError } = await input.supabase
    .from("assignment_recipients")
    .select("assignment_id,status")
    .eq("assignment_id", input.assignmentId)
    .eq("student_id", input.userId)
    .maybeSingle();

  if (recipientError || !recipient) {
    throw new Error("You are not assigned to this activity.");
  }

  const { data: assignment, error: assignmentError } = await input.supabase
    .from("assignments")
    .select("id,class_id,activity_id,due_at")
    .eq("id", input.assignmentId)
    .eq("class_id", input.classId)
    .single();

  if (assignmentError || !assignment) {
    throw new Error("Assignment not found.");
  }

  const { data: activity, error: activityError } = await input.supabase
    .from("activities")
    .select("id,title,type,status,config")
    .eq("id", assignment.activity_id)
    .eq("class_id", input.classId)
    .single();

  if (activityError || !activity) {
    throw new Error("Assignment activity not found.");
  }

  if (input.expectedType && activity.type !== input.expectedType) {
    throw new Error(`This assignment is not a ${input.expectedType} activity.`);
  }

  const safeConfig =
    activity.config && typeof activity.config === "object"
      ? (activity.config as Record<string, unknown>)
      : {};

  const context: AssignmentContext = {
    assignment,
    activity: {
      id: activity.id,
      title: activity.title,
      type: activity.type as ActivityType,
      status: activity.status,
      config: safeConfig,
    },
    recipient,
  };

  return context;
}
