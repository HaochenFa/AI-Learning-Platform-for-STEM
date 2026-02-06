"use server";

import { redirect } from "next/navigation";
import { generateTextWithFallback } from "@/lib/ai/providers";
import {
  createWholeClassAssignment,
  loadStudentAssignmentContext,
  requirePublishedBlueprintId,
} from "@/lib/activities/assignments";
import { getClassAccess, requireAuthenticatedUser } from "@/lib/activities/access";
import { markRecipientStatus } from "@/lib/activities/submissions";
import { buildChatPrompt, loadPublishedBlueprintContext } from "@/lib/chat/context";
import type { ChatModelResponse, ChatTurn } from "@/lib/chat/types";
import {
  buildChatAssignmentSubmissionContent,
  parseChatMessage,
  parseChatModelResponse,
  parseChatTurns,
  parseDueAt,
  parseHighlights,
  parseOptionalScore,
  parseReflection,
} from "@/lib/chat/validation";
import { retrieveMaterialContext } from "@/lib/materials/retrieval";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ChatActionResult =
  | {
      ok: true;
      response: ChatModelResponse;
    }
  | {
      ok: false;
      error: string;
    };

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function redirectWithError(path: string, message: string) {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function logChatAiRequest(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  userId: string;
  provider: string;
  model?: string | null;
  purpose: string;
  status: string;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}) {
  const { error } = await input.supabase.from("ai_requests").insert({
    class_id: input.classId,
    user_id: input.userId,
    provider: input.provider,
    model: input.model ?? null,
    purpose: input.purpose,
    status: input.status,
    latency_ms: input.latencyMs,
    prompt_tokens: input.promptTokens ?? null,
    completion_tokens: input.completionTokens ?? null,
    total_tokens: input.totalTokens ?? null,
  });

  if (error) {
    console.error("Failed to log chat ai request", {
      classId: input.classId,
      userId: input.userId,
      purpose: input.purpose,
      error: error.message,
    });
  }
}

async function generateChatResponse(input: {
  classId: string;
  classTitle: string;
  userId: string;
  userMessage: string;
  transcript: ChatTurn[];
  assignmentInstructions?: string | null;
  purpose: "student_chat_open" | "student_chat_assignment";
}) {
  const supabase = await createServerSupabaseClient();

  const blueprintContext = await loadPublishedBlueprintContext(input.classId);
  const retrievalQuery = input.assignmentInstructions
    ? `${input.assignmentInstructions}\n\n${input.userMessage}`
    : input.userMessage;
  const materialContext = await retrieveMaterialContext(input.classId, retrievalQuery);
  const prompt = buildChatPrompt({
    classTitle: input.classTitle,
    userMessage: input.userMessage,
    transcript: input.transcript,
    blueprintContext: blueprintContext.blueprintContext,
    materialContext,
    assignmentInstructions: input.assignmentInstructions,
  });

  const startedAt = Date.now();
  try {
    const result = await generateTextWithFallback({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      maxTokens: 1200,
    });

    const parsed = parseChatModelResponse(result.content);
    await logChatAiRequest({
      supabase,
      classId: input.classId,
      userId: input.userId,
      provider: result.provider,
      model: result.model,
      purpose: input.purpose,
      status: "success",
      latencyMs: result.latencyMs,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      totalTokens: result.usage?.totalTokens,
    });

    return parsed;
  } catch (error) {
    await logChatAiRequest({
      supabase,
      classId: input.classId,
      userId: input.userId,
      provider: "unknown",
      purpose: input.purpose,
      status: "error",
      latencyMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function sendOpenPracticeMessage(
  classId: string,
  formData: FormData,
): Promise<ChatActionResult> {
  const { supabase, user } = await requireAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Please sign in to use chat." };
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isMember) {
    return { ok: false, error: "Class access required." };
  }

  let message: string;
  let transcript: ChatTurn[];
  try {
    message = parseChatMessage(formData.get("message"));
    transcript = parseChatTurns(formData.get("transcript"));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid chat payload.",
    };
  }

  try {
    const response = await generateChatResponse({
      classId,
      classTitle: role.classTitle,
      userId: user.id,
      userMessage: message,
      transcript,
      purpose: "student_chat_open",
    });

    return {
      ok: true,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to generate chat response.",
    };
  }
}

export async function createChatAssignment(classId: string, formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access is required to create assignments.");
    return;
  }

  const title = getFormString(formData, "title");
  const instructions = getFormString(formData, "instructions");

  if (!title) {
    redirectWithError(`/classes/${classId}/activities/chat/new`, "Assignment title is required.");
    return;
  }

  if (!instructions) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      "Assignment instructions are required.",
    );
    return;
  }

  let dueAt: string | null = null;
  try {
    dueAt = parseDueAt(formData.get("due_at"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      error instanceof Error ? error.message : "Due date is invalid.",
    );
    return;
  }

  let blueprintId = "";
  try {
    blueprintId = await requirePublishedBlueprintId(supabase, classId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Published blueprint is required.";
    if (message.includes("Publish a blueprint")) {
      redirectWithError(
        `/classes/${classId}/activities/chat/new`,
        "Publish a blueprint before creating chat assignments.",
      );
      return;
    }
    redirectWithError(`/classes/${classId}/activities/chat/new`, message);
    return;
  }

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .insert({
      class_id: classId,
      blueprint_id: blueprintId,
      type: "chat",
      title,
      config: {
        instructions,
        mode: "assignment",
      },
      status: "published",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (activityError || !activity) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      activityError?.message ?? "Failed to create activity.",
    );
    return;
  }

  let assignmentId = "";
  try {
    assignmentId = await createWholeClassAssignment({
      supabase,
      classId,
      activityId: activity.id,
      teacherId: user.id,
      dueAt,
    });
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      error instanceof Error ? error.message : "Failed to create assignment.",
    );
    return;
  }

  redirect(`/classes/${classId}/assignments/${assignmentId}/review?created=1`);
}

export async function sendAssignmentMessage(
  classId: string,
  assignmentId: string,
  formData: FormData,
): Promise<ChatActionResult> {
  const { supabase, user } = await requireAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Please sign in to continue." };
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isMember) {
    return { ok: false, error: "Class access required." };
  }

  let message: string;
  let transcript: ChatTurn[];
  try {
    message = parseChatMessage(formData.get("message"));
    transcript = parseChatTurns(formData.get("transcript"));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid chat payload.",
    };
  }

  let assignmentContext: Awaited<ReturnType<typeof loadStudentAssignmentContext>>;
  try {
    assignmentContext = await loadStudentAssignmentContext({
      supabase,
      classId,
      assignmentId,
      userId: user.id,
      expectedType: "chat",
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to access assignment.",
    };
  }

  const assignmentInstructions =
    typeof assignmentContext.activity.config.instructions === "string"
      ? assignmentContext.activity.config.instructions
      : null;

  try {
    const response = await generateChatResponse({
      classId,
      classTitle: role.classTitle,
      userId: user.id,
      userMessage: message,
      transcript,
      assignmentInstructions,
      purpose: "student_chat_assignment",
    });

    return {
      ok: true,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to generate chat response.",
    };
  }
}

export async function submitChatAssignment(
  classId: string,
  assignmentId: string,
  formData: FormData,
) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  let transcript: ChatTurn[];
  let reflection: string;
  try {
    transcript = parseChatTurns(formData.get("transcript"));
    reflection = parseReflection(formData.get("reflection"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/chat`,
      error instanceof Error ? error.message : "Invalid submission payload.",
    );
    return;
  }

  if (transcript.length === 0) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/chat`,
      "At least one chat turn is required before submission.",
    );
    return;
  }

  let assignmentContext: Awaited<ReturnType<typeof loadStudentAssignmentContext>>;
  try {
    assignmentContext = await loadStudentAssignmentContext({
      supabase,
      classId,
      assignmentId,
      userId: user.id,
      expectedType: "chat",
    });
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/chat`,
      error instanceof Error ? error.message : "Unable to access assignment.",
    );
    return;
  }

  const content = buildChatAssignmentSubmissionContent({
    activityId: assignmentContext.activity.id,
    transcript,
    reflection,
  });

  const { data: existingSubmission, error: existingSubmissionError } = await supabase
    .from("submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSubmissionError) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/chat`,
      existingSubmissionError.message,
    );
    return;
  }

  if (existingSubmission) {
    const { error: updateError } = await supabase
      .from("submissions")
      .update({
        content,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", existingSubmission.id);

    if (updateError) {
      redirectWithError(`/classes/${classId}/assignments/${assignmentId}/chat`, updateError.message);
      return;
    }
  } else {
    const { error: insertError } = await supabase.from("submissions").insert({
      assignment_id: assignmentId,
      student_id: user.id,
      content,
      submitted_at: new Date().toISOString(),
    });

    if (insertError) {
      redirectWithError(`/classes/${classId}/assignments/${assignmentId}/chat`, insertError.message);
      return;
    }
  }

  try {
    await markRecipientStatus({
      supabase,
      assignmentId,
      studentId: user.id,
      status: "submitted",
    });
  } catch (error) {
    console.error("Failed to update assignment_recipients status to 'submitted'", {
      assignmentId,
      studentId: user.id,
      error,
    });
  }

  redirect(`/classes/${classId}/assignments/${assignmentId}/chat?submitted=1`);
}

export async function reviewChatSubmission(
  classId: string,
  submissionId: string,
  formData: FormData,
) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  const assignmentId = getFormString(formData, "assignment_id");
  if (!assignmentId) {
    redirectWithError(`/classes/${classId}`, "Assignment id is required.");
    return;
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access required.");
    return;
  }

  let score: number | null;
  try {
    score = parseOptionalScore(formData.get("score"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      error instanceof Error ? error.message : "Score is invalid.",
    );
    return;
  }

  const comment = getFormString(formData, "comment");
  const highlights = parseHighlights(formData.get("highlights"));

  if (!comment && highlights.length === 0) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      "Provide a comment or at least one highlight.",
    );
    return;
  }

  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("id,assignment_id,student_id")
    .eq("id", submissionId)
    .eq("assignment_id", assignmentId)
    .single();

  if (submissionError || !submission) {
    redirectWithError(`/classes/${classId}/assignments/${assignmentId}/review`, "Submission not found.");
    return;
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id,class_id")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .single();

  if (assignmentError || !assignment) {
    redirectWithError(`/classes/${classId}/assignments/${assignmentId}/review`, "Assignment not found.");
    return;
  }

  const { error: scoreError } = await supabase
    .from("submissions")
    .update({ score })
    .eq("id", submission.id);

  if (scoreError) {
    redirectWithError(`/classes/${classId}/assignments/${assignmentId}/review`, scoreError.message);
    return;
  }

  const { error: feedbackError } = await supabase.from("feedback").insert({
    submission_id: submission.id,
    created_by: user.id,
    source: "teacher",
    content: {
      comment: comment || "",
      highlights,
    },
    is_edited: false,
  });

  if (feedbackError) {
    redirectWithError(`/classes/${classId}/assignments/${assignmentId}/review`, feedbackError.message);
    return;
  }

  try {
    await markRecipientStatus({
      supabase,
      assignmentId,
      studentId: submission.student_id,
      status: "reviewed",
    });
  } catch (error) {
    console.error("Failed to update assignment_recipients status to 'reviewed'", {
      assignmentId,
      studentId: submission.student_id,
      error,
    });
  }

  redirect(`/classes/${classId}/assignments/${assignmentId}/review?saved=1`);
}
