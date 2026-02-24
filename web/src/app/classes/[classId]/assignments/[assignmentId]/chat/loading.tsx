export default function AssignmentChatLoading() {
  return (
    <div className="min-h-screen surface-page text-slate-900">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-16" aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
        <div className="h-10 w-80 animate-pulse rounded bg-slate-200" />
        <div className="h-96 w-full animate-pulse rounded-3xl border border-slate-200 bg-white" />
      </div>
    </div>
  );
}
