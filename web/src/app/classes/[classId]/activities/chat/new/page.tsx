import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { createChatAssignment } from "@/app/classes/[classId]/chat/actions";
import { requireVerifiedUser } from "@/lib/auth/session";

type SearchParams = {
  error?: string;
};

export default async function NewChatAssignmentPage({
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

  const { count: studentCount } = await supabase
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("class_id", classId)
    .eq("role", "student");

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
          { label: "New Chat Assignment" },
        ]}
      />

      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-ui-muted">Teacher Studio</p>
          <h1 className="text-3xl font-semibold">Create Chat Assignment</h1>
          <p className="text-sm text-ui-muted">Assigns to all enrolled students in this class.</p>
          <p className="text-xs text-ui-muted">Target students: {studentCount ?? 0}</p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <form action={createChatAssignment.bind(null, classId)} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm text-ui-muted" htmlFor="title">
              Assignment Title
            </label>
            <input
              id="title"
              name="title"
              required
              placeholder="Week 2 Guided Chat: Limits"
              className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-ui-muted" htmlFor="instructions">
              Instructions
            </label>
            <textarea
              id="instructions"
              name="instructions"
              required
              rows={5}
              placeholder="Ask at least three questions about formal limit definitions, then summarize what changed in your understanding."
              className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-ui-muted" htmlFor="due_at">
              Due Date (Optional)
            </label>
            <input
              id="due_at"
              name="due_at"
              type="datetime-local"
              className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
            />
          </div>

          <PendingSubmitButton
            label="Create and Assign"
            pendingLabel="Creating assignment..."
            className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-ui-primary hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          />
        </form>
      </div>
    </div>
  );
}
