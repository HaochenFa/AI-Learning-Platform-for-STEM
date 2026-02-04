import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#22d3ee33,transparent_45%),radial-gradient(circle_at_70%_20%,#38bdf833,transparent_40%),radial-gradient(circle_at_bottom,#0ea5e933,transparent_35%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-between px-6 py-12">
        <header className="flex items-center justify-between">
          <div className="text-sm uppercase tracking-[0.3em] text-slate-400">
            STEM Learning Platform
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link className="text-slate-200 hover:text-white" href="/login">
              Sign in
            </Link>
            <Link
              className="rounded-full border border-white/10 px-4 py-2 text-slate-200 transition hover:border-white/30"
              href="/register"
            >
              Create account
            </Link>
          </div>
        </header>

        <main className="grid gap-12 pb-16 pt-24 md:grid-cols-2">
          <div className="space-y-6">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
              Teacher led, student centered
            </p>
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
              Turn materials into
              <span className="text-cyan-300"> structured learning</span>, not generic AI.
            </h1>
            <p className="text-base text-slate-300 sm:text-lg">
              Upload STEM materials, curate a course blueprint, and deliver AI powered quizzes,
              flashcards, homework support, and exam review that stay aligned to your class.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                className="rounded-xl bg-cyan-400/90 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                href="/register"
              >
                Start a class
              </Link>
              <Link
                className="rounded-xl border border-white/10 px-5 py-3 text-sm text-slate-200 transition hover:border-white/30"
                href="/login"
              >
                Go to dashboard
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Blueprint</p>
              <h2 className="mt-3 text-xl font-semibold">
                Course map generated from your materials
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Topics, objectives, prerequisites, and misconceptions organized for teacher review.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Activities</p>
              <h2 className="mt-3 text-xl font-semibold">
                AI learning tools grounded in class context
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Chat, quizzes, flashcards, homework support, and exam review tied to approved
                content.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Insights</p>
              <h2 className="mt-3 text-xl font-semibold">
                Teacher control with student centered feedback
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Review AI feedback, track progress, and refine the next cycle.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
