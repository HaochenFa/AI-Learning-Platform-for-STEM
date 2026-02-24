export default function BlueprintLoading() {
  return (
    <div className="min-h-screen surface-page text-ui-primary">
      <div className="border-b border-default bg-white/90">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <div className="h-3 w-56 animate-pulse rounded bg-[var(--border-default)]" />
          <div className="h-8 w-64 animate-pulse rounded-full bg-[var(--border-default)]" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-16" aria-busy="true">
        <div className="space-y-3">
          <div className="h-3 w-36 animate-pulse rounded bg-[var(--border-default)]" />
          <div className="h-8 w-96 animate-pulse rounded bg-[var(--border-default)]" />
          <div className="h-4 w-64 animate-pulse rounded bg-[var(--border-default)]" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-default bg-white p-6 lg:col-span-2">
            <div className="h-6 w-56 animate-pulse rounded bg-[var(--border-default)]" />
            <div className="mt-3 h-4 w-full animate-pulse rounded bg-[var(--border-default)]" />
          </div>
          <div className="rounded-3xl border border-default bg-white p-6">
            <div className="h-6 w-36 animate-pulse rounded bg-[var(--border-default)]" />
            <div className="mt-3 h-4 w-full animate-pulse rounded bg-[var(--border-default)]" />
            <div className="mt-6 h-10 w-full animate-pulse rounded-xl bg-[var(--border-default)]" />
          </div>
        </div>
        <div className="rounded-3xl border border-default bg-white p-6">
          <div className="h-6 w-28 animate-pulse rounded bg-[var(--border-default)]" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`blueprint-topic-skeleton-${index}`}
                className="rounded-2xl border border-default bg-[var(--surface-muted)] p-4"
              >
                <div className="h-5 w-40 animate-pulse rounded bg-[var(--border-default)]" />
                <div className="mt-3 h-4 w-full animate-pulse rounded bg-[var(--border-default)]" />
                <div className="mt-2 h-4 w-5/6 animate-pulse rounded bg-[var(--border-default)]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
