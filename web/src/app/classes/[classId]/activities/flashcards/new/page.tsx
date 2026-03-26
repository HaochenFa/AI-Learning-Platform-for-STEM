import { redirect } from "next/navigation";
import HeaderPageShell from "@/app/components/HeaderPageShell";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { generateFlashcardsDraft } from "@/app/classes/[classId]/flashcards/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { requireGuestOrVerifiedUser } from "@/lib/auth/session";

type SearchParams = {
  error?: string;
};

export default async function NewFlashcardsDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { classId } = await params;
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
        { label: "New Flashcards Draft" },
      ]}
    >
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Teacher Studio</p>
        <h1 className="editorial-title mt-2 text-4xl text-ui-primary">Generate Flashcards Draft</h1>
        <p className="mt-1.5 text-sm text-ui-muted">
          AI generates a draft you can edit and publish before assigning.
        </p>
      </header>

      {errorMessage ? (
        <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
      ) : null}

      <form action={generateFlashcardsDraft.bind(null, classId)} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Flashcards title</Label>
          <Input
            id="title"
            name="title"
            required
            placeholder="Week 3 Flashcards: Key Concepts"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="instructions">Flashcards instructions</Label>
          <Textarea
            id="instructions"
            name="instructions"
            required
            rows={4}
            placeholder="Focus on core definitions and key examples."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="card_count">Card count</Label>
          <Input
            id="card_count"
            name="card_count"
            type="number"
            min={1}
            max={30}
            defaultValue={12}
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
