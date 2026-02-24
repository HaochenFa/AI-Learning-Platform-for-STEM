import { createClass } from "@/app/classes/actions";
import AuthHeader from "@/app/components/AuthHeader";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { requireVerifiedUser } from "@/lib/auth/session";

type SearchParams = {
  error?: string;
};

export default async function NewClassPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireVerifiedUser({ accountType: "teacher" });
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  return (
    <div className="surface-page min-h-screen">
      <AuthHeader
        activeNav="new-class"
        accountType="teacher"
        breadcrumbs={[{ label: "Dashboard", href: "/teacher/dashboard" }, { label: "New class" }]}
      />
      <div className="mx-auto w-full max-w-4xl px-6 py-16">
        <header className="mb-10 space-y-2">
          <p className="text-sm font-medium text-ui-muted">Teacher Studio</p>
          <h1 className="text-3xl font-semibold text-ui-primary">Create a class</h1>
          <p className="text-sm text-ui-muted">
            Set the subject and level. A join code will be generated for students.
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <form className="space-y-6" action={createClass}>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm text-ui-muted" htmlFor="title">
                Class title
              </label>
              <input
                id="title"
                name="title"
                required
                className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
                placeholder="Calculus I - Derivatives"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-ui-muted" htmlFor="subject">
                Subject
              </label>
              <input
                id="subject"
                name="subject"
                className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
                placeholder="Mathematics"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-ui-muted" htmlFor="level">
                Level
              </label>
              <input
                id="level"
                name="level"
                className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
                placeholder="High school / College"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-ui-muted" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
              placeholder="Optional context about the class."
            />
          </div>

          <div className="flex items-center gap-4">
            <PendingSubmitButton
              label="Create class"
              pendingLabel="Creating class..."
              className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        </form>
      </div>
    </div>
  );
}
