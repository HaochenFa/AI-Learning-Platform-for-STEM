export default function NewQuizDraftLoading() {
  return (
    <div className="min-h-screen surface-page px-6 py-16 text-ui-primary">
      <div className="mx-auto w-full max-w-3xl animate-pulse space-y-4">
        <div className="h-6 w-40 rounded bg-white/10" />
        <div className="h-10 w-full rounded bg-white/10" />
        <div className="h-10 w-full rounded bg-white/10" />
        <div className="h-10 w-48 rounded bg-accent-soft" />
      </div>
    </div>
  );
}
