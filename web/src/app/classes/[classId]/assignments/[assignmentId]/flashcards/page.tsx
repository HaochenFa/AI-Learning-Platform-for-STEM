import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import { isDueDateLocked } from "@/lib/activities/submissions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import FlashcardsAssignmentPanel from "@/app/classes/[classId]/assignments/[assignmentId]/flashcards/FlashcardsAssignmentPanel";

export const dynamic = "force-dynamic";

type SearchParams = {
  error?: string;
  submitted?: string;
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

  const { data: recipient } = await supabase
    .from("assignment_recipients")
    .select("assignment_id,status")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (!recipient) {
    redirect(
      `/classes/${classId}?error=${encodeURIComponent("You are not assigned to this activity.")}`
    );
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

  if (!activity || activity.type !== "flashcards") {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Flashcards activity not found.")}`);
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
          { label: "Flashcards Assignment" },
        ]}
      />

      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-slate-400">Assignment Workspace</p>
          <h1 className="text-3xl font-semibold">{activity.title}</h1>
          <p className="text-sm text-slate-400">
            {assignment.due_at
              ? `Due ${new Date(assignment.due_at).toLocaleString()}`
              : "No due date"}
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {latestSubmission ? (
          <div className="mb-6 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
            <p>
              Latest session: {latestCounts.knownCount} known, {latestCounts.reviewCount} to review
            </p>
          </div>
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
        />
      </div>
    </div>
  );
}
