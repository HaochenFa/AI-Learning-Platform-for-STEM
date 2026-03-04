import { SidebarLoadingScaffold } from "@/app/components/LoadingScaffold";
import { Skeleton } from "@/components/ui/skeleton";

export default function StudentDashboardLoading() {
  return (
    <SidebarLoadingScaffold maxWidthClassName="max-w-5xl">
      <header className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </header>

      <section className="mt-8">
        <Skeleton className="h-6 w-40" />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`student-dashboard-progress-${i}`} className="rounded-2xl border border-default bg-white p-6">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="mt-2 h-6 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <Skeleton className="h-6 w-48" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`student-dashboard-assignment-${i}`} className="flex items-center justify-between rounded-xl border border-default bg-white p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          ))}
        </div>
      </section>
    </SidebarLoadingScaffold>
  );
}
