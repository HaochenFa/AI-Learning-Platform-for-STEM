"use server";

import { redirect } from "next/navigation";
import { generateTextWithFallback } from "@/lib/ai/providers";
import {
  createWholeClassAssignment,
  loadStudentAssignmentContext,
  requirePublishedBlueprintId,
} from "@/lib/activities/assignments";
import { getClassAccess, requireAuthenticatedUser } from "@/lib/activities/access";
import {
  getBestScorePercent,
  isDueDateLocked,
  listStudentSubmissions,
  markRecipientStatus,
} from "@/lib/activities/submissions";
import type { FlashcardsSessionSubmissionContent } from "@/lib/activities/types";
import { loadPublishedBlueprintContext } from "@/lib/chat/context";
import { parseDueAt, parseHighlights, parseOptionalScore } from "@/lib/chat/validation";
import {
  buildFlashcardsGenerationPrompt,
  parseFlashcardsGenerationResponse,
} from "@/lib/flashcards/generation";
import {
  DEFAULT_FLASHCARD_COUNT,
  parseCardCount,
  parseFlashcardsDraftPayload,
  parseFlashcardsSessionPayload,
} from "@/lib/flashcards/validation";
import { retrieveMaterialContext } from "@/lib/materials/retrieval";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const FLASHCARDS_REQUEST_PURPOSE = "flashcards_generation_v1";

function redirectWithError(path: string, message: string) {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

async function restoreFlashcardsDraftState(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  activityId: string;
  title: string;
  config: Record<string, unknown>;
  cards: Array<{ front: string; back: string; order_index: number }>;
}) {
  const { error: restoreActivityError } = await input.supabase
    .from("activities")
    .update({
      title: input.title,
      config: input.config,
    })
    .eq("id", input.activityId)
    .eq("class_id", input.classId);

  if (restoreActivityError) {
    console.error("Failed to restore flashcards activity after save failure", {
      classId: input.classId,
      activityId: input.activityId,
      error: restoreActivityError.message,
    });
  }

  const { error: deleteCardsError } = await input.supabase
    .from("flashcards")
    .delete()
    .eq("activity_id", input.activityId);

  if (deleteCardsError) {
    console.error("Failed to clear flashcards cards during rollback", {
      classId: input.classId,
      activityId: input.activityId,
      error: deleteCardsError.message,
    });
    return;
  }

  if (input.cards.length === 0) {
    return;
  }

  const { error: restoreCardsError } = await input.supabase.from("flashcards").insert(
    input.cards.map((card) => ({
      activity_id: input.activityId,
      front: card.front,
      back: card.back,
      order_index: card.order_index,
    })),
  );

  if (restoreCardsError) {
    console.error("Failed to restore flashcards cards after save failure", {
      classId: input.classId,
      activityId: input.activityId,
      error: restoreCardsError.message,
    });
  }
}

async function logFlashcardsAiRequest(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  userId: string;
  provider: string;
  model?: string | null;
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
    purpose: FLASHCARDS_REQUEST_PURPOSE,
    status: input.status,
    latency_ms: input.latencyMs,
    prompt_tokens: input.promptTokens ?? null,
    completion_tokens: input.completionTokens ?? null,
    total_tokens: input.totalTokens ?? null,
  });

  if (error) {
    console.error("Failed to log flashcards ai request", {
      classId: input.classId,
      userId: input.userId,
      error: error.message,
    });
  }
}

export async function generateFlashcardsDraft(classId: string, formData: FormData) {
  const { supabase, user, authError } = await requireAuthenticatedUser({ accountType: "teacher" });
  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirectWithError(`/classes/${classId}`, authError);
    return;
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access is required to generate flashcards.");
    return;
  }

  const title = getFormString(formData, "title");
  const instructions = getFormString(formData, "instructions");

  if (!title) {
    redirectWithError(`/classes/${classId}/activities/flashcards/new`, "Flashcards title is required.");
    return;
  }
  if (!instructions) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/new`,
      "Flashcards instructions are required.",
    );
    return;
  }

  let cardCount = DEFAULT_FLASHCARD_COUNT;
  try {
    cardCount = parseCardCount(formData.get("card_count"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/new`,
      error instanceof Error ? error.message : "Card count is invalid.",
    );
    return;
  }

  let blueprintId = "";
  try {
    blueprintId = await requirePublishedBlueprintId(supabase, classId);
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/new`,
      error instanceof Error ? error.message : "Published blueprint is required.",
    );
    return;
  }

  const start = Date.now();
  let usedProvider = "unknown";

  try {
    const blueprintContext = await loadPublishedBlueprintContext(classId);
    const retrievalQuery = `Generate ${cardCount} flashcards. ${instructions}`;
    const materialContext = await retrieveMaterialContext(classId, retrievalQuery);

    const prompt = buildFlashcardsGenerationPrompt({
      classTitle: role.classTitle,
      cardCount,
      instructions,
      blueprintContext: blueprintContext.blueprintContext,
      materialContext,
    });

    const result = await generateTextWithFallback({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      maxTokens: 1600,
    });
    usedProvider = result.provider;

    const payload = parseFlashcardsGenerationResponse(result.content);
    const trimmedCards = payload.cards.slice(0, cardCount);

    if (trimmedCards.length === 0) {
      throw new Error("The flashcards generator returned no valid cards.");
    }

    const { data: activity, error: activityError } = await supabase
      .from("activities")
      .insert({
        class_id: classId,
        blueprint_id: blueprintId,
        type: "flashcards",
        title,
        status: "draft",
        created_by: user.id,
        config: {
          mode: "assignment",
          cardCount,
          attemptLimit: 1,
          instructions,
        },
      })
      .select("id")
      .single();

    if (activityError || !activity) {
      throw new Error(activityError?.message ?? "Failed to create flashcards activity.");
    }

    const cardRows = trimmedCards.map((card, index) => ({
      activity_id: activity.id,
      front: card.front,
      back: card.back,
      order_index: index,
    }));

    const { error: cardsError } = await supabase.from("flashcards").insert(cardRows);
    if (cardsError) {
      const { error: cleanupActivityError } = await supabase
        .from("activities")
        .delete()
        .eq("id", activity.id)
        .eq("class_id", classId);

      if (cleanupActivityError) {
        console.error("Failed to rollback orphaned flashcards activity after card insert error", {
          classId,
          activityId: activity.id,
          error: cleanupActivityError.message,
        });
      }

      throw new Error(cardsError.message);
    }

    await logFlashcardsAiRequest({
      supabase,
      classId,
      userId: user.id,
      provider: result.provider,
      model: result.model,
      status: "success",
      latencyMs: result.latencyMs,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      totalTokens: result.usage?.totalTokens,
    });

    redirect(`/classes/${classId}/activities/flashcards/${activity.id}/edit?created=1`);
  } catch (error) {
    await logFlashcardsAiRequest({
      supabase,
      classId,
      userId: user.id,
      provider: usedProvider,
      status: "error",
      latencyMs: Date.now() - start,
    });

    redirectWithError(
      `/classes/${classId}/activities/flashcards/new`,
      error instanceof Error ? error.message : "Failed to generate flashcards draft.",
    );
  }
}

export async function saveFlashcardsDraft(
  classId: string,
  activityId: string,
  formData: FormData,
) {
  const { supabase, user, authError } = await requireAuthenticatedUser({ accountType: "teacher" });
  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirectWithError(`/classes/${classId}`, authError);
    return;
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access is required to edit flashcards.");
    return;
  }

  let payload: ReturnType<typeof parseFlashcardsDraftPayload>;
  try {
    payload = parseFlashcardsDraftPayload(formData.get("flashcards_payload"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      error instanceof Error ? error.message : "Flashcards payload is invalid.",
    );
    return;
  }

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select("id,class_id,type,status,title,config")
    .eq("id", activityId)
    .eq("class_id", classId)
    .single();

  if (activityError || !activity || activity.type !== "flashcards") {
    redirectWithError(`/classes/${classId}`, "Flashcards activity not found.");
    return;
  }

  if (activity.status !== "draft") {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      "Only draft flashcards can be edited.",
    );
    return;
  }

  const currentConfig =
    activity.config && typeof activity.config === "object"
      ? (activity.config as Record<string, unknown>)
      : {};

  const { data: existingCards, error: existingCardsError } = await supabase
    .from("flashcards")
    .select("front,back,order_index")
    .eq("activity_id", activityId)
    .order("order_index", { ascending: true });

  if (existingCardsError) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      existingCardsError.message,
    );
    return;
  }

  const rollbackState = {
    title: activity.title,
    config: currentConfig,
    cards: existingCards ?? [],
  };

  const nextConfig = {
    ...currentConfig,
    mode: "assignment",
    cardCount: payload.cards.length,
    attemptLimit: 1,
    instructions: payload.instructions,
  };

  try {
    const { error: updateActivityError } = await supabase
      .from("activities")
      .update({
        title: payload.title,
        config: nextConfig,
      })
      .eq("id", activityId)
      .eq("class_id", classId);

    if (updateActivityError) {
      throw new Error(updateActivityError.message);
    }

    const { error: deleteCardsError } = await supabase
      .from("flashcards")
      .delete()
      .eq("activity_id", activityId);

    if (deleteCardsError) {
      throw new Error(deleteCardsError.message);
    }

    const { error: insertCardsError } = await supabase.from("flashcards").insert(
      payload.cards.map((card, index) => ({
        activity_id: activityId,
        front: card.front,
        back: card.back,
        order_index: index,
      })),
    );

    if (insertCardsError) {
      throw new Error(insertCardsError.message);
    }
  } catch (error) {
    await restoreFlashcardsDraftState({
      supabase,
      classId,
      activityId,
      title: rollbackState.title,
      config: rollbackState.config,
      cards: rollbackState.cards,
    });

    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      error instanceof Error ? error.message : "Failed to save flashcards draft.",
    );
    return;
  }

  redirect(`/classes/${classId}/activities/flashcards/${activityId}/edit?saved=1`);
}

export async function publishFlashcardsActivity(classId: string, activityId: string) {
  const { supabase, user, authError } = await requireAuthenticatedUser({ accountType: "teacher" });
  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirectWithError(`/classes/${classId}`, authError);
    return;
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access is required to publish flashcards.");
    return;
  }

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select("id,class_id,type,status")
    .eq("id", activityId)
    .eq("class_id", classId)
    .single();

  if (activityError || !activity || activity.type !== "flashcards") {
    redirectWithError(`/classes/${classId}`, "Flashcards activity not found.");
    return;
  }

  if (activity.status !== "draft") {
    redirect(`/classes/${classId}/activities/flashcards/${activityId}/edit?published=1`);
    return;
  }

  const { data: cards, error: cardsError } = await supabase
    .from("flashcards")
    .select("id")
    .eq("activity_id", activityId)
    .order("order_index", { ascending: true });

  if (cardsError) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      cardsError.message,
    );
    return;
  }

  if (!cards || cards.length === 0) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      "Add at least one flashcard before publishing.",
    );
    return;
  }

  const { error: publishError } = await supabase
    .from("activities")
    .update({ status: "published" })
    .eq("id", activityId)
    .eq("class_id", classId);

  if (publishError) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      publishError.message,
    );
    return;
  }

  redirect(`/classes/${classId}/activities/flashcards/${activityId}/edit?published=1`);
}

export async function createFlashcardsAssignment(
  classId: string,
  activityId: string,
  formData: FormData,
) {
  const { supabase, user, authError } = await requireAuthenticatedUser({ accountType: "teacher" });
  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirectWithError(`/classes/${classId}`, authError);
    return;
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access is required to create assignments.");
    return;
  }

  let dueAt: string | null = null;
  try {
    dueAt = parseDueAt(formData.get("due_at"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      error instanceof Error ? error.message : "Due date is invalid.",
    );
    return;
  }

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select("id,class_id,type,status")
    .eq("id", activityId)
    .eq("class_id", classId)
    .single();

  if (activityError || !activity || activity.type !== "flashcards") {
    redirectWithError(`/classes/${classId}`, "Flashcards activity not found.");
    return;
  }

  if (activity.status !== "published") {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      "Publish these flashcards before creating an assignment.",
    );
    return;
  }

  try {
    const assignmentId = await createWholeClassAssignment({
      supabase,
      classId,
      activityId,
      teacherId: user.id,
      dueAt,
    });

    redirect(`/classes/${classId}/assignments/${assignmentId}/review?created=1`);
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/flashcards/${activityId}/edit`,
      error instanceof Error ? error.message : "Failed to create assignment.",
    );
  }
}

export async function submitFlashcardsSession(
  classId: string,
  assignmentId: string,
  formData: FormData,
) {
  const { supabase, user, authError } = await requireAuthenticatedUser({ accountType: "student" });
  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirectWithError(`/classes/${classId}/assignments/${assignmentId}/flashcards`, authError);
    return;
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isMember) {
    redirectWithError(`/classes/${classId}`, "Class access required.");
    return;
  }

  let assignmentContext: Awaited<ReturnType<typeof loadStudentAssignmentContext>>;
  try {
    assignmentContext = await loadStudentAssignmentContext({
      supabase,
      classId,
      assignmentId,
      userId: user.id,
      expectedType: "flashcards",
    });
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/flashcards`,
      error instanceof Error ? error.message : "Unable to access assignment.",
    );
    return;
  }

  if (assignmentContext.activity.status !== "published") {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/flashcards`,
      "These flashcards are not yet available.",
    );
    return;
  }

  const attemptLimit =
    typeof assignmentContext.activity.config.attemptLimit === "number"
      ? assignmentContext.activity.config.attemptLimit
      : 1;

  if (isDueDateLocked(assignmentContext.assignment.due_at)) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/flashcards`,
      "This session is locked because the due date has passed.",
    );
    return;
  }

  const priorSubmissions = await listStudentSubmissions({
    supabase,
    assignmentId,
    studentId: user.id,
  });

  if (priorSubmissions.length >= attemptLimit) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/flashcards`,
      "No attempts remaining for this flashcards assignment.",
    );
    return;
  }

  const { data: cardRows, error: cardsError } = await supabase
    .from("flashcards")
    .select("id")
    .eq("activity_id", assignmentContext.activity.id)
    .order("order_index", { ascending: true });

  if (cardsError || !cardRows || cardRows.length === 0) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/flashcards`,
      cardsError?.message ?? "Flashcards are unavailable.",
    );
    return;
  }

  let sessionPayload: ReturnType<typeof parseFlashcardsSessionPayload>;
  try {
    sessionPayload = parseFlashcardsSessionPayload(formData.get("session_payload"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/flashcards`,
      error instanceof Error ? error.message : "Invalid flashcards session payload.",
    );
    return;
  }

  if (sessionPayload.cardsReviewed !== cardRows.length) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/flashcards`,
      "Review all flashcards before submitting.",
    );
    return;
  }

  const scorePercent = Math.round((sessionPayload.knownCount / sessionPayload.cardsReviewed) * 100);
  const sessionNumber = priorSubmissions.length + 1;
  const payload: FlashcardsSessionSubmissionContent = {
    mode: "flashcards_session",
    activityId: assignmentContext.activity.id,
    sessionNumber,
    cardsReviewed: sessionPayload.cardsReviewed,
    knownCount: sessionPayload.knownCount,
    reviewCount: sessionPayload.reviewCount,
    scorePercent,
    submittedAt: new Date().toISOString(),
  };

  const { error: insertError } = await supabase.from("submissions").insert({
    assignment_id: assignmentId,
    student_id: user.id,
    content: payload,
    score: payload.scorePercent,
    submitted_at: payload.submittedAt,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      const latestSubmissions = await listStudentSubmissions({
        supabase,
        assignmentId,
        studentId: user.id,
      });

      if (latestSubmissions.length >= attemptLimit) {
        redirectWithError(
          `/classes/${classId}/assignments/${assignmentId}/flashcards`,
          "No attempts remaining for this flashcards assignment.",
        );
        return;
      }

      redirectWithError(
        `/classes/${classId}/assignments/${assignmentId}/flashcards`,
        "This session was already recorded. Please try again.",
      );
      return;
    }

    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/flashcards`,
      insertError.message,
    );
    return;
  }

  try {
    const attemptsUsedAfterSubmit = priorSubmissions.length + 1;
    const nextStatus = attemptsUsedAfterSubmit >= attemptLimit ? "submitted" : "in_progress";
    await markRecipientStatus({
      supabase,
      assignmentId,
      studentId: user.id,
      status: nextStatus,
    });
  } catch (error) {
    console.error("Failed to update assignment recipient after flashcards submission", {
      assignmentId,
      studentId: user.id,
      error,
    });
  }

  const bestScore = getBestScorePercent(priorSubmissions, payload.scorePercent);
  redirect(
    `/classes/${classId}/assignments/${assignmentId}/flashcards?submitted=1&best=${bestScore}`,
  );
}

export async function reviewFlashcardsSubmission(
  classId: string,
  submissionId: string,
  formData: FormData,
) {
  const { supabase, user, authError } = await requireAuthenticatedUser({ accountType: "teacher" });
  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirectWithError(`/classes/${classId}`, authError);
    return;
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access required.");
    return;
  }

  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("id,assignment_id,student_id")
    .eq("id", submissionId)
    .single();

  if (submissionError || !submission) {
    redirectWithError(`/classes/${classId}`, "Submission not found.");
    return;
  }

  const assignmentId = submission.assignment_id;

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id,class_id")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .single();

  if (assignmentError || !assignment) {
    redirectWithError(`/classes/${classId}`, "Assignment not found.");
    return;
  }

  let score: number | null = null;
  let highlights: string[] = [];
  try {
    score = parseOptionalScore(formData.get("score"));
    highlights = parseHighlights(formData.get("highlights"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      error instanceof Error ? error.message : "Feedback payload is invalid.",
    );
    return;
  }

  const comment = getFormString(formData, "comment");

  if (score === null && !comment && highlights.length === 0) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      "Provide a score, comment, or at least one highlight.",
    );
    return;
  }

  if (comment || highlights.length > 0) {
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
      redirectWithError(
        `/classes/${classId}/assignments/${assignmentId}/review`,
        feedbackError.message,
      );
      return;
    }
  }

  if (score !== null) {
    const { error: scoreError } = await supabase
      .from("submissions")
      .update({ score })
      .eq("id", submission.id);

    if (scoreError) {
      redirectWithError(
        `/classes/${classId}/assignments/${assignmentId}/review`,
        scoreError.message,
      );
      return;
    }
  }

  try {
    await markRecipientStatus({
      supabase,
      assignmentId,
      studentId: submission.student_id,
      status: "reviewed",
    });
  } catch (error) {
    console.error("Failed to update assignment recipient after flashcards review", {
      assignmentId,
      submissionId,
      error,
    });
  }

  redirect(`/classes/${classId}/assignments/${assignmentId}/review?saved=1`);
}
