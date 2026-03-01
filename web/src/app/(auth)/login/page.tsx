import { signIn } from "@/app/actions";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import AuthShell from "@/app/(auth)/AuthShell";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SearchParams = {
  error?: string;
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

      {errorMessage ? (
        <Alert variant="error" className="mb-6">
          {errorMessage}
        </Alert>
      ) : null}

      <form className="space-y-4" action={signIn}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required minLength={6} />
        </div>
        <PendingSubmitButton
          label="Sign in"
          pendingLabel="Signing in..."
          variant="warm"
          className="w-full"
        />
      </form>
    </AuthShell>
  );
}
