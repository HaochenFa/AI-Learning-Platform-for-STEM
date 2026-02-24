import Link from "next/link";
import AmbientBackground from "@/app/components/AmbientBackground";
import BrandMark from "@/app/components/BrandMark";
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
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 pb-16 pt-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-ui-subtle">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#2f2b24] text-white">
              <BrandMark className="h-4 w-4" />
            </span>
            Learning Platform
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link className="ui-motion-color text-ui-muted hover:text-[#8f4a35]" href={secondaryHref}>
              {secondaryLabel}
            </Link>
            <Link
              className="ui-motion-color rounded-full border border-default bg-white px-4 py-2 font-semibold text-ui-muted hover:border-[#d8c8b9] hover:text-[#8f4a35]"
              href={primaryHref}
            >
              {primaryLabel}
            </Link>
          </div>
        </header>

        <main className="hero-shell grid gap-8 rounded-[2rem] border border-[#e6dfd2] px-7 pb-10 pt-10 shadow-sm lg:grid-cols-[minmax(0,1.08fr),minmax(0,0.92fr)] lg:px-10">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#e4d3c6] bg-[#fff7f2] px-4 py-2 text-xs font-semibold tracking-wide text-[#8f4a35]">
              <span className="h-2 w-2 rounded-full bg-[#c96e53]" />
              Trustworthy AI for real classrooms
            </div>
            <div className="space-y-5">
              <p className="text-sm font-medium text-ui-muted">For teachers and students</p>
              <h1 className="editorial-title text-4xl leading-tight text-ui-primary sm:text-[3.35rem]">
                Transform course materials into structured learning that feels rigorous, clear, and human.
              </h1>
              <p className="text-base text-ui-muted sm:text-lg">
                Build from one editable blueprint, launch class-ready activities, and keep AI responses
                grounded in what your learners are actually studying.
              </p>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ui-muted">
                Evidence-based workflow: Upload · Curate · Launch
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
            <div className="grid gap-2.5 sm:grid-cols-3">
              {[
                {
                  label: "Transparent Blueprint",
                  detail: "Topics and objectives stay teacher-editable.",
                },
                {
                  label: "Aligned Activities",
                  detail: "Chat, quiz, and flashcards share one context.",
                },
                {
                  label: "Classroom Trust",
                  detail: "Students receive guidance grounded in materials.",
                },
              ].map((item) => (
                <div key={item.label} className="hero-card rounded-2xl p-4">
                  <p className="text-xs font-semibold tracking-wide text-ui-subtle">{item.label}</p>
                  <p className="mt-1 text-xs text-ui-muted">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="hero-card rounded-3xl p-6 shadow-sm">
              <p className="text-xs font-semibold tracking-wide text-ui-muted">Blueprint Studio</p>
              <h2 className="mt-3 text-2xl font-semibold text-ui-primary">
                One class blueprint powers every activity.
              </h2>
              <p className="mt-2 text-sm text-ui-muted">
                Teachers stay in control of scope and rigor. Students benefit from consistent AI support
                across activities.
              </p>
              <ul className="mt-5 space-y-3 text-sm text-ui-subtle">
                {[
                  "Teacher-reviewed structure before student release.",
                  "Single source of truth for chat and assessments.",
                  "Clear learning progression from materials to practice.",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#c96e53]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hero-card grid gap-4 rounded-3xl p-6 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ui-muted">Teacher</p>
                <p className="mt-2 text-sm text-ui-subtle">
                  Upload materials, curate AI blueprint drafts, and launch assignments confidently.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ui-muted">Student</p>
                <p className="mt-2 text-sm text-ui-subtle">
                  Access guided AI chat and assignments grounded in your class context.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
