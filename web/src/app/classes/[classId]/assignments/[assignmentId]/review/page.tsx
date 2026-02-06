import Link from "next/link";
import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { reviewChatSubmission } from "@/app/classes/[classId]/chat/actions";
import { reviewQuizSubmission } from "@/app/classes/[classId]/quiz/actions";
import type { ChatTurn } from "@/lib/chat/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = {
  created?: string;
  saved?: string;
  error?: string;
  page?: string;
};

type ParsedChatSubmission = {
  transcript: ChatTurn[];
  reflection: string;
};

type ParsedQuizSubmission = {
  attemptNumber: number;
  scorePercent: number;
  answers: Array<{ questionId: string; selectedChoice: string }>;
  submittedAt: string;
};

function parseChatSubmissionContent(content: unknown): ParsedChatSubmission {
  if (!content || typeof content !== "object") {
    return { transcript: [], reflection: "" };
  }

  const transcript = Array.isArray((content as { transcript?: unknown }).transcript)
    ? ((content as { transcript: unknown[] }).transcript
        .filter((turn): turn is ChatTurn => {
          if (!turn || typeof turn !== "object") {
            return false;
          }
          const role = (turn as { role?: unknown }).role;
          const message = (turn as { message?: unknown }).message;
          const createdAt = (turn as { createdAt?: unknown }).createdAt;
          return (
            (role === "student" || role === "assistant") &&
            typeof message === "string" &&
            typeof createdAt === "string"
          );
        })
        .map((turn) => ({
          role: turn.role,
          message: turn.message,
          createdAt: turn.createdAt,
          citations: Array.isArray(turn.citations) ? turn.citations : undefined,
        })) as ChatTurn[])
    : [];

  const reflectionRaw = (content as { reflection?: unknown }).reflection;
  return {
    transcript,
    reflection: typeof reflectionRaw === "string" ? reflectionRaw : "",
  };
}

function parseQuizSubmissionContent(content: unknown): ParsedQuizSubmission {
  if (!content || typeof content !== "object") {
    return {
      attemptNumber: 1,
      scorePercent: 0,
      answers: [],
      submittedAt: "",
    };
  }

  const attemptNumberRaw = (content as { attemptNumber?: unknown }).attemptNumber;
  const scorePercentRaw = (content as { scorePercent?: unknown }).scorePercent;
  const submittedAtRaw = (content as { submittedAt?: unknown }).submittedAt;
  const answersRaw = (content as { answers?: unknown }).answers;

  const answers = Array.isArray(answersRaw)
    ? answersRaw
        .filter(
          (answer): answer is { questionId: string; selectedChoice: string } =>
            Boolean(
              answer &&
                typeof answer === "object" &&
                typeof (answer as { questionId?: unknown }).questionId === "string" &&
                typeof (answer as { selectedChoice?: unknown }).selectedChoice === "string",
            ),
        )
        .map((answer) => ({
          questionId: answer.questionId,
          selectedChoice: answer.selectedChoice,
        }))
    : [];

  return {
    attemptNumber:
      typeof attemptNumberRaw === "number" && Number.isFinite(attemptNumberRaw)
        ? attemptNumberRaw
        : 1,
    scorePercent:
      typeof scorePercentRaw === "number" && Number.isFinite(scorePercentRaw) ? scorePercentRaw : 0,
    answers,
    submittedAt: typeof submittedAtRaw === "string" ? submittedAtRaw : "",
  };
}

export default async function AssignmentReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { classId, assignmentId } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: classRow } = await supabase
    .from("classes")
    .select("id,title,owner_id")
    .eq("id", classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id || enrollment?.role === "teacher" || enrollment?.role === "ta";
  if (!isTeacher) {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Teacher access required.")}`);
  }

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id,class_id,activity_id,due_at,created_at")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .single();

  if (!assignment) {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Assignment not found.")}`);
  }

  const { data: activity } = await supabase
    .from("activities")
    .select("id,title,type,config")
    .eq("id", assignment.activity_id)
    .eq("class_id", classId)
    .single();

  if (!activity || (activity.type !== "chat" && activity.type !== "quiz")) {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Assignment activity not found.")}`);
  }

  const requestedPage = Number(resolvedSearchParams?.page ?? "1");
  const pageSize = 20;
  const normalizedRequestedPage =
    Number.isInteger(requestedPage) && Number.isFinite(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;

  const { count: recipientCount } = await supabase
    .from("assignment_recipients")
    .select("student_id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);

  const totalRecipients = recipientCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecipients / pageSize));
  const currentPage = Math.min(normalizedRequestedPage, totalPages);
  const rangeStart = (currentPage - 1) * pageSize;
  const rangeEnd = rangeStart + pageSize - 1;

  const { data: recipients } = await supabase
    .from("assignment_recipients")
    .select("student_id,status,assigned_at")
    .eq("assignment_id", assignmentId)
    .order("assigned_at", { ascending: true })
    .range(rangeStart, rangeEnd);

  const recipientIds = recipients?.map((recipient) => recipient.student_id) ?? [];
  const { data: submissions } =
    recipientIds.length > 0
      ? await supabase
          .from("submissions")
          .select("id,assignment_id,student_id,content,score,submitted_at")
          .eq("assignment_id", assignmentId)
          .in("student_id", recipientIds)
          .order("submitted_at", { ascending: true })
      : { data: null };
  type SubmissionRow = NonNullable<typeof submissions>[number];

  const submissionIds = (submissions ?? []).map((submission) => submission.id);
  const { data: feedbackRows } =
    submissionIds.length > 0
      ? await supabase
          .from("feedback")
          .select("submission_id,content,created_at")
          .in("submission_id", submissionIds)
          .eq("source", "teacher")
          .order("created_at", { ascending: false })
      : { data: null };

  const latestFeedbackBySubmission = new Map<string, { comment: string; highlights: string[] }>();
  feedbackRows?.forEach((feedback) => {
    if (latestFeedbackBySubmission.has(feedback.submission_id)) {
      return;
    }
    const content = feedback.content as { comment?: unknown; highlights?: unknown };
    latestFeedbackBySubmission.set(feedback.submission_id, {
      comment: typeof content?.comment === "string" ? content.comment : "",
      highlights: Array.isArray(content?.highlights)
        ? content.highlights.filter((value): value is string => typeof value === "string")
        : [],
    });
  });

  const createdMessage =
    resolvedSearchParams?.created === "1"
      ? activity.type === "quiz"
        ? "Quiz assignment created and assigned to the class."
        : "Chat assignment created and assigned to the class."
      : null;
  const savedMessage =
    resolvedSearchParams?.saved === "1" ? "Feedback saved for this submission." : null;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  const buildPageHref = (page: number) => {
    const query = new URLSearchParams();
    if (page > 1) {
      query.set("page", String(page));
    }
    if (resolvedSearchParams?.created === "1") {
      query.set("created", "1");
    }
    if (resolvedSearchParams?.saved === "1") {
      query.set("saved", "1");
    }
    if (typeof resolvedSearchParams?.error === "string" && resolvedSearchParams.error.trim()) {
      query.set("error", resolvedSearchParams.error);
    }
    const serialized = query.toString();
    return `/classes/${classId}/assignments/${assignmentId}/review${serialized ? `?${serialized}` : ""}`;
  };

  const submissionByStudentId = new Map<string, SubmissionRow[]>();
  (submissions ?? []).forEach((submission) => {
    const current = submissionByStudentId.get(submission.student_id) ?? [];
    current.push(submission);
    submissionByStudentId.set(submission.student_id, current);
  });

  const quizQuestionsById = new Map<string, { question: string; answer: string; explanation: string }>();
  if (activity.type === "quiz") {
    const { data: questionRows } = await supabase
      .from("quiz_questions")
      .select("id,question,answer,explanation")
      .eq("activity_id", activity.id);

    (questionRows ?? []).forEach((question) => {
      quizQuestionsById.set(question.id, {
        question: question.question,
        answer: question.answer ?? "",
        explanation: question.explanation ?? "",
      });
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: activity.type === "quiz" ? "Quiz Assignment Review" : "Chat Assignment Review" },
        ]}
      />

      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-slate-400">Teacher Review</p>
          <h1 className="text-3xl font-semibold">{activity.title}</h1>
          <p className="text-sm text-slate-400">
            {assignment.due_at ? `Due ${new Date(assignment.due_at).toLocaleString()}` : "No due date"}
          </p>
        </header>

        {createdMessage ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {createdMessage}
          </div>
        ) : null}
        {savedMessage ? (
          <div className="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {savedMessage}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {totalRecipients > 0 ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 text-sm text-slate-300">
            <p>
              Showing {rangeStart + 1}-{Math.min(rangeStart + (recipients?.length ?? 0), totalRecipients)} of{" "}
              {totalRecipients} students
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <Link
                    href={buildPageHref(currentPage - 1)}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-500">
                    Previous
                  </span>
                )}
                <span className="text-xs text-slate-400">
                  Page {currentPage} of {totalPages}
                </span>
                {currentPage < totalPages ? (
                  <Link
                    href={buildPageHref(currentPage + 1)}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-500">
                    Next
                  </span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-6">
          {(recipients ?? []).length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/40 p-6 text-sm text-slate-400">
              No students are currently assigned to this activity.
            </div>
          ) : (
            recipients!.map((recipient) => {
              const attempts = submissionByStudentId.get(recipient.student_id) ?? [];
              const latestSubmission = attempts.length > 0 ? attempts[attempts.length - 1] : null;
              const bestScore =
                attempts.length > 0
                  ? Math.max(
                      ...attempts
                        .map((attempt) => attempt.score)
                        .filter((score): score is number => typeof score === "number"),
                      0,
                    )
                  : null;

              return (
                <section
                  key={`${recipient.student_id}-${recipient.assigned_at}`}
                  className="rounded-3xl border border-white/10 bg-slate-900/70 p-6"
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Student</p>
                      <p className="text-sm font-semibold text-slate-200">{recipient.student_id}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                      {recipient.status}
                    </span>
                  </div>

                  {activity.type === "chat" ? (
                    !latestSubmission ? (
                      <p className="text-sm text-slate-400">No submission yet.</p>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Transcript</p>
                          {parseChatSubmissionContent(latestSubmission.content).transcript.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-400">No transcript saved.</p>
                          ) : (
                            <div className="mt-3 space-y-3">
                              {parseChatSubmissionContent(latestSubmission.content).transcript.map((turn, index) => (
                                <div
                                  key={`${latestSubmission.id}-${turn.role}-${turn.createdAt}-${index}`}
                                  className="rounded-xl border border-white/10 bg-slate-900/70 p-3"
                                >
                                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                    {turn.role === "student" ? "Student" : "AI Tutor"}
                                  </p>
                                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">{turn.message}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reflection</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">
                            {parseChatSubmissionContent(latestSubmission.content).reflection || "No reflection submitted."}
                          </p>
                        </div>

                        <form
                          action={reviewChatSubmission.bind(null, classId, latestSubmission.id)}
                          className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4"
                        >
                          <input type="hidden" name="assignment_id" value={assignmentId} />

                          <div className="space-y-2">
                            <label className="text-sm text-slate-300" htmlFor={`score-${latestSubmission.id}`}>
                              Score (0-100)
                            </label>
                            <input
                              id={`score-${latestSubmission.id}`}
                              type="number"
                              name="score"
                              min={0}
                              max={100}
                              defaultValue={latestSubmission.score?.toString() ?? ""}
                              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm text-slate-300" htmlFor={`comment-${latestSubmission.id}`}>
                              Comment
                            </label>
                            <textarea
                              id={`comment-${latestSubmission.id}`}
                              name="comment"
                              rows={3}
                              defaultValue={latestFeedbackBySubmission.get(latestSubmission.id)?.comment ?? ""}
                              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm text-slate-300" htmlFor={`highlights-${latestSubmission.id}`}>
                              Highlights (one per line)
                            </label>
                            <textarea
                              id={`highlights-${latestSubmission.id}`}
                              name="highlights"
                              rows={3}
                              defaultValue={
                                (latestFeedbackBySubmission.get(latestSubmission.id)?.highlights ?? []).join("\n")
                              }
                              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                            />
                          </div>

                          <PendingSubmitButton
                            label="Save Review"
                            pendingLabel="Saving..."
                            className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
                          />
                        </form>
                      </div>
                    )
                  ) : attempts.length === 0 ? (
                    <p className="text-sm text-slate-400">No submission yet.</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-300">
                        <p>Attempts submitted: {attempts.length}</p>
                        <p>Best score: {bestScore === null ? "N/A" : `${bestScore}%`}</p>
                      </div>

                      {attempts.map((attempt) => {
                        const parsed = parseQuizSubmissionContent(attempt.content);
                        const feedback = latestFeedbackBySubmission.get(attempt.id);

                        return (
                          <div
                            key={attempt.id}
                            className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"
                          >
                            <p className="text-sm font-semibold text-slate-100">
                              Attempt {parsed.attemptNumber} · Score: {attempt.score ?? parsed.scorePercent}%
                            </p>
                            <p className="text-xs text-slate-500">
                              Submitted {new Date(attempt.submitted_at).toLocaleString()}
                            </p>

                            <div className="mt-3 space-y-3">
                              {parsed.answers.map((answer, answerIndex) => {
                                const question = quizQuestionsById.get(answer.questionId);
                                const isCorrect = question ? answer.selectedChoice === question.answer : false;
                                return (
                                  <div
                                    key={`${attempt.id}-${answer.questionId}-${answerIndex}`}
                                    className="rounded-xl border border-white/10 bg-slate-900/70 p-3"
                                  >
                                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                      Question {answerIndex + 1}
                                    </p>
                                    <p className="mt-1 text-sm text-slate-200">{question?.question ?? "Unknown question"}</p>
                                    <p className="mt-2 text-sm text-slate-300">Selected: {answer.selectedChoice}</p>
                                    <p className={`text-sm ${isCorrect ? "text-emerald-300" : "text-rose-300"}`}>
                                      Correct answer: {question?.answer ?? "Unavailable"}
                                    </p>
                                    {question?.explanation ? (
                                      <p className="mt-1 text-xs text-slate-400">{question.explanation}</p>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>

                            <form
                              action={reviewQuizSubmission.bind(null, classId, attempt.id)}
                              className="mt-4 space-y-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4"
                            >
                              <input type="hidden" name="assignment_id" value={assignmentId} />

                              <div className="space-y-2">
                                <label className="text-sm text-slate-300" htmlFor={`quiz-score-${attempt.id}`}>
                                  Override score (0-100)
                                </label>
                                <input
                                  id={`quiz-score-${attempt.id}`}
                                  type="number"
                                  name="score"
                                  min={0}
                                  max={100}
                                  defaultValue={attempt.score?.toString() ?? ""}
                                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                                />
                              </div>

                              <div className="space-y-2">
                                <label className="text-sm text-slate-300" htmlFor={`quiz-comment-${attempt.id}`}>
                                  Comment
                                </label>
                                <textarea
                                  id={`quiz-comment-${attempt.id}`}
                                  name="comment"
                                  rows={3}
                                  defaultValue={feedback?.comment ?? ""}
                                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                                />
                              </div>

                              <div className="space-y-2">
                                <label className="text-sm text-slate-300" htmlFor={`quiz-highlights-${attempt.id}`}>
                                  Highlights (one per line)
                                </label>
                                <textarea
                                  id={`quiz-highlights-${attempt.id}`}
                                  name="highlights"
                                  rows={3}
                                  defaultValue={(feedback?.highlights ?? []).join("\n")}
                                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                                />
                              </div>

                              <PendingSubmitButton
                                label="Save Review"
                                pendingLabel="Saving..."
                                className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
                              />
                            </form>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
