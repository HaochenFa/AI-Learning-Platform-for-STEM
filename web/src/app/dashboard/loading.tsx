import { HeaderLoadingScaffold } from "@/app/components/LoadingScaffold";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <HeaderLoadingScaffold maxWidthClassName="max-w-6xl">
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`dashboard-skeleton-${index}`}
            className="rounded-3xl border border-default bg-white p-6"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-2/3" />
            <Skeleton className="mt-3 h-4 w-1/2" />
          </div>
        ))}
      </div>
    </HeaderLoadingScaffold>
  );
}
