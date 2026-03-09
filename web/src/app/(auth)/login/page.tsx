import { signIn } from "@/app/actions";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import AuthShell from "@/app/(auth)/AuthShell";
import { Alert } from "@/components/ui/alert";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";

type SearchParams = {
  confirmed?: string;
  error?: string;
  reset?: string;
  verify?: string;
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const confirmed = resolvedSearchParams?.confirmed === "1";
  const reset = resolvedSearchParams?.reset === "1";
  const verify = resolvedSearchParams?.verify === "1";

  return (
    <AuthShell
      eyebrow="Teacher + Student Access"
      title="Welcome back"
      description="Sign in to manage classes, review AI outputs, and keep student workflows grounded in your blueprint."
      footerLabel="New here?"
      footerLinkLabel="Create an account"
      footerHref="/register"
    >
      {verify ? (
        <Alert variant="success" className="mb-6">
          Check your email to verify your account, then log in.
        </Alert>
      ) : null}

      {confirmed ? (
        <Alert variant="success" className="mb-6">
          Your email has been verified. You can sign in now.
        </Alert>
      ) : null}

      {reset ? (
        <Alert variant="success" className="mb-6">
          Your password has been reset. Sign in with your new password.
        </Alert>
      ) : null}

      {errorMessage ? (
        <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
      ) : null}

      <form className="space-y-4" action={signIn}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
        </div>
        <PendingSubmitButton
          label="Sign in"
          pendingLabel="Signing in..."
          variant="warm"
          className="w-full"
        />
      </form>

      <p className="mt-4 text-right text-sm text-ui-muted">
        <Link href="/forgot-password" className="font-medium text-ui-primary underline-offset-4 hover:underline">
          Forgot your password?
        </Link>
      </p>
    </AuthShell>
  );
}
