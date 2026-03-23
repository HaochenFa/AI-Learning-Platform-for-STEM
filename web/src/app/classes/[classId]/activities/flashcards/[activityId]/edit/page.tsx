import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import FlashcardsDraftEditor from "@/app/classes/[classId]/activities/flashcards/[activityId]/edit/FlashcardsDraftEditor";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { requireVerifiedUser } from "@/lib/auth/session";

type SearchParams = {
  created?: string;
  saved?: string;
  published?: string;
  error?: string;
};

export default async function FlashcardsDraftEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; activityId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { classId, activityId } = await params;
  const resolvedSearchParams = await searchParams;
  const { supabase, user } = await requireVerifiedUser({ accountType: "teacher" });

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

  const { data: activity } = await supabase
    .from("activities")
    .select("id,title,type,status,config")
    .eq("id", activityId)
    .eq("class_id", classId)
    .single();

  if (!activity || activity.type !== "flashcards") {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Flashcards activity not found.")}`);
  }

  const { data: cardRows } = await supabase
    .from("flashcards")
    .select("front,back,order_index")
    .eq("activity_id", activityId)
    .order("order_index", { ascending: true });

  /* Check whether any student submissions exist for this activity */
  let hasSubmissions = false;
  const { data: assignmentRows } = await supabase
    .from("assignments")
    .select("id")
    .eq("activity_id", activityId)
    .eq("class_id", classId);
  if (assignmentRows && assignmentRows.length > 0) {
    const assignmentIds = assignmentRows.map((a) => a.id);
    const { count } = await supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .in("assignment_id", assignmentIds);
    hasSubmissions = (count ?? 0) > 0;
  }

  const config =
    activity.config && typeof activity.config === "object"
      ? (activity.config as Record<string, unknown>)
      : {};

  const initialInstructions =
    typeof config.instructions === "string"
      ? config.instructions
      : "Review and refine flashcards.";

  const createdMessage =
    resolvedSearchParams?.created === "1"
      ? "Flashcards draft generated. Review and edit before publishing."
      : null;
  const savedMessage =
    resolvedSearchParams?.saved === "1" ? "Flashcards draft saved." : null;
  const publishedMessage =
    resolvedSearchParams?.published === "1"
      ? "Flashcards published. You can now create an assignment."
      : null;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  const initialCards = (cardRows ?? []).map((row) => ({
    front: row.front,
    back: row.back,
  }));

  return (
    <div className="min-h-screen surface-page text-ui-primary">
      <AuthHeader
        activeNav="dashboard"
        accountType="teacher"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: activity.status === "published" ? "Edit Published Flashcards" : "Flashcards Draft" },
        ]}
      />

      <div className="mx-auto w-full max-w-5xl px-6 py-16 page-enter">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Teacher Studio</p>
          <h1 className="editorial-title mt-2 text-4xl text-ui-primary">{activity.title}</h1>
          <p className="mt-1.5 text-sm text-ui-muted">
            Review and publish this flashcards activity for students.
          </p>
        </header>

        {createdMessage ? (
          <div className="mb-6 rounded-xl border border-accent bg-accent-soft px-4 py-3 text-sm text-accent">
            {createdMessage}
          </div>
        ) : null}
        {savedMessage ? (
          <div className="mb-6 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-3 text-sm text-[var(--status-success-fg)]">
            {savedMessage}
          </div>
        ) : null}
        {publishedMessage ? (
          <div className="mb-6 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-3 text-sm text-[var(--status-success-fg)]">
            {publishedMessage}
          </div>
        ) : null}
        {errorMessage ? (
          <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
        ) : null}

        <FlashcardsDraftEditor
          classId={classId}
          activityId={activityId}
          initialTitle={activity.title}
          initialInstructions={initialInstructions}
          initialCards={initialCards}
          isPublished={activity.status === "published"}
          hasSubmissions={hasSubmissions}
        />
      </div>
    </div>
  );
}
