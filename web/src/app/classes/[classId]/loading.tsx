import { HeaderLoadingScaffold } from "@/app/components/LoadingScaffold";
import { Skeleton } from "@/components/ui/skeleton";

export default function ClassOverviewLoading() {
  return (
    <HeaderLoadingScaffold maxWidthClassName="max-w-5xl">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-96 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-3xl border border-default bg-white p-6">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <Skeleton className="mt-6 h-10 w-44 rounded-xl" />
        </div>
        <div className="rounded-3xl border border-default bg-white p-6">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="mt-3 h-12 w-full rounded-2xl" />
          <Skeleton className="mt-4 h-4 w-full" />
        </div>
      </div>
    </HeaderLoadingScaffold>
  );
}
