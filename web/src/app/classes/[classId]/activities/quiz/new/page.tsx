import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { generateQuizDraft } from "@/app/classes/[classId]/quiz/actions";
import { requireVerifiedUser } from "@/lib/auth/session";

type SearchParams = {
  error?: string;
};

export default async function NewQuizDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { classId } = await params;
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

  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  return (
    <div className="min-h-screen surface-page text-ui-primary">
      <AuthHeader
        activeNav="dashboard"
        accountType="teacher"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: "New Quiz Draft" },
        ]}
      />

      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-ui-muted">Teacher Studio</p>
          <h1 className="text-3xl font-semibold">Generate Quiz Draft</h1>
          <p className="text-sm text-ui-muted">
            AI generates a draft you can edit and publish before assigning.
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <form action={generateQuizDraft.bind(null, classId)} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm text-ui-muted" htmlFor="title">
              Quiz Title
            </label>
            <input
              id="title"
              name="title"
              required
              placeholder="Week 3 Quiz: Derivative Basics"
              className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-ui-muted" htmlFor="instructions">
              Quiz Instructions
            </label>
            <textarea
              id="instructions"
              name="instructions"
              required
              rows={4}
              placeholder="Focus on definition-based questions and common misconceptions."
              className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-ui-muted" htmlFor="question_count">
              Question Count
            </label>
            <input
              id="question_count"
              name="question_count"
              type="number"
              min={1}
              max={20}
              defaultValue={10}
              className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
            />
          </div>

          <PendingSubmitButton
            label="Generate Draft"
            pendingLabel="Generating..."
            className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-ui-primary hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          />
        </form>
      </div>
    </div>
  );
}
