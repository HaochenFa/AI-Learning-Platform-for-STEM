import Sidebar from "@/app/components/Sidebar";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { changePassword, updateDisplayName } from "@/app/settings/actions";
import { requireVerifiedUser } from "@/lib/auth/session";

type SettingsSearchParams = {
  section?: string;
  status?: string;
  message?: string;
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<SettingsSearchParams>;
}) {
  const { accountType, user, profile } = await requireVerifiedUser();
  const resolvedSearchParams = await searchParams;

  const section = resolvedSearchParams?.section;
  const status = resolvedSearchParams?.status;
  const message = typeof resolvedSearchParams?.message === "string" ? resolvedSearchParams.message : null;

  const profileMessage = section === "profile" && status ? { status, message } : null;
  const passwordMessage = section === "password" && status ? { status, message } : null;

  return (
    <div className="surface-page min-h-screen">
      <Sidebar
        accountType={accountType}
        userEmail={user.email ?? undefined}
        userDisplayName={profile.display_name}
      />
      <div className="sidebar-content">
        <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="mb-8 space-y-2">
            <p className="text-sm font-medium text-ui-muted">Account Settings</p>
            <h1 className="text-3xl font-semibold text-ui-primary">Settings</h1>
            <p className="text-sm text-ui-muted">
              Manage your profile, credentials, and account-level preferences.
            </p>
          </header>

          <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-default bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-ui-primary">Account Information</h2>
                <p className="mt-2 text-sm text-ui-muted">Core identity and role details.</p>

                <div className="mt-6 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-ui-muted">Display Name</span>
                    <span className="text-sm font-semibold text-ui-primary">
                      {profile.display_name || "Not set"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-ui-muted">Email</span>
                    <span className="text-sm font-semibold text-ui-primary">{user.email}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-ui-muted">Account Type</span>
                    <span className="text-sm font-semibold capitalize text-ui-primary">{accountType}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-ui-muted">User ID</span>
                    <span className="truncate text-xs font-mono text-ui-muted">{user.id}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-default bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-ui-primary">Profile Name</h2>
                <p className="mt-2 text-sm text-ui-muted">
                  This name appears in shared class experiences and chat surfaces.
                </p>

                {profileMessage ? (
                  <div
                    className={`mt-4 rounded-xl px-4 py-3 text-sm ${
                      profileMessage.status === "success"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {profileMessage.message || "Profile update completed."}
                  </div>
                ) : null}

                <form className="mt-5 space-y-4" action={updateDisplayName}>
                  <div className="space-y-2">
                    <label className="text-sm text-ui-muted" htmlFor="display_name">
                      Display name
                    </label>
                    <input
                      id="display_name"
                      name="display_name"
                      required
                      minLength={2}
                      maxLength={60}
                      defaultValue={profile.display_name ?? ""}
                      className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none transition focus-ring-warm"
                      placeholder="e.g., Dr. Fa"
                    />
                  </div>
                  <PendingSubmitButton
                    label="Save display name"
                    pendingLabel="Saving..."
                    className="btn-secondary rounded-xl px-5 py-2.5 text-sm font-semibold"
                  />
                </form>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-default bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-ui-primary">Change Password</h2>
                <p className="mt-2 text-sm text-ui-muted">
                  Confirm your current password before setting a new one.
                </p>

                {passwordMessage ? (
                  <div
                    className={`mt-4 rounded-xl px-4 py-3 text-sm ${
                      passwordMessage.status === "success"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {passwordMessage.message || "Password update completed."}
                  </div>
                ) : null}

                <form className="mt-5 space-y-4" action={changePassword}>
                  <div className="space-y-2">
                    <label className="text-sm text-ui-muted" htmlFor="current_password">
                      Current password
                    </label>
                    <input
                      id="current_password"
                      name="current_password"
                      type="password"
                      required
                      className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none transition focus-ring-warm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-ui-muted" htmlFor="new_password">
                      New password
                    </label>
                    <input
                      id="new_password"
                      name="new_password"
                      type="password"
                      required
                      minLength={8}
                      className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none transition focus-ring-warm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-ui-muted" htmlFor="confirm_password">
                      Confirm new password
                    </label>
                    <input
                      id="confirm_password"
                      name="confirm_password"
                      type="password"
                      required
                      minLength={8}
                      className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none transition focus-ring-warm"
                    />
                  </div>
                  <PendingSubmitButton
                    label="Update password"
                    pendingLabel="Updating..."
                    className="btn-primary rounded-xl px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </form>
              </div>

              <div className="rounded-3xl border border-default bg-[var(--surface-muted)] p-6">
                <h2 className="text-lg font-semibold text-ui-primary">Security Notes</h2>
                <ul className="mt-3 space-y-2 text-sm text-ui-muted">
                  <li>Your role and class permissions are enforced by secure server checks.</li>
                  <li>Only classes where you are enrolled are accessible from your dashboard.</li>
                  <li>Use Sign Out from the sidebar on shared devices.</li>
                </ul>
              </div>

              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
                <h2 className="text-lg font-semibold text-amber-800">Data Actions</h2>
                <p className="mt-2 text-sm text-amber-700">
                  Account deletion is not available in this interface yet. Contact your organization
                  owner if formal account removal is required.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
