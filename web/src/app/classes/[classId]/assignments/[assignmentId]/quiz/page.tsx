import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import { isDueDateLocked } from "@/lib/activities/submissions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import QuizAssignmentPanel from "@/app/classes/[classId]/assignments/[assignmentId]/quiz/QuizAssignmentPanel";

export const dynamic = "force-dynamic";

type SearchParams = {
  error?: string;
  submitted?: string;
};

type QuizAttemptContent = {
  answers?: Array<{ questionId?: unknown; selectedChoice?: unknown }>;
};

function extractLatestAnswers(content: unknown) {
  const parsed = content as QuizAttemptContent | null;
  const answersArray = Array.isArray(parsed?.answers) ? parsed?.answers : [];

  return answersArray.reduce<Record<string, string>>((accumulator, answer) => {
    if (
      answer &&
      typeof answer === "object" &&
      typeof answer.questionId === "string" &&
      typeof answer.selectedChoice === "string"
    ) {
      accumulator[answer.questionId] = answer.selectedChoice;
    }
    return accumulator;
  }, {});
}

export default async function QuizAssignmentPage({
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

  const { data: recipient } = await supabase
    .from("assignment_recipients")
    .select("assignment_id,status")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (!recipient) {
    redirect(`/classes/${classId}?error=${encodeURIComponent("You are not assigned to this quiz.")}`);
  }

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id,class_id,activity_id,due_at")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .single();

  if (!assignment) {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Assignment not found.")}`);
  }

  const { data: activity } = await supabase
    .from("activities")
    .select("id,title,type,status,config")
    .eq("id", assignment.activity_id)
    .eq("class_id", classId)
    .single();

  if (!activity || activity.type !== "quiz") {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Quiz activity not found.")}`);
  }

  const { data: submissions } = await supabase
    .from("submissions")
    .select("id,content,score,submitted_at")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .order("submitted_at", { ascending: true });

  const activityConfig =
    activity.config && typeof activity.config === "object"
      ? (activity.config as Record<string, unknown>)
      : {};

  const attemptLimit =
    typeof activityConfig.attemptLimit === "number" ? activityConfig.attemptLimit : 2;

  const attemptsUsed = (submissions ?? []).length;
  const dueLocked = isDueDateLocked(assignment.due_at);
  const revealAnswers = attemptsUsed >= attemptLimit || dueLocked;

  const questions = revealAnswers
    ? (
        await supabase
          .from("quiz_questions")
          .select("id,question,choices,answer,explanation,order_index")
          .eq("activity_id", activity.id)
          .order("order_index", { ascending: true })
      ).data?.map((row) => ({
        id: row.id,
        question: row.question,
        choices: Array.isArray(row.choices)
          ? row.choices.filter((choice): choice is string => typeof choice === "string")
          : [],
        answer: row.answer ?? "",
        explanation: row.explanation ?? "",
      })) ?? []
    : (
        await supabase
          .from("quiz_questions")
          .select("id,question,choices,order_index")
          .eq("activity_id", activity.id)
          .order("order_index", { ascending: true })
      ).data?.map((row) => ({
        id: row.id,
        question: row.question,
        choices: Array.isArray(row.choices)
          ? row.choices.filter((choice): choice is string => typeof choice === "string")
          : [],
      })) ?? [];

  const latestSubmission = submissions && submissions.length > 0 ? submissions[submissions.length - 1] : null;
  const latestAnswers = extractLatestAnswers(latestSubmission?.content);
  const bestScore =
    submissions && submissions.length > 0
      ? Math.max(
          ...submissions
            .map((submission) => submission.score)
            .filter((score): score is number => typeof score === "number"),
          0,
        )
      : null;

  const submittedNotice = resolvedSearchParams?.submitted === "1";
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: "Quiz Assignment" },
        ]}
      />

      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-slate-400">Assignment Workspace</p>
          <h1 className="text-3xl font-semibold">{activity.title}</h1>
          <p className="text-sm text-slate-400">
            {assignment.due_at ? `Due ${new Date(assignment.due_at).toLocaleString()}` : "No due date"}
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        <QuizAssignmentPanel
          classId={classId}
          assignmentId={assignmentId}
          questions={questions}
          latestAnswers={latestAnswers}
          attemptLimit={attemptLimit}
          attemptsUsed={attemptsUsed}
          bestScore={bestScore}
          dueLocked={dueLocked}
          revealAnswers={revealAnswers}
          isSubmittedNotice={submittedNotice}
        />
      </div>
    </div>
  );
}
