import Sidebar from "@/app/components/Sidebar";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getHelpContent } from "@/lib/content/help";

export default async function HelpPage() {
  const { accountType, user } = await requireVerifiedUser();
  const content = getHelpContent(accountType);

  return (
    <div className="surface-page min-h-screen">
      <Sidebar accountType={accountType} userEmail={user.email ?? undefined} />
      <div className="sidebar-content">
        <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="mb-8 space-y-2">
            <p className="text-sm font-medium text-slate-500">Help Center</p>
            <h1 className="text-3xl font-semibold text-slate-900">Help & FAQ</h1>
            <p className="text-sm text-slate-600">
              Verified guidance based on currently available product functionality.
            </p>
          </header>

          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Frequently Asked Questions</h2>
              <div className="mt-6 space-y-6">
                {content.faq.map((item) => (
                  <div key={item.question}>
                    <h3 className="text-sm font-semibold text-slate-900">{item.question}</h3>
                    <p className="mt-2 text-sm text-slate-600">{item.answer}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">What To Do Now</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Recommended next steps for your {accountType} workflow.
                </p>
                <ul className="mt-4 space-y-3 text-sm text-slate-700">
                  {content.checklist.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                <h2 className="text-lg font-semibold text-slate-900">Support Scope</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Account profile and role details are available in Settings. Password and advanced
                  authentication flows are managed by your sign-in provider.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
