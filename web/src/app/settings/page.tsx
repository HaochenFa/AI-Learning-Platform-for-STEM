import RoleAppShell from "@/app/components/RoleAppShell";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { changePassword, updateDisplayName } from "@/app/settings/actions";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_TITLE,
} from "@/lib/auth/password-policy";
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
    <RoleAppShell
      accountType={accountType}
      userEmail={user.email ?? undefined}
      userDisplayName={profile.display_name}
    >
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
              <Card className="p-6">
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
              </Card>

              <Card className="p-6">
                <h2 className="text-lg font-semibold text-ui-primary">Profile Name</h2>
                <p className="mt-2 text-sm text-ui-muted">
                  This name appears in shared class experiences and chat surfaces.
                </p>

                {profileMessage ? (
                  profileMessage.status === "success" ? (
                    <Alert variant="success" className="mt-4">
                      {profileMessage.message || "Profile update completed."}
                    </Alert>
                  ) : (
                    <TransientFeedbackAlert
                      variant="error"
                      message={profileMessage.message || "Profile update failed."}
                      className="mt-4"
                    />
                  )
                ) : null}

                <form className="mt-5 space-y-4" action={updateDisplayName}>
                  <div className="space-y-2">
                    <Label htmlFor="display_name">Display name</Label>
                    <Input
                      id="display_name"
                      name="display_name"
                      required
                      minLength={2}
                      maxLength={60}
                      defaultValue={profile.display_name ?? ""}
                      placeholder="e.g., Dr. Fa"
                    />
                  </div>
                  <PendingSubmitButton
                    label="Save display name"
                    pendingLabel="Saving..."
                    variant="outline"
                  />
                </form>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="p-6">
                <h2 className="text-lg font-semibold text-ui-primary">Change Password</h2>
                <p className="mt-2 text-sm text-ui-muted">
                  Confirm your current password before setting a new one.
                </p>

                {passwordMessage ? (
                  passwordMessage.status === "success" ? (
                    <Alert variant="success" className="mt-4">
                      {passwordMessage.message || "Password update completed."}
                    </Alert>
                  ) : (
                    <TransientFeedbackAlert
                      variant="error"
                      message={passwordMessage.message || "Password update failed."}
                      className="mt-4"
                    />
                  )
                ) : null}

                <form className="mt-5 space-y-4" action={changePassword}>
                  <div className="space-y-2">
                    <Label htmlFor="current_password">Current password</Label>
                    <Input id="current_password" name="current_password" type="password" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new_password">New password</Label>
                    <Input
                      id="new_password"
                      name="new_password"
                      type="password"
                      required
                      minLength={PASSWORD_MIN_LENGTH}
                      pattern={PASSWORD_POLICY_PATTERN}
                      title={PASSWORD_POLICY_TITLE}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm_password">Confirm new password</Label>
                    <Input
                      id="confirm_password"
                      name="confirm_password"
                      type="password"
                      required
                      minLength={PASSWORD_MIN_LENGTH}
                      pattern={PASSWORD_POLICY_PATTERN}
                      title={PASSWORD_POLICY_TITLE}
                    />
                  </div>
                  <p className="text-xs text-ui-muted">{PASSWORD_POLICY_HINT}</p>
                  <PendingSubmitButton
                    label="Update password"
                    pendingLabel="Updating..."
                    variant="warm"
                  />
                </form>
              </Card>

              <Card className="bg-[var(--surface-muted)] p-6">
                <h2 className="text-lg font-semibold text-ui-primary">Security Notes</h2>
                <ul className="mt-3 space-y-2 text-sm text-ui-muted">
                  <li>Your role and class permissions are enforced by secure server checks.</li>
                  <li>Only classes where you are enrolled are accessible from your dashboard.</li>
                  <li>Use Sign Out from the sidebar on shared devices.</li>
                </ul>
              </Card>

              <Card className="border-amber-200 bg-amber-50 p-6">
                <h2 className="text-lg font-semibold text-amber-800">Data Actions</h2>
                <p className="mt-2 text-sm text-amber-700">
                  Account deletion is not available in this interface yet. Contact your organization
                  owner if formal account removal is required.
                </p>
              </Card>
            </div>
          </section>
      </main>
    </RoleAppShell>
  );
}
