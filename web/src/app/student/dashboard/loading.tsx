import { SidebarLoadingScaffold } from "@/app/components/LoadingScaffold";
import { Skeleton } from "@/components/ui/skeleton";

export default function StudentDashboardLoading() {
  return (
    <SidebarLoadingScaffold maxWidthClassName="max-w-5xl">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-28 rounded-xl" />
      </header>

      {/* Progress metrics — 3 col */}
      <section className="mt-8">
        <Skeleton className="h-3 w-28" />
        <div className="mt-3 grid grid-cols-3 gap-4 stagger-children">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={`metric-${i}`}
              className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-4"
            >
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-6 w-8" />
              </div>
              <Skeleton className="mt-2 h-3.5 w-24 max-w-full" />
            </div>
          ))}
        </div>
      </section>

      {/* Due Now assignments */}
      <section className="mt-6">
        <Skeleton className="mb-3 h-3 w-20" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={`assignment-${i}`}
              className="flex items-center justify-between rounded-xl border border-default bg-[var(--surface-card,white)] p-3"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-40 max-w-full" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
              <Skeleton className="h-3.5 w-20 shrink-0" />
            </div>
          ))}
        </div>
      </section>

      {/* My Classes card */}
      <div className="mt-8 rounded-2xl border border-default bg-[var(--surface-card,white)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-32 rounded-lg" />
          </div>
        </div>
      </div>
    </SidebarLoadingScaffold>
  );
}
