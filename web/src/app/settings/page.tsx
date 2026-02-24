import Sidebar from "@/app/components/Sidebar";
import { requireVerifiedUser } from "@/lib/auth/session";

export default async function SettingsPage() {
  const { accountType, user } = await requireVerifiedUser();

  return (
    <div className="surface-page min-h-screen">
      <Sidebar accountType={accountType} userEmail={user.email ?? undefined} />
      <div className="sidebar-content">
        <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="mb-8 space-y-2">
            <p className="text-sm font-medium text-slate-500">Account Settings</p>
            <h1 className="text-3xl font-semibold text-slate-900">Settings</h1>
            <p className="text-sm text-slate-600">
              Manage your account details and understand what is available right now.
            </p>
          </header>

          <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">Account Information</h2>
                <p className="mt-2 text-sm text-slate-600">Core identity and role details.</p>

                <div className="mt-6 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-slate-500">Email</span>
                    <span className="text-sm font-semibold text-slate-900">{user.email}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-slate-500">Account Type</span>
                    <span className="text-sm font-semibold capitalize text-slate-900">{accountType}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-slate-500">User ID</span>
                    <span className="truncate text-xs font-mono text-slate-500">{user.id}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">Session & Access</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Use the sidebar sign-out button to end your current session.
                </p>
                <ul className="mt-4 space-y-3 text-sm text-slate-700">
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-600" />
                    <span>Your role and class permissions are enforced by secure server checks.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-600" />
                    <span>Only classes where you are enrolled are accessible from your dashboard.</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                <h2 className="text-lg font-semibold text-slate-900">Authentication Notice</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Password reset, multi-factor authentication, and advanced sign-in controls are
                  managed by your configured authentication provider.
                </p>
              </div>

              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
                <h2 className="text-lg font-semibold text-amber-800">Data Actions</h2>
                <p className="mt-2 text-sm text-amber-700">
                  Destructive account deletion is not available in this interface yet. If your
                  organization requires account removal, contact your administrator.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
