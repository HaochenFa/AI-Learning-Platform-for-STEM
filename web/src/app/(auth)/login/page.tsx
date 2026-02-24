import { signIn } from "@/app/actions";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import AuthShell from "@/app/(auth)/AuthShell";

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
        <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
          Check your email to verify your account, then log in.
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <form className="space-y-4" action={signIn}>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-600" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="input-shell w-full rounded-xl px-4 py-3 text-sm outline-none transition"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-600" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            className="input-shell w-full rounded-xl px-4 py-3 text-sm outline-none transition"
          />
        </div>
        <PendingSubmitButton
          label="Sign in"
          pendingLabel="Signing in..."
          className="btn-warm w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        />
      </form>
    </AuthShell>
  );
}
