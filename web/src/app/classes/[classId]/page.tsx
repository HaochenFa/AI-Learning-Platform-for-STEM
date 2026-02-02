import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function ClassOverviewPage({
  params,
}: {
  params: { classId: string };
}) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: classRow } = await supabase
    .from("classes")
    .select("id,title,description,subject,level,join_code,owner_id")
    .eq("id", params.classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", params.classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id ||
    enrollment?.role === "teacher" ||
    enrollment?.role === "ta";

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
      </div>
    </div>
  );
}
