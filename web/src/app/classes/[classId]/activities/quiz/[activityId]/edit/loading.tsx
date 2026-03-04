import { Skeleton } from "@/components/ui/skeleton";

export default function EditQuizDraftLoading() {
  return (
    <div className="min-h-screen surface-page px-6 py-16 text-ui-primary">
      <div className="mx-auto w-full max-w-5xl space-y-4" aria-busy="true">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    </div>
  );
}
