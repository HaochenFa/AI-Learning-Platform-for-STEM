import Link from "next/link";
import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { reviewChatSubmission } from "@/app/classes/[classId]/chat/actions";
import { reviewQuizSubmission } from "@/app/classes/[classId]/quiz/actions";
import { reviewFlashcardsSubmission } from "@/app/classes/[classId]/flashcards/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocalizedDateTimeText } from "@/components/ui/localized-date-time";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Textarea } from "@/components/ui/textarea";
import type { ChatTurn } from "@/lib/chat/types";
import { requireGuestOrVerifiedUser } from "@/lib/auth/session";

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

type ParsedFlashcardsSubmission = {
  sessionNumber: number;
  cardsReviewed: number;
  knownCount: number;
  reviewCount: number;
  scorePercent: number;
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
        .filter((answer): answer is { questionId: string; selectedChoice: string } =>
          Boolean(
            answer &&
            typeof answer === "object" &&
            typeof (answer as { questionId?: unknown }).questionId === "string" &&
            typeof (answer as { selectedChoice?: unknown }).selectedChoice === "string"
          )
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

function parseFlashcardsSubmissionContent(content: unknown): ParsedFlashcardsSubmission {
  if (!content || typeof content !== "object") {
    return {
      sessionNumber: 1,
      cardsReviewed: 0,
      knownCount: 0,
      reviewCount: 0,
      scorePercent: 0,
      submittedAt: "",
    };
  }

  const sessionNumberRaw = (content as { sessionNumber?: unknown }).sessionNumber;
  const cardsReviewedRaw = (content as { cardsReviewed?: unknown }).cardsReviewed;
  const knownCountRaw = (content as { knownCount?: unknown }).knownCount;
  const reviewCountRaw = (content as { reviewCount?: unknown }).reviewCount;
  const scorePercentRaw = (content as { scorePercent?: unknown }).scorePercent;
  const submittedAtRaw = (content as { submittedAt?: unknown }).submittedAt;

  return {
    sessionNumber:
      typeof sessionNumberRaw === "number" && Number.isFinite(sessionNumberRaw)
        ? sessionNumberRaw
        : 1,
    cardsReviewed:
      typeof cardsReviewedRaw === "number" && Number.isFinite(cardsReviewedRaw)
        ? cardsReviewedRaw
        : 0,
    knownCount:
      typeof knownCountRaw === "number" && Number.isFinite(knownCountRaw) ? knownCountRaw : 0,
    reviewCount:
      typeof reviewCountRaw === "number" && Number.isFinite(reviewCountRaw) ? reviewCountRaw : 0,
    scorePercent:
      typeof scorePercentRaw === "number" && Number.isFinite(scorePercentRaw) ? scorePercentRaw : 0,
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
  const { supabase, user } = await requireGuestOrVerifiedUser({ accountType: "teacher" });

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

  if (
    !activity ||
    (activity.type !== "chat" && activity.type !== "quiz" && activity.type !== "flashcards")
  ) {
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
        : activity.type === "flashcards"
          ? "Flashcards assignment created and assigned to the class."
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

  const quizQuestionsById = new Map<
    string,
    { question: string; answer: string; explanation: string }
  >();
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
    <div className="min-h-screen surface-page text-ui-primary">
      <AuthHeader
        activeNav="dashboard"
        accountType="teacher"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          {
            label:
              activity.type === "quiz"
                ? "Quiz Assignment Review"
                : activity.type === "flashcards"
                  ? "Flashcards Assignment Review"
                  : "Chat Assignment Review",
          },
        ]}
      />

      <div className="mx-auto w-full max-w-6xl px-6 py-16 page-enter">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Teacher Review</p>
          <h1 className="editorial-title mt-2 text-4xl text-ui-primary">{activity.title}</h1>
          <p className="mt-1.5 text-sm text-ui-muted">
            {assignment.due_at ? (
              <LocalizedDateTimeText value={assignment.due_at} prefix="Due " />
            ) : (
              "No due date"
            )}
          </p>
        </header>

        {(activity.type === "quiz" || activity.type === "flashcards") ? (
          <Card className="mb-6 rounded-2xl">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">Activity Content</p>
                <p className="text-sm text-ui-subtle">
                  Review or edit the {activity.type === "quiz" ? "quiz questions" : "flashcard content"} for this assignment.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/classes/${classId}/activities/${activity.type}/${activity.id}/edit`}>
                  View &amp; Edit Content
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {createdMessage ? (
          <Alert variant="accent" className="mb-6">
            <AlertTitle>Assignment created</AlertTitle>
            <AlertDescription>{createdMessage}</AlertDescription>
          </Alert>
        ) : null}
        {savedMessage ? (
          <Alert variant="success" className="mb-6">
            <AlertTitle>Feedback saved</AlertTitle>
            <AlertDescription>{savedMessage}</AlertDescription>
          </Alert>
        ) : null}
        {errorMessage ? (
          <TransientFeedbackAlert
            variant="error"
            title="Unable to complete action"
            message={errorMessage}
            className="mb-6"
          />
        ) : null}

        {totalRecipients > 0 ? (
          <Card className="mb-6 rounded-2xl">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-ui-muted">
              <p>
                Showing {rangeStart + 1}-
                {Math.min(rangeStart + (recipients?.length ?? 0), totalRecipients)} of{" "}
                {totalRecipients} students
              </p>
              {totalPages > 1 ? (
                <div className="flex items-center gap-2">
                  {currentPage > 1 ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={buildPageHref(currentPage - 1)}>Previous</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled>
                      Previous
                    </Button>
                  )}
                  <span className="text-xs text-ui-muted">
                    Page {currentPage} of {totalPages}
                  </span>
                  {currentPage < totalPages ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={buildPageHref(currentPage + 1)}>Next</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled>
                      Next
                    </Button>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <div className="space-y-6">
          {(recipients ?? []).length === 0 ? (
            <Card className="rounded-3xl border-dashed bg-[var(--surface-muted)]">
              <CardContent className="p-6 text-sm text-ui-muted">
                No students are currently assigned to this activity.
              </CardContent>
            </Card>
          ) : (
            recipients!.map((recipient) => {
              const attempts = submissionByStudentId.get(recipient.student_id) ?? [];
              const latestSubmission = attempts.length > 0 ? attempts[attempts.length - 1] : null;
              const parsedFlashcardsSubmission = latestSubmission
                ? parseFlashcardsSubmissionContent(latestSubmission.content)
                : null;
              const bestScore =
                attempts.length > 0
                  ? Math.max(
                      ...attempts
                        .map((attempt) => attempt.score)
                        .filter((score): score is number => typeof score === "number"),
                      0
                    )
                  : null;

              return (
                <Card key={`${recipient.student_id}-${recipient.assigned_at}`} className="rounded-3xl">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">Student</p>
                        <CardTitle className="text-sm font-semibold text-ui-subtle">
                          {recipient.student_id}
                        </CardTitle>
                      </div>
                      <Badge variant="outline">{recipient.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-2">

                  {activity.type === "chat" ? (
                    !latestSubmission ? (
                      <p className="text-sm text-ui-muted">No submission yet.</p>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-default bg-[var(--surface-muted)] p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
                            Transcript
                          </p>
                          {parseChatSubmissionContent(latestSubmission.content).transcript
                            .length === 0 ? (
                            <p className="mt-2 text-sm text-ui-muted">No transcript saved.</p>
                          ) : (
                            <div className="mt-3 space-y-3">
                              {parseChatSubmissionContent(latestSubmission.content).transcript.map(
                                (turn, index) => (
                                  <div
                                    key={`${latestSubmission.id}-${turn.role}-${turn.createdAt}-${index}`}
                                    className="rounded-xl border border-default bg-[var(--surface-card,white)] p-3"
                                  >
                                    <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
                                      {turn.role === "student" ? "Student" : "AI Tutor"}
                                    </p>
                                    <p className="mt-2 whitespace-pre-wrap text-sm text-ui-primary">
                                      {turn.message}
                                    </p>
                                  </div>
                                )
                              )}
                            </div>
                          )}
                        </div>

                        <div className="rounded-2xl border border-default bg-[var(--surface-muted)] p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
                            Reflection
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-ui-primary">
                            {parseChatSubmissionContent(latestSubmission.content).reflection ||
                              "No reflection submitted."}
                          </p>
                        </div>

                        <form
                          action={reviewChatSubmission.bind(null, classId, latestSubmission.id)}
                          className="space-y-4 rounded-2xl border border-default bg-[var(--surface-muted)] p-4"
                        >
                          <input type="hidden" name="assignment_id" value={assignmentId} />

                          <div className="space-y-2">
                            <Label htmlFor={`score-${latestSubmission.id}`}>Score (0-100)</Label>
                            <Input
                              id={`score-${latestSubmission.id}`}
                              type="number"
                              name="score"
                              min={0}
                              max={100}
                              defaultValue={latestSubmission.score?.toString() ?? ""}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`comment-${latestSubmission.id}`}>Comment</Label>
                            <Textarea
                              id={`comment-${latestSubmission.id}`}
                              name="comment"
                              rows={3}
                              defaultValue={
                                latestFeedbackBySubmission.get(latestSubmission.id)?.comment ?? ""
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`highlights-${latestSubmission.id}`}>
                              Highlights (one per line)
                            </Label>
                            <Textarea
                              id={`highlights-${latestSubmission.id}`}
                              name="highlights"
                              rows={3}
                              defaultValue={(
                                latestFeedbackBySubmission.get(latestSubmission.id)?.highlights ??
                                []
                              ).join("\n")}
                            />
                          </div>

                          <PendingSubmitButton
                            label="Save Review"
                            pendingLabel="Saving..."
                            variant="warm"
                          />
                        </form>
                      </div>
                    )
                  ) : attempts.length === 0 ? (
                    <p className="text-sm text-ui-muted">No submission yet.</p>
                  ) : activity.type === "quiz" ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-default bg-[var(--surface-muted)] p-4 text-sm text-ui-muted">
                        <p>Attempts submitted: {attempts.length}</p>
                        <p>Best score: {bestScore === null ? "N/A" : `${bestScore}%`}</p>
                      </div>

                      {attempts.map((attempt) => {
                        const parsed = parseQuizSubmissionContent(attempt.content);
                        const feedback = latestFeedbackBySubmission.get(attempt.id);

                        return (
                          <div
                            key={attempt.id}
                            className="rounded-2xl border border-default bg-[var(--surface-muted)] p-4"
                          >
                            <p className="text-sm font-semibold text-ui-primary">
                              Attempt {parsed.attemptNumber} · Score:{" "}
                              {attempt.score ?? parsed.scorePercent}%
                            </p>
                            <p className="text-xs text-ui-muted">
                              Submitted{" "}
                              <LocalizedDateTimeText value={attempt.submitted_at} />
                            </p>

                            <div className="mt-3 space-y-3">
                              {parsed.answers.map((answer, answerIndex) => {
                                const question = quizQuestionsById.get(answer.questionId);
                                const isCorrect = question
                                  ? answer.selectedChoice === question.answer
                                  : false;
                                return (
                                  <div
                                    key={`${attempt.id}-${answer.questionId}-${answerIndex}`}
                                    className="rounded-xl border border-default bg-[var(--surface-card,white)] p-3"
                                  >
                                    <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
                                      Question {answerIndex + 1}
                                    </p>
                                    <p className="mt-1 text-sm text-ui-subtle">
                                      {question?.question ?? "Unknown question"}
                                    </p>
                                    <p className="mt-2 text-sm text-ui-muted">
                                      Selected: {answer.selectedChoice}
                                    </p>
                                    <p
                                      className={`text-sm ${isCorrect ? "text-[var(--status-success-fg)]" : "text-[var(--status-error-fg)]"}`}
                                    >
                                      Correct answer: {question?.answer ?? "Unavailable"}
                                    </p>
                                    {question?.explanation ? (
                                      <p className="mt-1 text-xs text-ui-muted">
                                        {question.explanation}
                                      </p>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>

                            <form
                              action={reviewQuizSubmission.bind(null, classId, attempt.id)}
                              className="mt-4 space-y-4 rounded-2xl border border-default bg-[var(--surface-muted)] p-4"
                            >
                              <input type="hidden" name="assignment_id" value={assignmentId} />

                              <div className="space-y-2">
                                <Label htmlFor={`quiz-score-${attempt.id}`}>
                                  Override score (0-100)
                                </Label>
                                <Input
                                  id={`quiz-score-${attempt.id}`}
                                  type="number"
                                  name="score"
                                  min={0}
                                  max={100}
                                  defaultValue={attempt.score?.toString() ?? ""}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor={`quiz-comment-${attempt.id}`}>Comment</Label>
                                <Textarea
                                  id={`quiz-comment-${attempt.id}`}
                                  name="comment"
                                  rows={3}
                                  defaultValue={feedback?.comment ?? ""}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor={`quiz-highlights-${attempt.id}`}>
                                  Highlights (one per line)
                                </Label>
                                <Textarea
                                  id={`quiz-highlights-${attempt.id}`}
                                  name="highlights"
                                  rows={3}
                                  defaultValue={(feedback?.highlights ?? []).join("\n")}
                                />
                              </div>

                              <PendingSubmitButton
                                label="Save Review"
                                pendingLabel="Saving..."
                                variant="warm"
                              />
                            </form>
                          </div>
                        );
                      })}
                    </div>
                  ) : !latestSubmission ? (
                    <p className="text-sm text-ui-muted">No submission yet.</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-default bg-[var(--surface-muted)] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
                          Session Summary
                        </p>
                        <div className="mt-3 space-y-2 text-sm text-ui-subtle">
                          <p>Session {parsedFlashcardsSubmission?.sessionNumber ?? 1}</p>
                          <p>Cards reviewed: {parsedFlashcardsSubmission?.cardsReviewed ?? 0}</p>
                          <p>
                            Known: {parsedFlashcardsSubmission?.knownCount ?? 0} · Needs review:{" "}
                            {parsedFlashcardsSubmission?.reviewCount ?? 0}
                          </p>
                          <p>Score: {parsedFlashcardsSubmission?.scorePercent ?? 0}%</p>
                        </div>
                      </div>

                      <form
                        action={reviewFlashcardsSubmission.bind(null, classId, latestSubmission.id)}
                        className="space-y-4 rounded-2xl border border-default bg-[var(--surface-muted)] p-4"
                      >
                        <div className="space-y-2">
                          <Label htmlFor={`score-${latestSubmission.id}`}>Score (0-100)</Label>
                          <Input
                            id={`score-${latestSubmission.id}`}
                            type="number"
                            name="score"
                            min={0}
                            max={100}
                            defaultValue={latestSubmission.score?.toString() ?? ""}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`comment-${latestSubmission.id}`}>Comment</Label>
                          <Textarea
                            id={`comment-${latestSubmission.id}`}
                            name="comment"
                            rows={3}
                            defaultValue={
                              latestFeedbackBySubmission.get(latestSubmission.id)?.comment ?? ""
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`highlights-${latestSubmission.id}`}>
                            Highlights (one per line)
                          </Label>
                          <Textarea
                            id={`highlights-${latestSubmission.id}`}
                            name="highlights"
                            rows={3}
                            defaultValue={(
                              latestFeedbackBySubmission.get(latestSubmission.id)?.highlights ?? []
                            ).join("\n")}
                          />
                        </div>

                        <PendingSubmitButton
                          label="Save Feedback"
                          pendingLabel="Saving..."
                          variant="warm"
                        />
                      </form>
                    </div>
                  )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
