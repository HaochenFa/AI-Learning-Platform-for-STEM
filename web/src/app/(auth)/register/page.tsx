import Link from "next/link";
import { signUp } from "@/app/actions";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";

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
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-6 py-16">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center justify-start">
            <Link
              className="ui-motion-color inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:border-cyan-400/40 hover:text-cyan-600"
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
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-xl">
            <div className="mb-8 space-y-2">
              <p className="text-sm font-medium text-slate-500">Launch Your Class</p>
              <h1 className="text-3xl font-semibold">Create an account</h1>
              <p className="text-sm text-slate-500">
                Start building course blueprints from your materials.
              </p>
            </div>

            {errorMessage ? (
              <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
                {errorMessage}
              </div>
            ) : null}

            <form className="space-y-4" action={signUp}>
              <div className="space-y-2">
                <span className="text-sm text-slate-600">Account type</span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-cyan-400/40">
                    <input
                      type="radio"
                      name="account_type"
                      value="teacher"
                      defaultChecked
                      className="h-4 w-4 accent-cyan-400"
                    />
                    Teacher
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-cyan-400/40">
                    <input
                      type="radio"
                      name="account_type"
                      value="student"
                      className="h-4 w-4 accent-cyan-400"
                    />
                    Student
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-slate-600" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-slate-600" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={6}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>
              <PendingSubmitButton
                label="Create account"
                pendingLabel="Creating account..."
                className="w-full rounded-xl bg-cyan-400/90 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
              />
            </form>

            <div className="mt-6 flex items-center justify-between text-sm text-slate-500">
              <span>Already have an account?</span>
              <Link className="text-cyan-600 hover:text-cyan-700" href="/login">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
