import Link from "next/link";
import { joinClass } from "@/app/classes/actions";

type SearchParams = {
  error?: string;
};

export default async function JoinClassPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-lg px-6 py-16">
        <header className="mb-10 space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Student Hub</p>
          <h1 className="text-3xl font-semibold">Join a class</h1>
          <p className="text-sm text-slate-400">
            Enter the join code from your teacher to access assignments.
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        <form className="space-y-6" action={joinClass}>
          <div className="space-y-2">
            <label className="text-sm text-slate-300" htmlFor="join_code">
              Join code
            </label>
            <input
              id="join_code"
              name="join_code"
              required
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm uppercase tracking-[0.35em] text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
              placeholder="AB12CD"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              className="rounded-xl bg-cyan-400/90 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              Join class
            </button>
            <Link className="text-sm text-slate-400 hover:text-slate-200" href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
