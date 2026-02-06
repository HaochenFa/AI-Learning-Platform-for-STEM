export default function NewQuizDraftLoading() {
  return (
    <div className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <div className="mx-auto w-full max-w-3xl animate-pulse space-y-4">
        <div className="h-6 w-40 rounded bg-white/10" />
        <div className="h-10 w-full rounded bg-white/10" />
        <div className="h-10 w-full rounded bg-white/10" />
        <div className="h-10 w-48 rounded bg-cyan-400/30" />
      </div>
    </div>
  );
}
