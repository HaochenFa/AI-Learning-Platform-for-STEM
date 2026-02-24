import { joinClass } from "@/app/classes/actions";
import AuthHeader from "@/app/components/AuthHeader";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { requireVerifiedUser } from "@/lib/auth/session";

type SearchParams = {
  error?: string;
};

export default async function JoinClassPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireVerifiedUser({ accountType: "student" });
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  return (
    <div className="surface-page min-h-screen">
      <AuthHeader
        activeNav="join-class"
        accountType="student"
        breadcrumbs={[
          { label: "Dashboard", href: "/student/dashboard" },
          { label: "Join class" },
        ]}
      />
      <div className="mx-auto w-full max-w-lg px-6 py-16">
        <header className="mb-10 space-y-2">
          <p className="text-sm font-medium text-ui-muted">Student Hub</p>
          <h1 className="text-3xl font-semibold text-ui-primary">Join a class</h1>
          <p className="text-sm text-ui-muted">
            Enter the join code from your teacher to access assignments.
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <form className="space-y-6" action={joinClass}>
          <div className="space-y-2">
            <label className="text-sm text-ui-muted" htmlFor="join_code">
              Join code
            </label>
            <input
              id="join_code"
              name="join_code"
              required
              className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm tracking-[0.25em] text-ui-primary outline-none focus-ring-warm"
              placeholder="AB12CD"
            />
          </div>

          <div className="flex items-center gap-4">
            <PendingSubmitButton
              label="Join class"
              pendingLabel="Joining class..."
              className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        </form>
      </div>
    </div>
  );
}
