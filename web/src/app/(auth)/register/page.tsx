import { signUp } from "@/app/actions";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import AuthShell from "@/app/(auth)/AuthShell";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SearchParams = {
  error?: string;
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  return (
    <AuthShell
      eyebrow="Launch Your Class"
      title="Create an account"
      description="Start building clear, auditable AI learning experiences from your own classroom materials."
      footerLabel="Already have an account?"
      footerLinkLabel="Sign in"
      footerHref="/login"
    >
      {errorMessage ? (
        <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
      ) : null}

      <form className="space-y-4" action={signUp}>
        <div className="space-y-2">
          <span className="text-sm font-medium text-ui-muted">Account type</span>
          <div className="grid grid-cols-2 gap-2">
            <label className="ui-motion-color flex cursor-pointer items-center gap-2 rounded-xl border border-default bg-white px-3 py-2 text-sm text-ui-subtle hover:border-accent">
              <input
                type="radio"
                name="account_type"
                value="teacher"
                defaultChecked
                className="h-4 w-4 accent-[var(--accent-primary)]"
              />
              Teacher
            </label>
            <label className="ui-motion-color flex cursor-pointer items-center gap-2 rounded-xl border border-default bg-white px-3 py-2 text-sm text-ui-subtle hover:border-accent">
              <input
                type="radio"
                name="account_type"
                value="student"
                className="h-4 w-4 accent-[var(--accent-primary)]"
              />
              Student
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required minLength={6} />
        </div>
        <PendingSubmitButton
          label="Create account"
          pendingLabel="Creating account..."
          variant="warm"
          className="w-full"
        />
      </form>
    </AuthShell>
  );
}
