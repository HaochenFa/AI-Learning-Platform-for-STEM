import { HeaderLoadingScaffold } from "@/app/components/LoadingScaffold";
import { Skeleton } from "@/components/ui/skeleton";

export default function BlueprintLoading() {
  return (
    <HeaderLoadingScaffold maxWidthClassName="max-w-6xl">
      <div className="space-y-3">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-8 w-96 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-default bg-white p-6 lg:col-span-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mt-3 h-4 w-full" />
        </div>
        <div className="rounded-3xl border border-default bg-white p-6">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-6 h-10 w-full rounded-xl" />
        </div>
      </div>
      <div className="rounded-3xl border border-default bg-white p-6">
        <Skeleton className="h-6 w-28" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`blueprint-topic-skeleton-${index}`}
              className="rounded-2xl border border-default bg-[var(--surface-muted)] p-4"
            >
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </HeaderLoadingScaffold>
  );
}
