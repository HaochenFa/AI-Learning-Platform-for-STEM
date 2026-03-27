import { signUp } from "@/app/actions";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import AuthShell from "@/app/(auth)/AuthShell";
import { Alert } from "@/components/ui/alert";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_TITLE,
} from "@/lib/auth/password-policy";

type SearchParams = {
  account_type?: string;
  email?: string;
  error?: string;
  guest?: string;
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const guestReady = resolvedSearchParams?.guest === "ready";
  const defaultEmail =
    typeof resolvedSearchParams?.email === "string" ? resolvedSearchParams.email : "";
  const defaultAccountType =
    resolvedSearchParams?.account_type === "student" ? "student" : "teacher";

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

      {guestReady ? (
        <Alert variant="success" className="mb-6">
          Your guest classroom has been discarded. Finish creating your account to continue with a
          fresh permanent workspace.
        </Alert>
      ) : null}

      <form className="space-y-4" action={signUp}>
        <div className="space-y-2">
          <span className="text-sm font-medium text-ui-muted">Account type</span>
          <div className="grid grid-cols-2 gap-2">
            <label className="ui-motion-color flex cursor-pointer items-center gap-2 rounded-xl border border-default bg-[var(--surface-card,white)] px-3 py-2 text-sm text-ui-subtle hover:border-accent">
              <input
                type="radio"
                name="account_type"
                value="teacher"
                defaultChecked={defaultAccountType === "teacher"}
                className="h-4 w-4 accent-[var(--accent-primary)]"
              />
              Teacher
            </label>
            <label className="ui-motion-color flex cursor-pointer items-center gap-2 rounded-xl border border-default bg-[var(--surface-card,white)] px-3 py-2 text-sm text-ui-subtle hover:border-accent">
              <input
                type="radio"
                name="account_type"
                value="student"
                defaultChecked={defaultAccountType === "student"}
                className="h-4 w-4 accent-[var(--accent-primary)]"
              />
              Student
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required defaultValue={defaultEmail} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            name="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            pattern={PASSWORD_POLICY_PATTERN}
            title={PASSWORD_POLICY_TITLE}
          />
          <p className="text-xs text-ui-muted">{PASSWORD_POLICY_HINT}</p>
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
