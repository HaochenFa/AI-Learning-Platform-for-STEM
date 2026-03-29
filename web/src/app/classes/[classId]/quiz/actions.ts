"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { generateQuizViaPythonBackend } from "@/lib/ai/python-quiz";
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

const QUIZ_REQUEST_PURPOSE = "quiz_generation_v2";
const QUIZ_GENERATION_ERROR_MESSAGE = "Unable to generate quiz draft right now. Please try again.";

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

function toFriendlyQuizGenerationError(error: unknown) {
  if (!(error instanceof Error)) {
    return QUIZ_GENERATION_ERROR_MESSAGE;
  }

  if (/NEXT_REDIRECT/i.test(error.message)) {
    return QUIZ_GENERATION_ERROR_MESSAGE;
  }

  if (/timed out/i.test(error.message)) {
    return "Quiz generation timed out. Please try again.";
  }

  if (/no json object found|not valid json|invalid quiz json/i.test(error.message)) {
    return "The AI response was incomplete. Please try generating the quiz again.";
  }

  return error.message;
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
    purpose: QUIZ_REQUEST_PURPOSE,
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

/**
 * Generates a new quiz draft via the Python AI backend and persists it as a
 * `draft` activity with its questions.
 *
 * Generation is scoped to a single topic when `topic_id` is supplied — the
 * blueprint context is narrowed to that topic's title, description, and
 * objectives before being sent to the AI.  Without a topic the full published
 * blueprint context is used.
 *
 * If question insertion fails after the activity row has been created, the
 * orphaned activity is deleted to avoid stale draft rows.
 *
 * AI provider usage (provider, model, token counts, latency) is always logged
 * to `ai_requests`, even on error, so that generation costs are auditable.
 *
 * @param classId    The class this quiz belongs to.
 * @param formData   Must contain `title`, `instructions`, and optionally
 *                   `question_count` (defaults to `DEFAULT_QUIZ_QUESTION_COUNT`)
 *                   and `topic_id` for topic-scoped generation.
 */
export async function generateQuizDraft(classId: string, formData: FormData) {
  // --- Auth and access ---
  const { supabase, user, authError, sandboxId, accessToken } = await requireAuthenticatedUser({ accountType: "teacher" });
  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirectWithError(`/classes/${classId}`, authError);
    return;
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

  // --- Blueprint loading ---
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

  // Optional topic scoping: filter blueprint context to a single topic when provided
  const topicId = getFormString(formData, "topic_id") || null;

  const start = Date.now();
  let usedProvider = "unknown";
  let usedModel: string | null = null;
  let usedUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
  let usedLatencyMs: number | null = null;

  try {
    // --- Topic scoping ---
    const fullBlueprintContext = await loadPublishedBlueprintContext(classId);
    let blueprintContextStr = fullBlueprintContext.blueprintContext;

    // When a topicId is provided, build a scoped context for that topic only
    if (topicId) {
      const { data: topicRow } = await supabase
        .from("topics")
        .select("id,title,description")
        .eq("id", topicId)
        .single();

      if (topicRow) {
        const { data: objectiveRows } = await supabase
          .from("objectives")
          .select("statement,level")
          .eq("topic_id", topicId);

        const objectiveLines = (objectiveRows ?? [])
          .map((o) => (o.level ? `  - ${o.statement} (${o.level})` : `  - ${o.statement}`))
          .join("\n");

        blueprintContextStr = [
          "Blueprint Context | Published blueprint context (topic-scoped)",
          `Summary: ${fullBlueprintContext.summary}`,
          "",
          `Topic: ${topicRow.title}`,
          topicRow.description ? `Description: ${topicRow.description}` : null,
          objectiveLines ? `Objectives:\n${objectiveLines}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      }
    }

    // --- AI call ---
    const retrievalQuery = `Generate ${questionCount} multiple choice quiz questions. ${instructions}`;
    const materialContext = await retrieveMaterialContext(classId, retrievalQuery, undefined, {
      accessToken,
      sandboxId,
    });
    const pythonResult = await generateQuizViaPythonBackend({
      classTitle: role.classTitle,
      questionCount,
      instructions,
      blueprintContext: blueprintContextStr,
      materialContext,
      accessToken,
      sandboxId,
    });
    usedProvider = pythonResult.provider;
    usedModel = pythonResult.model;
    usedUsage = pythonResult.usage;
    usedLatencyMs = pythonResult.latencyMs;

    // Truncate to the requested count in case the AI returned extras.
    const trimmedQuestions = pythonResult.payload.questions.slice(0, questionCount);

    if (trimmedQuestions.length === 0) {
      throw new Error("The quiz generator returned no valid questions.");
    }

    // --- Persistence ---
    const { data: activity, error: activityError } = await supabase
      .from("activities")
      .insert({
        class_id: classId,
        blueprint_id: blueprintId,
        topic_id: topicId ?? null,
        type: "quiz",
        title,
        status: "draft",
        created_by: user.id,
        config: {
          mode: "assignment",
          questionCount,
          // Allow 2 attempts so students can improve their score after reviewing
          // feedback from the first attempt.
          attemptLimit: 2,
          // "best_of_attempts" means the recorded score is the highest across all
          // attempts rather than the most recent.
          scoringPolicy: "best_of_attempts",
          // Correct answers are revealed only after the student has used all
          // attempts, preventing answer-peeking mid-quiz.
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
      // Roll back the activity row so we do not leave an orphaned draft with no questions.
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
      provider: usedProvider,
      model: usedModel,
      status: "success",
      latencyMs: usedLatencyMs ?? Date.now() - start,
      promptTokens: usedUsage?.promptTokens,
      completionTokens: usedUsage?.completionTokens,
      totalTokens: usedUsage?.totalTokens,
    });

    redirect(`/classes/${classId}/activities/quiz/${activity.id}/edit?created=1`);
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

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
      toFriendlyQuizGenerationError(error),
    );
  }
}

/**
 * Persists edits to an existing quiz draft or published quiz.
 *
 * Questions are upserted keyed on `(activity_id, order_index)`.  After the
 * upsert, stale questions whose `order_index` is now beyond the end of the
 * updated list are deleted.
 *
 * `trimStaleQuestions` uses `order_index >= newLength` rather than deleting
 * by question ID because the teacher may have reordered, replaced, or
 * reduced the question list.  Deleting by ID would require the client to
 * track and send tombstones for removed questions; using the index boundary
 * is simpler and equally safe — `order_index` is the canonical question
 * position and is unique per activity.
 *
 * @param classId      The class that owns the quiz.
 * @param activityId   The quiz activity to update.
 * @param formData     Must contain `quiz_payload` (JSON-encoded draft payload).
 */
export async function saveQuizDraft(classId: string, activityId: string, formData: FormData) {
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

  if (activity.status !== "draft" && activity.status !== "published") {
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      "This quiz cannot be edited.",
    );
    return;
  }

  // Preserve existing config fields (e.g. attemptLimit, scoringPolicy) that are
  // not part of the draft payload to avoid silently overwriting them.
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
        // Hardcoded policies — same values used at generation time.
        // See `generateQuizDraft` for policy documentation.
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

  // --- Trim stale questions ---
  // Delete questions whose order_index is >= the new list length.
  // This handles reductions and replacements without requiring the client
  // to send explicit tombstones for removed questions (see JSDoc above).
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

/**
 * Transitions a quiz activity from `draft` to `published`, making it
 * available for assignment creation.
 *
 * Publishing is idempotent: if the activity is already published the action
 * redirects as though it just succeeded rather than returning an error.
 *
 * At least one question must exist before publishing to prevent empty quizzes
 * from being assigned to students.
 *
 * @param classId      The class that owns the quiz.
 * @param activityId   The draft quiz activity to publish.
 */
export async function publishQuizActivity(classId: string, activityId: string) {
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

  // Idempotent: already published — treat as success so re-submissions don't error.
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
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      questionsError.message,
    );
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
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      publishError.message,
    );
    return;
  }

  redirect(`/classes/${classId}/activities/quiz/${activityId}/edit?published=1`);
}

/**
 * Creates a whole-class assignment for a published quiz activity.
 *
 * The activity must already be in `published` status — teachers must publish
 * before assigning so students cannot be assigned a quiz that is still being
 * edited.
 *
 * @param classId      The class to assign the quiz to.
 * @param activityId   The published quiz activity.
 * @param formData     Must contain optionally `due_at` (ISO-8601 datetime string).
 */
export async function createQuizAssignment(
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
    // Re-throw redirect errors - they are expected and should propagate
    if (isRedirectError(error)) {
      throw error;
    }
    redirectWithError(
      `/classes/${classId}/activities/quiz/${activityId}/edit`,
      error instanceof Error ? error.message : "Failed to create assignment.",
    );
  }
}

/**
 * Accepts and scores a student's quiz attempt, then persists it as a
 * submission row.
 *
 * Attempt-limit enforcement:
 *   The attempt limit is read from `activity.config.attemptLimit` (default 2).
 *   Prior submissions are counted **before** the insert.  If the student has
 *   already used all attempts they are blocked with a redirect error.  This
 *   check is re-run **after** a `23505` duplicate-key error to distinguish
 *   the "genuinely out of attempts" case from a transient double-submit.
 *
 * Race-condition handling (code 23505):
 *   Two simultaneous form submissions (e.g. double-click or two open tabs) can
 *   both pass the pre-insert attempt-limit check and race to insert.  PostgREST
 *   returns error code `23505` (PostgreSQL unique violation) for the second
 *   insert.  When that happens, the count is re-fetched: if the student is now
 *   at the limit the "no attempts remaining" error is shown; otherwise a
 *   "already recorded" message is shown so the student reviews their existing
 *   attempt rather than re-submitting.
 *
 * Scoring:
 *   `gradeQuizAttempt` computes `scoreRaw` (correct answers), `scorePercent`
 *   (0–100), and `maxPoints` (total questions).  The `score` column on the
 *   `submissions` row stores `scorePercent` so it can be compared across
 *   attempts.
 *
 * Best-score computation:
 *   `getBestScorePercent` scans the student's prior submissions (before this
 *   attempt) and returns the highest `scorePercent`.  The current attempt's
 *   score is passed as a candidate so the function returns the overall maximum
 *   across all attempts including this one.
 *
 * @param classId        The class owning the assignment.
 * @param assignmentId   The assignment being attempted.
 * @param formData       Must contain `answers` (JSON-encoded answer array).
 */
export async function submitQuizAttempt(classId: string, assignmentId: string, formData: FormData) {
  // --- Auth and class membership ---
  const { supabase, user, authError } = await requireAuthenticatedUser({ accountType: "student" });
  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirectWithError(`/classes/${classId}/assignments/${assignmentId}/quiz`, authError);
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

  // --- Attempt-limit check ---
  // Fall back to 2 if the config field is missing (defensive default).
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

  // Block the student before fetching questions to avoid unnecessary DB work.
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

  // --- Answer validation ---
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
  // Reject partial submissions — every question must have exactly one answer.
  if (answerQuestionIds.length !== questionIds.length) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      "Answer all questions before submitting.",
    );
    return;
  }

  // Reject duplicate question IDs in the submitted answers payload.
  if (new Set(answerQuestionIds).size !== answerQuestionIds.length) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/quiz`,
      "Each question can only be answered once.",
    );
    return;
  }

  // --- Scoring ---
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

  // --- Persistence ---
  // Attempt number is 1-based and derived from prior submission count so it
  // is always in sync even if a previous attempt was recorded concurrently.
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
    // 23505 = PostgreSQL unique-violation.  Two simultaneous submits (double-click
    // or two open tabs) can both pass the pre-insert attempt-limit check and race
    // to insert.  Re-fetch the submission count to determine which message to show:
    //  - At limit → "no attempts remaining" (the race was for the final slot).
    //  - Under limit → "already recorded" (a true duplicate of the same attempt).
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
    // Transition recipient status: "in_progress" while attempts remain,
    // "submitted" once the final attempt is used.
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

  // Best-score aggregation: takes the maximum scorePercent across all attempts
  // (prior + this one).  Displayed on the results page so the student always
  // sees their personal best rather than just the most recent attempt's score.
  const bestScore = getBestScorePercent(priorSubmissions, graded.scorePercent);
  redirect(`/classes/${classId}/assignments/${assignmentId}/quiz?submitted=1&best=${bestScore}`);
}

/**
 * Records a teacher's review of a student's quiz submission, optionally
 * overriding the auto-graded score and attaching feedback.
 *
 * At least one of `score`, `comment`, or a non-empty `highlights` array is
 * required — submitting an empty review form is rejected.
 *
 * Score updates and feedback insertion are intentionally separate operations
 * so that a score change does not require re-writing the feedback record and
 * vice versa.
 *
 * @param classId        The class owning the assignment.
 * @param submissionId   The submission to review.
 * @param formData       May contain `score` (0–100), `comment`, `highlights`
 *                       (JSON array), and must contain `assignment_id`.
 */
export async function reviewQuizSubmission(
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

  // Require at least some review content so empty submissions cannot mark a
  // student's work as reviewed without any actual feedback.
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
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      "Submission not found.",
    );
    return;
  }

  // Score override is optional — skip the update when the teacher did not
  // change the auto-graded score.
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
