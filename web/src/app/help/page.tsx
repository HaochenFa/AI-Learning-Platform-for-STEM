import Sidebar from "@/app/components/Sidebar";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getHelpContent } from "@/lib/content/help";

export default async function HelpPage() {
  const { accountType, user, profile } = await requireVerifiedUser();
  const content = getHelpContent(accountType);

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
            <p className="text-sm font-medium text-ui-muted">Help Center</p>
            <h1 className="text-3xl font-semibold text-ui-primary">Help & FAQ</h1>
            <p className="text-sm text-ui-muted">
              Verified guidance based on currently available product functionality.
            </p>
          </header>

          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-default bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-ui-primary">Frequently Asked Questions</h2>
              <div className="mt-6 space-y-6">
                {content.faq.map((item) => (
                  <div key={item.question}>
                    <h3 className="text-sm font-semibold text-ui-primary">{item.question}</h3>
                    <p className="mt-2 text-sm text-ui-muted">{item.answer}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-default bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-ui-primary">What To Do Now</h2>
                <p className="mt-2 text-sm text-ui-muted">
                  Recommended next steps for your {accountType} workflow.
                </p>
                <ul className="mt-4 space-y-3 text-sm text-ui-subtle">
                  {content.checklist.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent-strong" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-3xl border border-default bg-[var(--surface-muted)] p-6">
                <h2 className="text-lg font-semibold text-ui-primary">Support Scope</h2>
                <p className="mt-2 text-sm text-ui-muted">
                  Account profile rename and password change are available in Settings. For
                  organization-level actions such as account removal, contact your administrator.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
