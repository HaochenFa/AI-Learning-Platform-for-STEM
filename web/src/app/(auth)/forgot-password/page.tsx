import AuthShell from "@/app/(auth)/AuthShell";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { requestPasswordReset } from "@/app/actions";
import { Alert } from "@/components/ui/alert";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SearchParams = {
  error?: string;
  sent?: string;
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const sent = resolvedSearchParams?.sent === "1";

  return (
    <AuthShell
      eyebrow="Account Recovery"
      title="Reset your password"
      description="We will email you a secure link to set a new password and get back into your workspace."
      footerLabel="Remembered your password?"
      footerLinkLabel="Back to sign in"
      footerHref="/login"
    >
      {sent ? (
        <Alert variant="success" className="mb-6">
          If an account exists for that email, we&apos;ve sent a password reset link.
        </Alert>
      ) : null}

      {errorMessage ? (
        <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
      ) : null}

      <form className="space-y-4" action={requestPasswordReset}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <PendingSubmitButton
          label="Send reset link"
          pendingLabel="Sending link..."
          variant="warm"
          className="w-full"
        />
      </form>
    </AuthShell>
  );
}
