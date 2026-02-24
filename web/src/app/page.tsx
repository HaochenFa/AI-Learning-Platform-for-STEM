import Link from "next/link";
import AmbientBackground from "@/app/components/AmbientBackground";
import { getAuthContext } from "@/lib/auth/session";

export default async function HomePage() {
  const { user, profile, isEmailVerified } = await getAuthContext();
  const accountType = profile?.account_type;
  const isAuthed = Boolean(
    user && isEmailVerified && (accountType === "teacher" || accountType === "student"),
  );
  const dashboardHref =
    accountType === "teacher"
      ? "/teacher/dashboard"
      : accountType === "student"
        ? "/student/dashboard"
        : "/dashboard";
  const primaryHref = !isAuthed ? "/register" : accountType === "teacher" ? "/classes/new" : "/join";
  const primaryLabel = !isAuthed
    ? "Create account"
    : accountType === "teacher"
      ? "Create a class"
      : "Join a class";
  const secondaryHref = isAuthed ? dashboardHref : "/login";
  const secondaryLabel = isAuthed ? "Go to dashboard" : "Sign in";

  return (
    <div className="surface-page relative min-h-screen overflow-hidden">
      <AmbientBackground />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-16 px-6 pb-16 pt-10">
        <header className="flex items-center justify-between">
          <div className="text-sm font-semibold tracking-wide text-slate-700">STEM Learning Platform</div>
          <div className="flex items-center gap-3 text-sm">
            <Link className="ui-motion-color text-slate-600 hover:text-cyan-700" href={secondaryHref}>
              {secondaryLabel}
            </Link>
            <Link
              className="ui-motion-color rounded-full border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-600 hover:border-cyan-300 hover:text-cyan-700"
              href={primaryHref}
            >
              {primaryLabel}
            </Link>
          </div>
        </header>

        <main className="grid gap-10 pb-12 pt-14 lg:grid-cols-[minmax(0,1.05fr),minmax(0,0.95fr)]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2 text-xs font-semibold tracking-wide text-cyan-700">
              <span className="h-2 w-2 rounded-full bg-cyan-500" />
              Blueprint-first workflow
            </div>
            <div className="space-y-6">
              <p className="text-sm font-medium text-slate-600">For teachers and students</p>
              <h1 className="text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl">
                Turn materials into
                <span className="text-cyan-600"> structured learning</span>, not generic AI.
              </h1>
              <p className="text-base text-slate-600 sm:text-lg">
                Upload STEM materials, curate a course blueprint, and launch AI-powered activities
                that stay aligned to your class.
              </p>
              <p className="text-xs text-slate-500">
                Upload, curate, launch. Every activity traces back to an editable blueprint.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <Link
                className="btn-primary ui-motion-lift rounded-xl px-5 py-3 text-sm font-semibold hover:-translate-y-0.5"
                href={primaryHref}
              >
                {primaryLabel}
              </Link>
              <Link
                className="btn-secondary ui-motion-lift rounded-xl px-5 py-3 text-sm font-semibold hover:-translate-y-0.5"
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
                  className="ui-motion-lift flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:-translate-y-0.5 hover:border-cyan-300"
                >
                  <span className="text-cyan-700">{step}</span>
                  <span>{title}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="ui-motion-lift rounded-3xl border border-slate-200 bg-white p-6 shadow-sm hover:-translate-y-1 hover:border-cyan-300 hover:shadow-md">
            <p className="text-xs font-semibold tracking-wide text-slate-500">Blueprint studio</p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900">One blueprint powers every activity.</h2>
            <p className="mt-2 text-sm text-slate-600">
              Teachers curate the blueprint. Students learn from a transparent, shared context.
            </p>
            <ul className="mt-5 space-y-3 text-sm text-slate-700">
              {[
                "Structured topics and objectives, fully editable.",
                "Assignments, quizzes, and chat stay aligned to class materials.",
                "Audit trail of what AI used for every response.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
              {[
                "Blueprint",
                "Activities",
                "Insights",
              ].map((label) => (
                <span key={label} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
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
