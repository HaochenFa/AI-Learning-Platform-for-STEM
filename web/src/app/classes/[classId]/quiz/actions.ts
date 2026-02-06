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
import type { QuizAttemptSubmissionContent } from "@/lib/activities/types";
import { loadPublishedBlueprintContext } from "@/lib/chat/context";
import { retrieveMaterialContext } from "@/lib/materials/retrieval";
import { gradeQuizAttempt } from "@/lib/quiz/grading";
import { buildQuizGenerationPrompt, parseQuizGenerationResponse } from "@/lib/quiz/generation";
import {
  DEFAULT_QUIZ_QUESTION_COUNT,
  parseDueAt,
  parseHighlights,
  parseOptionalScore,
  parseQuestionCount,
  parseQuizAnswers,
  parseQuizDraftPayload,
} from "@/lib/quiz/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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

async function logQuizAiRequest(input: {
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
    purpose: "quiz_generation",
    status: input.status,
    latency_ms: input.latencyMs,
    prompt_tokens: input.promptTokens ?? null,
    completion_tokens: input.completionTokens ?? null,
    total_tokens: input.totalTokens ?? null,
  });

  if (error) {
    console.error("Failed to log quiz ai request", {
      classId: input.classId,
      userId: input.userId,
      error: error.message,
    });
  }
}

export async function generateQuizDraft(classId: string, formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access is required to generate quizzes.");
    return;
  }

  const title = getFormString(formData, "title");
  const instructions = getFormString(formData, "instructions");

  if (!title) {
    redirectWithError(`/classes/${classId}/activities/quiz/new`, "Quiz title is required.");
    return;
  }

  if (!instructions) {
    redirectWithError(`/classes/${classId}/activities/quiz/new`, "Quiz instructions are required.");
    return;
  }

  let questionCount = DEFAULT_QUIZ_QUESTION_COUNT;
  try {
    questionCount = parseQuestionCount(formData.get("question_count"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/quiz/new`,
      error instanceof Error ? error.message : "Question count is invalid.",
    );
    return;
  }

  let blueprintId = "";
  try {
    blueprintId = await requirePublishedBlueprintId(supabase, classId);
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/quiz/new`,
      error instanceof Error ? error.message : "Published blueprint is required.",
    );
    return;
  }

  const start = Date.now();
  let usedProvider = "unknown";

  try {
    const blueprintContext = await loadPublishedBlueprintContext(classId);
    const retrievalQuery = `Generate ${questionCount} multiple choice quiz questions. ${instructions}`;
    const materialContext = await retrieveMaterialContext(classId, retrievalQuery);

    const prompt = buildQuizGenerationPrompt({
      classTitle: role.classTitle,
      questionCount,
      instructions,
      blueprintContext: blueprintContext.blueprintContext,
      materialContext,
    });

    const result = await generateTextWithFallback({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      maxTokens: 1800,
    });
    usedProvider = result.provider;

    const payload = parseQuizGenerationResponse(result.content);
    const trimmedQuestions = payload.questions.slice(0, questionCount);

    if (trimmedQuestions.length === 0) {
      throw new Error("The quiz generator returned no valid questions.");
    }

    const { data: activity, error: activityError } = await supabase
      .from("activities")
      .insert({
        class_id: classId,
        blueprint_id: blueprintId,
        type: "quiz",
        title,
        status: "draft",
        created_by: user.id,
        config: {
          mode: "assignment",
          questionCount,
          attemptLimit: 2,
          scoringPolicy: "best_of_attempts",
          revealPolicy: "after_final_attempt",
          instructions,
        },
      })
      .select("id")
      .single();

    if (activityError || !activity) {
      throw new Error(activityError?.message ?? "Failed to create quiz activity.");
    }

    const questionRows = trimmedQuestions.map((question, index) => ({
      activity_id: activity.id,
      question: question.question,
      choices: question.choices,
      answer: question.answer,
      explanation: question.explanation,
      order_index: index,
    }));

    const { error: questionsError } = await supabase.from("quiz_questions").insert(questionRows);
    if (questionsError) {
      const { error: cleanupActivityError } = await supabase
        .from("activities")
        .delete()
        .eq("id", activity.id)
        .eq("class_id", classId);

      if (cleanupActivityError) {
        console.error("Failed to rollback orphaned quiz activity after question insert error", {
          classId,
          activityId: activity.id,
          error: cleanupActivityError.message,
        });
      }

      throw new Error(questionsError.message);
    }

    await logQuizAiRequest({
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

    redirect(`/classes/${classId}/activities/quiz/${activity.id}/edit?created=1`);
  } catch (error) {
    await logQuizAiRequest({
      supabase,
      classId,
      userId: user.id,
      provider: usedProvider,
      status: "error",
      latencyMs: Date.now() - start,
    });

    redirectWithError(
      `/classes/${classId}/activities/quiz/new`,
      error instanceof Error ? error.message : "Failed to generate quiz draft.",
    );
  }
}

export async function saveQuizDraft(classId: string, activityId: string, formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access is required to edit quizzes.");
    return;
  }

  let payload: ReturnType<typeof parseQuizDraftPayload>;
  try {
    payload = parseQuizDraftPayload(formData.get("quiz_payload"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      error instanceof Error ? error.message : "Quiz payload is invalid.",
    );
    return;
  }

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select("id,class_id,type,status,config")
    .eq("id", activityId)
    .eq("class_id", classId)
    .single();

  if (activityError || !activity || activity.type !== "quiz") {
    redirectWithError(`/classes/${classId}`, "Quiz activity not found.");
    return;
  }

  if (activity.status !== "draft") {
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      "Only draft quizzes can be edited.",
    );
    return;
  }

  const currentConfig =
    activity.config && typeof activity.config === "object"
      ? (activity.config as Record<string, unknown>)
      : {};

  const { error: updateActivityError } = await supabase
    .from("activities")
    .update({
      title: payload.title,
      config: {
        ...currentConfig,
        mode: "assignment",
        questionCount: payload.questions.length,
        attemptLimit: 2,
        scoringPolicy: "best_of_attempts",
        revealPolicy: "after_final_attempt",
        instructions: payload.instructions,
      },
    })
    .eq("id", activityId);

  if (updateActivityError) {
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      updateActivityError.message,
    );
    return;
  }

  const { error: upsertQuestionsError } = await supabase.from("quiz_questions").upsert(
    payload.questions.map((question, index) => ({
      activity_id: activityId,
      question: question.question,
      choices: question.choices,
      answer: question.answer,
      explanation: question.explanation,
      order_index: index,
    })),
    {
      onConflict: "activity_id,order_index",
    },
  );

  if (upsertQuestionsError) {
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      upsertQuestionsError.message,
    );
    return;
  }

  const { error: trimStaleQuestionsError } = await supabase
    .from("quiz_questions")
    .delete()
    .eq("activity_id", activityId)
    .gte("order_index", payload.questions.length);

  if (trimStaleQuestionsError) {
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      trimStaleQuestionsError.message,
    );
    return;
  }

  redirect(`/classes/${classId}/activities/quiz/${activityId}/edit?saved=1`);
}

export async function publishQuizActivity(classId: string, activityId: string) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isTeacher) {
    redirectWithError(`/classes/${classId}`, "Teacher access is required to publish quizzes.");
    return;
  }

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select("id,class_id,type,status")
    .eq("id", activityId)
    .eq("class_id", classId)
    .single();

  if (activityError || !activity || activity.type !== "quiz") {
    redirectWithError(`/classes/${classId}`, "Quiz activity not found.");
    return;
  }

  if (activity.status !== "draft") {
    redirect(`/classes/${classId}/activities/quiz/${activityId}/edit?published=1`);
    return;
  }

  const { data: questions, error: questionsError } = await supabase
    .from("quiz_questions")
    .select("id")
    .eq("activity_id", activityId)
    .order("order_index", { ascending: true });

  if (questionsError) {
    redirectWithError(`/classes/${classId}/activities/quiz/${activityId}/edit`, questionsError.message);
    return;
  }

  if (!questions || questions.length === 0) {
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      "Add at least one quiz question before publishing.",
    );
    return;
  }

  const { error: publishError } = await supabase
    .from("activities")
    .update({ status: "published" })
    .eq("id", activityId);

  if (publishError) {
    redirectWithError(`/classes/${classId}/activities/quiz/${activityId}/edit`, publishError.message);
    return;
  }

  redirect(`/classes/${classId}/activities/quiz/${activityId}/edit?published=1`);
}

export async function createQuizAssignment(classId: string, activityId: string, formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
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
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
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

  if (activityError || !activity || activity.type !== "quiz") {
    redirectWithError(`/classes/${classId}`, "Quiz activity not found.");
    return;
  }

  if (activity.status !== "published") {
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      "Publish this quiz before creating an assignment.",
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
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      error instanceof Error ? error.message : "Failed to create assignment.",
    );
  }
}

export async function submitQuizAttempt(classId: string, assignmentId: string, formData: FormData) {
  const { supabase, user } = await requireAuthenticatedUser();
  if (!user) {
    redirect("/login");
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
      expectedType: "quiz",
    });
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      error instanceof Error ? error.message : "Unable to access assignment.",
    );
    return;
  }

  if (assignmentContext.activity.status !== "published") {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      "This quiz is not yet available.",
    );
    return;
  }

  const attemptLimit =
    typeof assignmentContext.activity.config.attemptLimit === "number"
      ? assignmentContext.activity.config.attemptLimit
      : 2;

  if (isDueDateLocked(assignmentContext.assignment.due_at)) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      "This quiz is locked because the due date has passed.",
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
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      "No attempts remaining for this quiz.",
    );
    return;
  }

  const { data: questionRows, error: questionsError } = await supabase
    .from("quiz_questions")
    .select("id,question,choices,answer,explanation,order_index")
    .eq("activity_id", assignmentContext.activity.id)
    .order("order_index", { ascending: true });

  if (questionsError || !questionRows || questionRows.length === 0) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      questionsError?.message ?? "Quiz questions are unavailable.",
    );
    return;
  }

  let submittedAnswers: ReturnType<typeof parseQuizAnswers>;
  try {
    submittedAnswers = parseQuizAnswers(formData.get("answers"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      error instanceof Error ? error.message : "Invalid quiz answers.",
    );
    return;
  }

  const questionIds = questionRows.map((question) => question.id);
  const answerQuestionIds = submittedAnswers.map((answer) => answer.questionId);
  if (answerQuestionIds.length !== questionIds.length) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      "Answer all questions before submitting.",
    );
    return;
  }

  if (new Set(answerQuestionIds).size !== answerQuestionIds.length) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      "Each question can only be answered once.",
    );
    return;
  }

  const questions = questionRows.map((row) => ({
    id: row.id,
    question: row.question,
    choices: Array.isArray(row.choices)
      ? row.choices.filter((choice): choice is string => typeof choice === "string")
      : [],
    answer: row.answer ?? "",
    explanation: row.explanation ?? "",
    orderIndex: row.order_index,
  }));

  const graded = gradeQuizAttempt({
    questions,
    answers: submittedAnswers,
  });

  const attemptNumber = priorSubmissions.length + 1;
  const payload: QuizAttemptSubmissionContent = {
    mode: "quiz_attempt",
    activityId: assignmentContext.activity.id,
    attemptNumber,
    answers: submittedAnswers,
    scoreRaw: graded.scoreRaw,
    scorePercent: graded.scorePercent,
    maxPoints: graded.maxPoints,
    submittedAt: new Date().toISOString(),
  };

  const { error: insertError } = await supabase.from("submissions").insert({
    assignment_id: assignmentId,
    student_id: user.id,
    content: payload,
    score: graded.scorePercent,
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
          `/classes/${classId}/assignments/${assignmentId}/quiz`,
          "No attempts remaining for this quiz.",
        );
        return;
      }

      redirectWithError(
        `/classes/${classId}/assignments/${assignmentId}/quiz`,
        "This attempt was already recorded. Please review your attempts and try again.",
      );
      return;
    }

    redirectWithError(`/classes/${classId}/assignments/${assignmentId}/quiz`, insertError.message);
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
    console.error("Failed to update assignment recipient after quiz submission", {
      assignmentId,
      studentId: user.id,
      error,
    });
  }

  const bestScore = getBestScorePercent(priorSubmissions, graded.scorePercent);
  redirect(`/classes/${classId}/assignments/${assignmentId}/quiz?submitted=1&best=${bestScore}`);
}

export async function reviewQuizSubmission(
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

  if (score === null && !comment && highlights.length === 0) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      "Provide a score, comment, or at least one highlight.",
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

  if (score !== null) {
    const { error: scoreError } = await supabase
      .from("submissions")
      .update({ score })
      .eq("id", submission.id);

    if (scoreError) {
      redirectWithError(`/classes/${classId}/assignments/${assignmentId}/review`, scoreError.message);
      return;
    }
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
      redirectWithError(`/classes/${classId}/assignments/${assignmentId}/review`, feedbackError.message);
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
    console.error("Failed to update assignment recipient status after review", {
      assignmentId,
      studentId: submission.student_id,
      error,
    });
  }

  redirect(`/classes/${classId}/assignments/${assignmentId}/review?saved=1`);
}
