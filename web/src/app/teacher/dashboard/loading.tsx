export default function TeacherDashboardLoading() {
  return (
    <div className="surface-page min-h-screen">
      <div className="fixed left-0 top-0 h-screen w-[var(--sidebar-width)] border-r border-slate-200 bg-white">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <div className="h-6 w-16 animate-pulse rounded bg-slate-200" />
          <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200" />
        </div>
        <div className="space-y-1 px-2 py-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
      <div className="sidebar-content">
        <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
              <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-96 animate-pulse rounded bg-slate-200" />
            </div>
            <div className="h-10 w-32 animate-pulse rounded-xl bg-slate-200" />
          </header>

          <section className="mt-8">
            <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-slate-200 bg-white p-6">
                  <div className="h-3 w-12 animate-pulse rounded bg-slate-200" />
                  <div className="mt-2 h-6 w-3/4 animate-pulse rounded bg-slate-200" />
                  <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                  <div className="mt-4 flex gap-2">
                    <div className="h-6 w-20 animate-pulse rounded-full bg-slate-200" />
                    <div className="h-6 w-20 animate-pulse rounded-full bg-slate-200" />
                    <div className="h-6 w-16 animate-pulse rounded-full bg-slate-200" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
