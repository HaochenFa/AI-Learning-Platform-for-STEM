import { redirect } from "next/navigation";
import HeaderPageShell from "@/app/components/HeaderPageShell";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { generateQuizDraft } from "@/app/classes/[classId]/quiz/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { requireVerifiedUser } from "@/lib/auth/session";

type SearchParams = {
  error?: string;
  topicId?: string;
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

  const topicId =
    typeof resolvedSearchParams?.topicId === "string" && resolvedSearchParams.topicId.trim()
      ? resolvedSearchParams.topicId.trim()
      : null;

  let topicTitle: string | null = null;
  if (topicId) {
    const { data: topicRow } = await supabase
      .from("topics")
      .select("title")
      .eq("id", topicId)
      .single();
    topicTitle = topicRow?.title ?? null;
  }

  return (
    <HeaderPageShell
      activeNav="dashboard"
      accountType="teacher"
      maxWidthClassName="max-w-3xl"
      classContext={{ classId: classRow.id, isTeacher }}
      breadcrumbs={[
        { label: "Dashboard", href: "/teacher/dashboard" },
        { label: classRow.title, href: `/classes/${classRow.id}` },
        { label: "New Quiz Draft" },
      ]}
    >
      <header className="mb-8 space-y-2">
        <p className="text-sm font-medium text-ui-muted">Teacher Studio</p>
        <h1 className="text-3xl font-semibold">Generate Quiz Draft</h1>
        <p className="text-sm text-ui-muted">
          AI generates a draft you can edit and publish before assigning.
        </p>
      </header>

      {errorMessage ? (
        <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
      ) : null}

      {topicTitle ? (
        <div className="mb-6 rounded-xl border border-accent bg-accent-soft px-4 py-3 text-sm">
          Generating quiz for: <strong>{topicTitle}</strong>
        </div>
      ) : null}

      <form action={generateQuizDraft.bind(null, classId)} className="space-y-6">
        {topicId ? <input type="hidden" name="topic_id" value={topicId} /> : null}
        <div className="space-y-2">
          <Label htmlFor="title">Quiz title</Label>
          <Input
            id="title"
            name="title"
            required
            placeholder="Week 3 Quiz: Derivative Basics"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="instructions">Quiz instructions</Label>
          <Textarea
            id="instructions"
            name="instructions"
            required
            rows={4}
            placeholder="Focus on definition-based questions and common misconceptions."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="question_count">Question Count</Label>
          <Input
            id="question_count"
            name="question_count"
            type="number"
            min={1}
            max={20}
            defaultValue={10}
          />
        </div>

        <PendingSubmitButton
          label="Generate Draft"
          pendingLabel="Generating..."
          variant="warm"
        />
      </form>
    </HeaderPageShell>
  );
}
