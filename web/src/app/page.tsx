import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import AmbientBackground from "@/app/components/AmbientBackground";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthed = Boolean(user);
  const primaryHref = isAuthed ? "/classes/new" : "/register";
  const primaryLabel = isAuthed ? "Create a class" : "Start a class";
  const secondaryHref = isAuthed ? "/dashboard" : "/login";
  const secondaryLabel = isAuthed ? "Go to dashboard" : "Sign in to dashboard";
  const headerPrimaryHref = isAuthed ? "/dashboard" : "/login";
  const headerPrimaryLabel = isAuthed ? "Dashboard" : "Sign in";
  const headerSecondaryHref = isAuthed ? "/classes/new" : "/register";
  const headerSecondaryLabel = isAuthed ? "New class" : "Create account";

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <AmbientBackground />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-16 px-6 pb-16 pt-10">
        <header className="flex items-center justify-between">
          <div className="text-sm uppercase tracking-[0.3em] text-slate-400">
            STEM Learning Platform
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link className="text-slate-200 transition hover:text-white" href={headerPrimaryHref}>
              {headerPrimaryLabel}
            </Link>
            <Link
              className="rounded-full border border-white/10 px-4 py-2 text-slate-200 transition hover:border-white/30 hover:bg-white/5"
              href={headerSecondaryHref}
            >
              {headerSecondaryLabel}
            </Link>
          </div>
        </header>

        <main className="grid gap-10 pb-12 pt-16 lg:grid-cols-[minmax(0,1.05fr),minmax(0,0.95fr)]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-cyan-100">
              <span className="h-2 w-2 rounded-full bg-cyan-300" />
              Blueprint first workflow
            </div>
            <div className="space-y-6">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
                For teachers and students
              </p>
              <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
                Turn materials into
                <span className="text-cyan-300"> structured learning</span>, not generic AI.
              </h1>
              <p className="text-base text-slate-300 sm:text-lg">
                Upload STEM materials, curate a course blueprint, and launch AI powered activities
                that stay aligned to your class.
              </p>
              <p className="text-xs text-slate-400">
                Upload → curate → launch. Every activity traces back to an editable blueprint.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <Link
                className="rounded-xl bg-cyan-400/90 px-5 py-3 text-sm font-semibold text-slate-950 transition duration-200 hover:-translate-y-0.5 hover:bg-cyan-300"
                href={primaryHref}
              >
                {primaryLabel}
              </Link>
              <Link
                className="rounded-xl border border-white/10 px-5 py-3 text-sm text-slate-200 transition duration-200 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/5"
                href={secondaryHref}
              >
                {secondaryLabel}
              </Link>
            </div>
            <div className="flex flex-wrap gap-3">
              {[
                ["01", "Upload materials"],
                ["02", "Curate blueprint"],
                ["03", "Launch activities"],
              ].map(([step, title]) => (
                <div
                  key={step}
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/60 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-300 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/30"
                >
                  <span className="text-cyan-200">{step}</span>
                  <span>{title}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 transition duration-200 hover:-translate-y-1 hover:border-cyan-400/30">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Blueprint studio</p>
            <h2 className="mt-3 text-2xl font-semibold">One blueprint powers every activity.</h2>
            <p className="mt-2 text-sm text-slate-400">
              Teachers curate the blueprint. Students learn from a transparent, shared context.
            </p>
            <ul className="mt-5 space-y-3 text-sm text-slate-300">
              {[
                "Structured topics and objectives, fully editable.",
                "Assignments, quizzes, and chat stay aligned to class materials.",
                "Audit trail of what AI used for every response.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-slate-300">
              {["Blueprint", "Activities", "Insights"].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-white/10 px-3 py-1 text-slate-400"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
