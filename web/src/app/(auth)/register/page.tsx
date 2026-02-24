import { signUp } from "@/app/actions";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import AuthShell from "@/app/(auth)/AuthShell";

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
    <AuthShell
      eyebrow="Launch Your Class"
      title="Create an account"
      description="Start building clear, auditable AI learning experiences from your own classroom materials."
      footerLabel="Already have an account?"
      footerLinkLabel="Sign in"
      footerHref="/login"
    >
      {errorMessage ? (
        <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <form className="space-y-4" action={signUp}>
        <div className="space-y-2">
          <span className="text-sm font-medium text-ui-muted">Account type</span>
          <div className="grid grid-cols-2 gap-2">
            <label className="ui-motion-color flex cursor-pointer items-center gap-2 rounded-xl border border-[#dfd3c1] bg-white px-3 py-2 text-sm text-ui-subtle hover:border-[#cda785]">
              <input
                type="radio"
                name="account_type"
                value="teacher"
                defaultChecked
                className="h-4 w-4 accent-[#b56247]"
              />
              Teacher
            </label>
            <label className="ui-motion-color flex cursor-pointer items-center gap-2 rounded-xl border border-[#dfd3c1] bg-white px-3 py-2 text-sm text-ui-subtle hover:border-[#cda785]">
              <input
                type="radio"
                name="account_type"
                value="student"
                className="h-4 w-4 accent-[#b56247]"
              />
              Student
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-ui-muted" htmlFor="email">
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
          <label className="text-sm font-medium text-ui-muted" htmlFor="password">
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
          label="Create account"
          pendingLabel="Creating account..."
          className="btn-warm w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        />
      </form>
    </AuthShell>
  );
}
