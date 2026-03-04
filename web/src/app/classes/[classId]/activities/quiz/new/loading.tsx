import { Skeleton } from "@/components/ui/skeleton";

export default function NewQuizDraftLoading() {
  return (
    <div className="min-h-screen surface-page px-6 py-16 text-ui-primary">
      <div className="mx-auto w-full max-w-3xl space-y-4" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-48 rounded-xl" />
      </div>
    </div>
  );
}
