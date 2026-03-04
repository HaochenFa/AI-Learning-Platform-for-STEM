import { Skeleton } from "@/components/ui/skeleton";

export default function AssignmentReviewLoading() {
  return (
    <div className="min-h-screen surface-page text-ui-primary">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-16" aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-80 max-w-full rounded-xl" />
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton
              key={`review-loading-${index}`}
              className="h-64 w-full rounded-3xl border border-default bg-white"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
