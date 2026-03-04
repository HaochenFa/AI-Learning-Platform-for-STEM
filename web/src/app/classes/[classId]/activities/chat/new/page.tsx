import { redirect } from "next/navigation";
import HeaderPageShell from "@/app/components/HeaderPageShell";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { createChatAssignment } from "@/app/classes/[classId]/chat/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
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
    <HeaderPageShell
      activeNav="dashboard"
      accountType="teacher"
      maxWidthClassName="max-w-3xl"
      classContext={{ classId: classRow.id, isTeacher }}
      breadcrumbs={[
        { label: "Dashboard", href: "/teacher/dashboard" },
        { label: classRow.title, href: `/classes/${classRow.id}` },
        { label: "New Chat Assignment" },
      ]}
    >
      <header className="mb-8 space-y-2">
        <p className="text-sm font-medium text-ui-muted">Teacher Studio</p>
        <h1 className="text-3xl font-semibold">Create Chat Assignment</h1>
        <p className="text-sm text-ui-muted">Assigns to all enrolled students in this class.</p>
        <p className="text-xs text-ui-muted">Target students: {studentCount ?? 0}</p>
      </header>

      {errorMessage ? (
        <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
      ) : null}

      <form action={createChatAssignment.bind(null, classId)} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Assignment Title</Label>
          <Input
            id="title"
            name="title"
            required
            placeholder="Week 2 Guided Chat: Limits"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="instructions">Instructions</Label>
          <Textarea
            id="instructions"
            name="instructions"
            required
            rows={5}
            placeholder="Ask at least three questions about formal limit definitions, then summarize what changed in your understanding."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="due_at">Due date (optional)</Label>
          <Input
            id="due_at"
            name="due_at"
            type="datetime-local"
          />
        </div>

        <PendingSubmitButton
          label="Create and Assign"
          pendingLabel="Creating assignment..."
          variant="warm"
        />
      </form>
    </HeaderPageShell>
  );
}
