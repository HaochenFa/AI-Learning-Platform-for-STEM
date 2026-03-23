import { HeaderLoadingScaffold } from "@/app/components/LoadingScaffold";
import { Skeleton } from "@/components/ui/skeleton";

/** Reusable skeleton for assignment section cards (Chat, Quizzes, Flashcards) */
function AssignmentSectionSkeleton({
  titleWidth,
  id,
}: {
  titleWidth: string;
  id: string;
}) {
  return (
    <div className="rounded-3xl border border-default bg-[var(--surface-card,white)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className={`h-5 ${titleWidth}`} />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-36 rounded-xl" />
      </div>
      <div className="mt-5 space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={`${id}-${i}`} className="h-14 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export default function ClassOverviewLoading() {
  return (
    <HeaderLoadingScaffold maxWidthClassName="max-w-5xl">
      {/* Hero header card */}
      <div className="flex flex-col justify-between gap-4 rounded-[2rem] border border-default bg-[var(--surface-card,white)] px-7 py-6 sm:flex-row sm:items-center">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-36 rounded-xl" />
      </div>

      {/* 3-col stats strip */}
      <div className="grid gap-3 sm:grid-cols-3 stagger-children">
        {/* Blueprint */}
        <div className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="mt-3 h-4 w-28" />
        </div>
        {/* Assignments — with per-type pill skeletons */}
        <div className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="mt-3 h-4 w-16" />
          <div className="mt-1.5 flex gap-1.5">
            <Skeleton className="h-4 w-12 rounded-full" />
            <Skeleton className="h-4 w-10 rounded-full" />
            <Skeleton className="h-4 w-10 rounded-full" />
          </div>
        </div>
        {/* Materials */}
        <div className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="mt-3 h-4 w-20" />
        </div>
      </div>

      {/* Blueprint + Enrollment 2-col */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-3xl border border-default bg-[var(--surface-card,white)] p-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-5/6" />
          <Skeleton className="mt-6 h-9 w-40 rounded-xl" />
        </div>
        <div className="rounded-3xl border border-default bg-[var(--surface-card,white)] p-6">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="mt-3 h-12 w-full rounded-2xl" />
          <Skeleton className="mt-4 h-4 w-full" />
        </div>
      </div>

      {/* AI Chat section */}
      <div className="rounded-3xl border border-default bg-[var(--surface-card,white)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28 rounded-xl" />
            <Skeleton className="h-9 w-40 rounded-xl" />
          </div>
        </div>
        <div className="mt-5 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={`chat-${i}`} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      </div>

      {/* Quizzes section */}
      <AssignmentSectionSkeleton titleWidth="w-16" id="quiz" />

      {/* Flashcards section */}
      <AssignmentSectionSkeleton titleWidth="w-24" id="flashcards" />

      {/* Materials section — 3-col grid (upload + library) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-default bg-[var(--surface-card,white)] p-6 lg:col-span-1">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="mt-2 h-4 w-44" />
          <Skeleton className="mt-5 h-24 w-full rounded-2xl" />
          <Skeleton className="mt-4 h-9 w-24 rounded-xl" />
        </div>
        <div className="rounded-3xl border border-default bg-[var(--surface-card,white)] p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={`material-${i}`} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </HeaderLoadingScaffold>
  );
}
