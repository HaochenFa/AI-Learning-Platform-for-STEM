import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import { isDueDateLocked } from "@/lib/activities/submissions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import FlashcardsAssignmentPanel from "@/app/classes/[classId]/assignments/[assignmentId]/flashcards/FlashcardsAssignmentPanel";
import TeacherFeedbackPanel from "@/app/classes/[classId]/assignments/[assignmentId]/_components/TeacherFeedbackPanel";
import { AppIcons } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LocalizedDateTimeText } from "@/components/ui/localized-date-time";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { parseTeacherFeedbackContent } from "@/lib/activities/teacher-feedback";

type SearchParams = {
  error?: string;
  submitted?: string;
  as?: string;
};

type FlashcardsSessionContent = {
  knownCount?: number;
  reviewCount?: number;
};

function extractLatestCounts(content: unknown) {
  const parsed = content as FlashcardsSessionContent | null;
  const knownCount = typeof parsed?.knownCount === "number" ? parsed?.knownCount : 0;
  const reviewCount = typeof parsed?.reviewCount === "number" ? parsed?.reviewCount : 0;
  return { knownCount, reviewCount };
}

function classUrlWithParams(
  classId: string,
  options?: { previewAsStudent?: boolean; errorMessage?: string },
) {
  const params = new URLSearchParams();
  if (options?.previewAsStudent) {
    params.set("as", "student");
  }
  if (options?.errorMessage) {
    params.set("error", options.errorMessage);
  }

  const query = params.toString();
  return query ? `/classes/${classId}?${query}` : `/classes/${classId}`;
}

export default async function FlashcardsAssignmentPage({
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
  const isStudentPreview = isTeacher && resolvedSearchParams?.as === "student";
  const classOverviewHref = classUrlWithParams(classId, { previewAsStudent: isStudentPreview });
  const dashboardHref = isStudentPreview ? "/teacher/dashboard" : "/student/dashboard";

  const { data: recipient } = await supabase
    .from("assignment_recipients")
    .select("assignment_id,status")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (!recipient && !isStudentPreview) {
    redirect(
      classUrlWithParams(classId, {
        previewAsStudent: isStudentPreview,
        errorMessage: "You are not assigned to this activity.",
      }),
    );
  }

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id,class_id,activity_id,due_at")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .single();

  if (!assignment) {
    redirect(
      classUrlWithParams(classId, {
        previewAsStudent: isStudentPreview,
        errorMessage: "Assignment not found.",
      }),
    );
  }

  const { data: activity } = await supabase
    .from("activities")
    .select("id,title,type,status,config")
    .eq("id", assignment.activity_id)
    .eq("class_id", classId)
    .single();

  if (!activity || activity.type !== "flashcards") {
    redirect(
      classUrlWithParams(classId, {
        previewAsStudent: isStudentPreview,
        errorMessage: "Flashcards activity not found.",
      }),
    );
  }

  const { data: submissions } = await supabase
    .from("submissions")
    .select("id,content,score,submitted_at")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .order("submitted_at", { ascending: true });

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

  const activityConfig =
    activity.config && typeof activity.config === "object"
      ? (activity.config as Record<string, unknown>)
      : {};

  const attemptLimit =
    typeof activityConfig.attemptLimit === "number" ? activityConfig.attemptLimit : 1;

  const attemptsUsed = (submissions ?? []).length;
  const dueLocked = isDueDateLocked(assignment.due_at);

  const { data: cards } = await supabase
    .from("flashcards")
    .select("id,front,back,order_index")
    .eq("activity_id", activity.id)
    .order("order_index", { ascending: true });

  const latestSubmission =
    submissions && submissions.length > 0 ? submissions[submissions.length - 1] : null;
  const latestCounts = extractLatestCounts(latestSubmission?.content);
  const bestScore =
    submissions && submissions.length > 0
      ? Math.max(
          ...submissions
            .map((submission) => submission.score)
            .filter((score): score is number => typeof score === "number"),
          0
        )
      : null;
  const latestTeacherFeedback = feedbackRows && feedbackRows.length > 0 ? feedbackRows[0] : null;
  const parsedTeacherFeedback = parseTeacherFeedbackContent(latestTeacherFeedback?.content);
  const submissionById = new Map((submissions ?? []).map((submission) => [submission.id, submission]));
  const feedbackSubmission = latestTeacherFeedback
    ? submissionById.get(latestTeacherFeedback.submission_id) ?? latestSubmission
    : latestSubmission;
  const shouldShowFeedbackPanel =
    attemptsUsed > 0 &&
    (recipient?.status === "reviewed" ||
      Boolean(latestTeacherFeedback) ||
      typeof feedbackSubmission?.score === "number");
  const feedbackStatus = recipient?.status ?? (attemptsUsed > 0 ? "submitted" : "assigned");

  const submittedNotice = resolvedSearchParams?.submitted === "1";
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  return (
    <div className="min-h-screen surface-page text-ui-primary">
      <AuthHeader
        activeNav="dashboard"
        accountType={isStudentPreview ? "teacher" : "student"}
        classContext={{ classId: classRow.id, isTeacher: false, preserveStudentPreview: isStudentPreview }}
        breadcrumbs={[
          { label: "Dashboard", href: dashboardHref },
          { label: classRow.title, href: classOverviewHref },
          { label: "Flashcards Assignment" },
        ]}
      />

      <div className="mx-auto w-full max-w-5xl px-6 py-16 page-enter">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Assignment Workspace</p>
          <h1 className="editorial-title mt-2 text-4xl text-ui-primary">{activity.title}</h1>
          <p className="mt-1.5 text-sm text-ui-muted">
            {assignment.due_at ? (
              <LocalizedDateTimeText value={assignment.due_at} prefix="Due " />
            ) : (
              "No due date"
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="secondary">
              <AppIcons.flashcards className="h-3.5 w-3.5" />
              Flashcards
            </Badge>
            {dueLocked ? <Badge variant="warning">Due date locked</Badge> : <Badge variant="outline">Open</Badge>}
          </div>
        </header>

        {errorMessage ? (
          <TransientFeedbackAlert
            variant="error"
            title="Unable to load assignment"
            message={errorMessage}
            className="mb-6"
          />
        ) : null}

        {shouldShowFeedbackPanel ? (
          <TeacherFeedbackPanel
            status={feedbackStatus}
            score={feedbackSubmission?.score ?? bestScore}
            comment={parsedTeacherFeedback.comment}
            highlights={parsedTeacherFeedback.highlights}
            reviewedAt={latestTeacherFeedback?.created_at ?? null}
            submissionLabel="Based on your latest reviewed flashcards session."
          />
        ) : null}

        {latestSubmission ? (
          <Card className="mb-6 rounded-2xl">
            <CardContent className="px-4 py-3 text-sm text-ui-muted">
            <p>
              Latest session: {latestCounts.knownCount} known, {latestCounts.reviewCount} to review
            </p>
            </CardContent>
          </Card>
        ) : null}

        <FlashcardsAssignmentPanel
          classId={classId}
          assignmentId={assignmentId}
          cards={
            (cards ?? []).map((card) => ({
              id: card.id,
              front: card.front,
              back: card.back,
            })) ?? []
          }
          attemptLimit={attemptLimit}
          attemptsUsed={attemptsUsed}
          bestScore={bestScore}
          dueLocked={dueLocked}
          isSubmittedNotice={submittedNotice}
          readOnly={isStudentPreview}
        />
      </div>
    </div>
  );
}
