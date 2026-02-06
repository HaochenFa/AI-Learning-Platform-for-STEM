export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-white/10 bg-slate-950/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <div className="h-3 w-48 animate-pulse rounded bg-slate-800" />
          <div className="h-8 w-56 animate-pulse rounded-full bg-slate-800" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-16" aria-busy="true">
        <div className="space-y-3">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-800" />
          <div className="h-8 w-80 animate-pulse rounded bg-slate-800" />
          <div className="h-4 w-72 animate-pulse rounded bg-slate-800" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={`dashboard-skeleton-${index}`} className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <div className="h-3 w-20 animate-pulse rounded bg-slate-800" />
              <div className="mt-3 h-6 w-2/3 animate-pulse rounded bg-slate-800" />
              <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
