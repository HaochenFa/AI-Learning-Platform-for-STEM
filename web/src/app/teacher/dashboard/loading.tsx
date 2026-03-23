import { SidebarLoadingScaffold } from "@/app/components/LoadingScaffold";
import { Skeleton } from "@/components/ui/skeleton";

export default function TeacherDashboardLoading() {
  return (
    <SidebarLoadingScaffold maxWidthClassName="max-w-5xl">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </header>

      {/* Stats — 3 col */}
      <section className="mt-8 grid gap-4 sm:grid-cols-3 stagger-children">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`stat-${i}`}
            className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-5"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="mt-4 h-8 w-12" />
            <Skeleton className="mt-1.5 h-3 w-40 max-w-full" />
          </div>
        ))}
      </section>

      {/* Quick actions — 3 col */}
      <section className="mt-8">
        <Skeleton className="h-3 w-28" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={`action-${i}`}
              className="flex items-center gap-3 rounded-2xl border border-default bg-[var(--surface-card,white)] p-4"
            >
              <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-32 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent classes — 3 col */}
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={`class-${i}`}
              className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-4 w-4/5" />
              <Skeleton className="mt-1.5 h-3 w-1/2" />
            </div>
          ))}
        </div>
      </section>
    </SidebarLoadingScaffold>
  );
}
