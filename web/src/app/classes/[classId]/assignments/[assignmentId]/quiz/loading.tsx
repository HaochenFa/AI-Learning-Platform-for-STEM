import { Skeleton } from "@/components/ui/skeleton";

export default function QuizAssignmentLoading() {
  return (
    <div className="min-h-screen surface-page px-6 py-16 text-ui-primary">
      <div className="mx-auto w-full max-w-5xl space-y-4" aria-busy="true">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>
    </div>
  );
}
