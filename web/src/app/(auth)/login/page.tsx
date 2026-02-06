import Link from "next/link";
import { signIn } from "@/app/actions";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";

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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-6 py-16">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center justify-start">
            <Link
              className="ui-motion-color inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-200 hover:border-cyan-400/40 hover:text-cyan-100"
              href="/"
              aria-label="Back to home"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Home
            </Link>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-8 shadow-2xl shadow-slate-900/40">
            <div className="mb-8 space-y-2">
              <p className="text-sm font-medium text-slate-400">
                Teacher + Student Access
              </p>
              <h1 className="text-3xl font-semibold">Welcome back</h1>
              <p className="text-sm text-slate-400">
                Sign in to manage classes, materials, and assignments.
              </p>
            </div>

            {verify ? (
              <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                Check your email to verify your account, then log in.
              </div>
            ) : null}

            {errorMessage ? (
              <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {errorMessage}
              </div>
            ) : null}

            <form className="space-y-4" action={signIn}>
              <div className="space-y-2">
                <label className="text-sm text-slate-300" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-slate-300" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={6}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>
              <PendingSubmitButton
                label="Sign in"
                pendingLabel="Signing in..."
                className="w-full rounded-xl bg-cyan-400/90 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
              />
            </form>

            <div className="mt-6 flex items-center justify-between text-sm text-slate-400">
              <span>New here?</span>
              <Link className="text-cyan-200 hover:text-cyan-100" href="/register">
                Create an account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
