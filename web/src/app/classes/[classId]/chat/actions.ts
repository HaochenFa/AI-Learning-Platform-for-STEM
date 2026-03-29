"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  createWholeClassAssignment,
  loadStudentAssignmentContext,
  requirePublishedBlueprintId,
} from "@/lib/activities/assignments";
import { getClassAccess, requireAuthenticatedUser } from "@/lib/activities/access";
import { markRecipientStatus } from "@/lib/activities/submissions";
import { generateGroundedChatResponse } from "@/lib/chat/generate";
import { generateChatCanvas } from "@/lib/ai/python-chat";
import type { CanvasHint, CanvasSpec, ChatModelResponse, ChatTurn } from "@/lib/chat/types";
import {
  buildChatAssignmentSubmissionContent,
  parseChatMessage,
  parseChatTurns,
  parseDueAt,
  parseHighlights,
  parseOptionalScore,
  parseReflection,
} from "@/lib/chat/validation";

/**
 * Discriminated union returned by server actions that produce an AI chat
 * response.  The `ok: false` branch carries a user-facing error string; the
 * `ok: true` branch carries the full model response for the client to render.
 */
type ChatActionResult =
  | {
      ok: true;
      response: ChatModelResponse;
    }
  | {
      ok: false;
      error: string;
    };

const CHAT_GENERATION_ERROR_MESSAGE = "Unable to generate a chat response right now. Please try again.";

/**
 * Generates a generative canvas layout spec for a given chat exchange.
 *
 * The canvas is an AI-driven visual layout rendered alongside the chat view to
 * surface diagrams, concept maps, or structured summaries for the student's
 * current question and the AI's answer.  The `hint` tells the backend which
 * canvas type to generate (e.g. concept map, step-by-step).
 *
 * Returns a result object rather than redirecting so the client component can
 * update the canvas pane without a full page reload.
 *
 * @param classId   The class context used to scope the canvas generation.
 * @param hint      Describes the desired canvas type and any rendering hints.
 * @param context   The student's question and the AI's answer that the canvas
 *                  should visualise.
 * @returns         `{ ok: true, spec }` on success, or `{ ok: false, error }`.
 */
export async function generateCanvasAction(
  classId: string,
  hint: CanvasHint,
  context: { studentQuestion: string; aiAnswer: string },
): Promise<{ ok: true; spec: CanvasSpec } | { ok: false; error: string }> {
  try {
    const { supabase, user } = await requireAuthenticatedUser();
    if (!user) {
      return { ok: false, error: "Please sign in." };
    }
    const role = await getClassAccess(supabase, classId, user.id);
    if (!role.found || !role.isMember) {
      return { ok: false, error: "Class access required." };
    }
    const spec = await generateChatCanvas(classId, hint, context);
    return { ok: true, spec };
  } catch (error) {
    console.error("[generateCanvasAction]", error);
    return {
      ok: false,
      error: "Canvas generation failed.",
    };
  }
}

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

function toFriendlyChatActionError(error: unknown) {
  if (!(error instanceof Error)) {
    return CHAT_GENERATION_ERROR_MESSAGE;
  }

  // Next.js internally uses NEXT_REDIRECT errors for redirect() calls; they
  // must not be swallowed and surfaced as a user-visible error string.
  if (/NEXT_REDIRECT/i.test(error.message)) {
    return CHAT_GENERATION_ERROR_MESSAGE;
  }

  return error.message;
}

/**
 * Sends a single chat message in an open-practice (unassigned) session and
 * returns the AI-generated response.
 *
 * Open-practice sessions have no assignment context — questions are answered
 * using the class's published blueprint and retrieved material context only.
 * There is no transcript persistence; the client is responsible for maintaining
 * the `transcript` form field across turns.
 *
 * @param classId    The class context for blueprint/material retrieval.
 * @param formData   Must contain `message` (the user's text) and `transcript`
 *                   (JSON-encoded `ChatTurn[]` of prior turns in this session).
 * @returns          `{ ok: true, response }` or `{ ok: false, error }`.
 */
export async function sendOpenPracticeMessage(
  classId: string,
  formData: FormData,
): Promise<ChatActionResult> {
  const { supabase, user, authError, sandboxId } = await requireAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Please sign in to use chat." };
  }
  if (authError) {
    return { ok: false, error: authError };
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isMember) {
    return { ok: false, error: "Class access required." };
  }

  let message: string;
  let transcript: ChatTurn[];
  try {
    message = parseChatMessage(formData.get("message"));
    // `parseChatTurns` decodes the JSON-serialised chat history sent by the
    // client; the full prior transcript is passed to the AI to maintain context.
    transcript = parseChatTurns(formData.get("transcript"));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid chat payload.",
    };
  }

  try {
    const response = await generateGroundedChatResponse({
      classId,
      classTitle: role.classTitle,
      userId: user.id,
      userMessage: message,
      transcript,
      sandboxId,
      purpose: "student_chat_open_v2",
    });

    return {
      ok: true,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      error: toFriendlyChatActionError(error),
    };
  }
}

/**
 * Creates a new chat assignment activity and immediately assigns it to the
 * whole class.
 *
 * Chat assignments are created in `published` status directly (no draft phase)
 * because the assignment instructions are the only editable field and can be
 * supplied in one step.
 *
 * Requires a published blueprint to exist for the class — the assignment is
 * anchored to the blueprint so the AI's responses are scoped to approved course
 * materials.
 *
 * @param classId    The class to create the assignment in.
 * @param formData   Must contain `title`, `instructions`, and optionally `due_at`.
 */
export async function createChatAssignment(classId: string, formData: FormData) {
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
      // Chat assignments go live immediately; no draft review step is needed
      // because the teacher supplies all content upfront (title + instructions).
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
    // Re-throw redirect errors - they are expected and should propagate
    if (isRedirectError(error)) {
      throw error;
    }
    redirectWithError(
      `/classes/${classId}/activities/chat/new`,
      error instanceof Error ? error.message : "Failed to create assignment.",
    );
    return;
  }

  redirect(`/classes/${classId}/assignments/${assignmentId}/review?created=1`);
}

/**
 * Sends a single chat message within a graded assignment session and returns
 * the AI-generated response.
 *
 * Unlike `sendOpenPracticeMessage`, this action loads the assignment context so
 * the AI can be given the teacher's specific instructions for the assignment
 * (`assignmentInstructions`).  The transcript is provided by the client and is
 * not persisted server-side between turns — persistence happens only on final
 * submission via `submitChatAssignment`.
 *
 * The transcript format is a JSON-encoded `ChatTurn[]` where each turn has
 * `role: "user" | "assistant"` and `content: string`.  The client is
 * responsible for appending the returned `response` to its local transcript
 * before the next call.
 *
 * @param classId        The class owning the assignment.
 * @param assignmentId   The specific assignment the student is working on.
 * @param formData       Must contain `message` and `transcript` (JSON-encoded
 *                       `ChatTurn[]` of turns so far in this session).
 * @returns              `{ ok: true, response }` or `{ ok: false, error }`.
 */
export async function sendAssignmentMessage(
  classId: string,
  assignmentId: string,
  formData: FormData,
): Promise<ChatActionResult> {
  // --- Auth and class membership ---
  const { supabase, user, authError, sandboxId } = await requireAuthenticatedUser({ accountType: "student" });

  if (!user) {
    return { ok: false, error: "Please sign in to continue." };
  }
  if (authError) {
    return { ok: false, error: authError };
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isMember) {
    return { ok: false, error: "Class access required." };
  }

  // --- Message and transcript parsing ---
  let message: string;
  let transcript: ChatTurn[];
  try {
    message = parseChatMessage(formData.get("message"));
    // `parseChatTurns` decodes the client-maintained JSON transcript.
    // Each element is `{ role: "user"|"assistant", content: string }`.
    transcript = parseChatTurns(formData.get("transcript"));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid chat payload.",
    };
  }

  // --- Thread resolution ---
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

  // Extract assignment-specific instructions from the activity config; null
  // if the field is absent so the AI falls back to generic grounding.
  const assignmentInstructions =
    typeof assignmentContext.activity.config.instructions === "string"
      ? assignmentContext.activity.config.instructions
      : null;

  // --- AI call ---
  try {
    const response = await generateGroundedChatResponse({
      classId,
      classTitle: role.classTitle,
      userId: user.id,
      userMessage: message,
      transcript,
      sandboxId,
      assignmentInstructions,
      purpose: "student_chat_assignment_v2",
    });

    return {
      ok: true,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      error: toFriendlyChatActionError(error),
    };
  }
}

/**
 * Finalises a student's chat assignment by persisting the full conversation
 * transcript and reflection as a submission row.
 *
 * Upsert-vs-insert logic:
 *   Chat assignments allow the student to re-submit (e.g. to continue the
 *   conversation and update their reflection before the due date).  To support
 *   this, the action first queries for an existing submission for this student
 *   and assignment:
 *    - If a row **exists**, it is **updated** (`UPDATE`) with the new transcript
 *      and a refreshed `submitted_at` timestamp.  This preserves the original
 *      submission row ID so any teacher feedback linked to it remains valid.
 *    - If **no row exists**, a new row is **inserted** (`INSERT`).
 *   This manual check-then-write is used instead of a DB upsert because a
 *   unique constraint on `(assignment_id, student_id)` is not enforced —
 *   multiple quiz attempts for the same assignment are allowed via separate
 *   rows; only chat submissions follow the one-row-per-student pattern.
 *
 * @param classId        The class owning the assignment.
 * @param assignmentId   The assignment being submitted.
 * @param formData       Must contain `transcript` (JSON-encoded `ChatTurn[]`)
 *                       and `reflection` (the student's written reflection text).
 */
export async function submitChatAssignment(
  classId: string,
  assignmentId: string,
  formData: FormData,
) {
  // --- Auth ---
  const { supabase, user, authError } = await requireAuthenticatedUser({ accountType: "student" });
  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirectWithError(`/classes/${classId}/assignments/${assignmentId}/chat`, authError);
    return;
  }

  let transcript: ChatTurn[];
  let reflection: string;
  try {
    // `parseChatTurns` validates and decodes the JSON-serialised conversation
    // history; `parseReflection` validates and trims the reflection text.
    transcript = parseChatTurns(formData.get("transcript"));
    reflection = parseReflection(formData.get("reflection"));
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/chat`,
      error instanceof Error ? error.message : "Invalid submission payload.",
    );
    return;
  }

  // Require at least one exchange so the student cannot submit a blank session.
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

  // --- Upsert logic ---
  // Look up the most recent existing submission for this student + assignment.
  // `.maybeSingle()` returns null (not an error) when no row exists.
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
    // Re-submit path: update the existing row to preserve any teacher feedback
    // already linked to this submission ID.
    const { error: updateError } = await supabase
      .from("submissions")
      .update({
        content,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", existingSubmission.id);

    if (updateError) {
      redirectWithError(
        `/classes/${classId}/assignments/${assignmentId}/chat`,
        updateError.message,
      );
      return;
    }
  } else {
    // First submission path: insert a new row.
    const { error: insertError } = await supabase.from("submissions").insert({
      assignment_id: assignmentId,
      student_id: user.id,
      content,
      submitted_at: new Date().toISOString(),
    });

    if (insertError) {
      redirectWithError(
        `/classes/${classId}/assignments/${assignmentId}/chat`,
        insertError.message,
      );
      return;
    }
  }

  // --- Status update ---
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

/**
 * Records a teacher's review of a student's chat submission, attaching a
 * score and/or feedback.
 *
 * Permission check sequence:
 *   1. **Authenticated teacher** — `requireAuthenticatedUser({ accountType: "teacher" })`
 *      ensures the caller has an active session and the teacher role.
 *   2. **Class teacher** — `getClassAccess` verifies the teacher is a member
 *      of *this specific class* (not just any class), preventing cross-class
 *      review of other teachers' assignments.
 *   3. **Assignment belongs to class** — the `assignments` table is queried
 *      with both `id` and `class_id` filters, so a teacher cannot review a
 *      submission by forging an `assignmentId` from another class.
 *   4. **Submission belongs to assignment** — the `submissions` table is
 *      queried with both `id` and `assignment_id`, ensuring the `submissionId`
 *      param actually corresponds to the claimed assignment.
 *
 * Unlike `reviewQuizSubmission`, a comment or highlight is **always** required
 * (score alone is not enough) because chat submissions involve qualitative
 * assessment that benefits from written feedback.
 *
 * @param classId        The class owning the assignment.
 * @param submissionId   The submission to review.
 * @param formData       May contain `score` (0–100) and must contain at least
 *                       one of `comment` or `highlights` (JSON array).
 *                       Must also contain `assignment_id`.
 */
export async function reviewChatSubmission(
  classId: string,
  submissionId: string,
  formData: FormData,
) {
  // --- Auth: authenticated teacher ---
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

  // --- Auth: class-level teacher access ---
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

  // At least a comment or highlight is required — score-only reviews are not
  // accepted for chat assignments (see JSDoc above).
  if (!comment && highlights.length === 0) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      "Provide a comment or at least one highlight.",
    );
    return;
  }

  // --- Auth: submission belongs to assignment ---
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

  // --- Auth: assignment belongs to class ---
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id,class_id")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .single();

  if (assignmentError || !assignment) {
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      "Assignment not found.",
    );
    return;
  }

  // Score is always written (even when null) to allow clearing a previously
  // set score if the teacher changes their mind.
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
    redirectWithError(
      `/classes/${classId}/assignments/${assignmentId}/review`,
      feedbackError.message,
    );
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
