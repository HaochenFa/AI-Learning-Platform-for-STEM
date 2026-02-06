export default function ClassOverviewLoading() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-white/10 bg-slate-950/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <div className="h-3 w-52 animate-pulse rounded bg-slate-800" />
          <div className="h-8 w-64 animate-pulse rounded-full bg-slate-800" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-16" aria-busy="true">
        <div className="space-y-3">
          <div className="h-3 w-28 animate-pulse rounded bg-slate-800" />
          <div className="h-8 w-96 animate-pulse rounded bg-slate-800" />
          <div className="h-4 w-64 animate-pulse rounded bg-slate-800" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <div className="h-6 w-44 animate-pulse rounded bg-slate-800" />
            <div className="mt-3 h-4 w-full animate-pulse rounded bg-slate-800" />
            <div className="mt-2 h-4 w-5/6 animate-pulse rounded bg-slate-800" />
            <div className="mt-6 h-10 w-44 animate-pulse rounded-xl bg-slate-800" />
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <div className="h-6 w-36 animate-pulse rounded bg-slate-800" />
            <div className="mt-3 h-12 w-full animate-pulse rounded-2xl bg-slate-800" />
            <div className="mt-4 h-4 w-full animate-pulse rounded bg-slate-800" />
          </div>
        </div>
      </div>
    </div>
  );
}
