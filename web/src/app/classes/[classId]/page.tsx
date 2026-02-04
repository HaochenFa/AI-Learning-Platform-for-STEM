import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uploadMaterial } from "@/app/classes/actions";

export const dynamic = "force-dynamic";

type SearchParams = {
  error?: string;
  uploaded?: string;
};

export default async function ClassOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { classId } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: classRow } = await supabase
    .from("classes")
    .select("id,title,description,subject,level,join_code,owner_id")
    .eq("id", classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id ||
    enrollment?.role === "teacher" ||
    enrollment?.role === "ta";

  const { data: materials } = isTeacher
    ? await supabase
        .from("materials")
        .select("id,title,status,created_at,mime_type,size_bytes")
        .eq("class_id", classId)
        .order("created_at", { ascending: false })
    : { data: null };

  const { data: publishedBlueprint } = await supabase
    .from("blueprints")
    .select("id,version")
    .eq("class_id", classId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const errorMessage =
    typeof resolvedSearchParams?.error === "string"
      ? resolvedSearchParams.error
      : null;
  const uploadNotice =
    resolvedSearchParams?.uploaded === "1"
      ? "Material uploaded and processed."
      : resolvedSearchParams?.uploaded === "vision"
        ? "Material uploaded. Vision extraction required."
        : resolvedSearchParams?.uploaded === "failed"
          ? "Material uploaded, but extraction failed."
          : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <header className="mb-10 space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Class Overview
          </p>
          <h1 className="text-3xl font-semibold">{classRow.title}</h1>
          <p className="text-sm text-slate-400">
            {classRow.subject || "STEM"} · {classRow.level || "Mixed level"}
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {uploadNotice ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {uploadNotice}
          </div>
        ) : null}

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">Course blueprint</h2>
            <p className="mt-2 text-sm text-slate-400">
              Generate a structured blueprint from uploaded materials to unlock
              AI activities.
            </p>
            <Link
              href={`/classes/${classRow.id}/blueprint`}
              className="mt-6 inline-flex rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
            >
              Open blueprint studio
            </Link>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">Enrollment</h2>
            {isTeacher ? (
              <div className="mt-3 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-200">
                Join code: <span className="font-semibold">{classRow.join_code}</span>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                You are enrolled in this class.
              </p>
            )}
            <p className="mt-4 text-sm text-slate-400">
              {classRow.description ||
                "Add a class description and upload materials to begin."}
            </p>
          </div>
        </section>

        {isTeacher ? (
          <section className="mt-10 grid gap-6 lg:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 lg:col-span-1">
              <h2 className="text-lg font-semibold">Upload materials</h2>
              <p className="mt-2 text-sm text-slate-400">
                Supported formats: PDF, DOCX, PPTX. Images require vision extraction.
              </p>
              <form
                className="mt-6 space-y-4"
                action={uploadMaterial.bind(null, classRow.id)}
              >
                <div className="space-y-2">
                  <label className="text-sm text-slate-300" htmlFor="title">
                    Title
                  </label>
                  <input
                    id="title"
                    name="title"
                    placeholder="Lecture 3: Limits and Continuity"
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-300" htmlFor="file">
                    File
                  </label>
                  <input
                    id="file"
                    name="file"
                    type="file"
                    accept=".pdf,.docx,.pptx,image/*"
                    required
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2 text-sm text-slate-100 file:mr-4 file:rounded-full file:border-0 file:bg-cyan-400/90 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  Upload material
                </button>
              </form>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Materials library</h2>
                <span className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  {materials?.length ?? 0} items
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {materials && materials.length > 0 ? (
                  materials.map((material) => (
                    <div
                      key={material.id}
                      className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{material.title}</p>
                        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                          {material.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {material.mime_type || "unknown type"} ·{" "}
                        {material.size_bytes
                          ? `${Math.round(material.size_bytes / 1024)} KB`
                          : "size unknown"}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                    No materials yet. Upload materials to begin blueprint generation.
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <h2 className="text-lg font-semibold">Student hub</h2>
              <p className="mt-2 text-sm text-slate-400">
                Your assignments and practice activities will appear here once the
                blueprint is published.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <h2 className="text-lg font-semibold">Blueprint status</h2>
              {publishedBlueprint ? (
                <>
                  <p className="mt-2 text-sm text-slate-400">
                    The latest blueprint is published and ready.
                  </p>
                  <Link
                    href={`/classes/${classRow.id}/blueprint/published`}
                    className="mt-4 inline-flex rounded-xl border border-cyan-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200"
                  >
                    View published blueprint
                  </Link>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-400">
                  Awaiting teacher approval. Check back soon for AI powered
                  activities.
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
