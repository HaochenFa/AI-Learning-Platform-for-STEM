import AuthShell from "@/app/(auth)/AuthShell";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { completePasswordRecovery } from "@/app/actions";
import { Alert } from "@/components/ui/alert";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_TITLE,
} from "@/lib/auth/password-policy";

type SearchParams = {
  error?: string;
  recovery?: string;
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const recoveryReady = resolvedSearchParams?.recovery === "1";

  return (
    <AuthShell
      eyebrow="Secure Recovery"
      title="Choose a new password"
      description="Set a fresh password for your account. Once saved, sign in again with the new credentials."
      footerLabel="Need another link?"
      footerLinkLabel="Request password reset"
      footerHref="/forgot-password"
    >
      {recoveryReady ? (
        <Alert variant="success" className="mb-6">
          Your reset link is confirmed. Enter a new password to finish recovery.
        </Alert>
      ) : null}

      {errorMessage ? (
        <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
      ) : null}

      <form className="space-y-4" action={completePasswordRecovery}>
        <div className="space-y-2">
          <Label htmlFor="new_password">New password</Label>
          <Input
            id="new_password"
            name="new_password"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            pattern={PASSWORD_POLICY_PATTERN}
            title={PASSWORD_POLICY_TITLE}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm_password">Confirm new password</Label>
          <Input
            id="confirm_password"
            name="confirm_password"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            pattern={PASSWORD_POLICY_PATTERN}
            title={PASSWORD_POLICY_TITLE}
          />
        </div>
        <p className="text-xs text-ui-muted">{PASSWORD_POLICY_HINT}</p>
        <PendingSubmitButton
          label="Save new password"
          pendingLabel="Saving password..."
          variant="warm"
          className="w-full"
        />
      </form>
    </AuthShell>
  );
}
