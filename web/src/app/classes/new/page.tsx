import { createClass } from "@/app/classes/actions";
import HeaderPageShell from "@/app/components/HeaderPageShell";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireVerifiedUser } from "@/lib/auth/session";

type SearchParams = {
  error?: string;
};

export default async function NewClassPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireVerifiedUser({ accountType: "teacher" });
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  return (
    <HeaderPageShell
      activeNav="new-class"
      accountType="teacher"
      maxWidthClassName="max-w-4xl"
      breadcrumbs={[{ label: "Dashboard", href: "/teacher/dashboard" }, { label: "New class" }]}
    >
      <header className="mb-10 space-y-2">
        <p className="text-sm font-medium text-ui-muted">Teacher Studio</p>
        <h1 className="text-3xl font-semibold text-ui-primary">Create a class</h1>
        <p className="text-sm text-ui-muted">
          Set the subject and level. A join code will be generated for students.
        </p>
      </header>

      {errorMessage ? (
        <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
      ) : null}

      <form className="space-y-6" action={createClass}>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="title">Class title</Label>
            <Input
              id="title"
              name="title"
              required
              placeholder="Calculus I - Derivatives"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              name="subject"
              placeholder="Mathematics"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="level">Level</Label>
            <Input
              id="level"
              name="level"
              placeholder="High school / College"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={4}
            placeholder="Optional context about the class."
          />
        </div>

        <div className="flex items-center gap-4">
          <PendingSubmitButton
            label="Create class"
            pendingLabel="Creating class..."
            variant="warm"
          />
        </div>
      </form>
    </HeaderPageShell>
  );
}
