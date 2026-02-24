export default function AssignmentReviewLoading() {
  return (
    <div className="min-h-screen surface-page text-slate-900">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-16" aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
        <div className="h-10 w-80 animate-pulse rounded bg-slate-200" />
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={`review-loading-${index}`}
              className="h-64 w-full animate-pulse rounded-3xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
