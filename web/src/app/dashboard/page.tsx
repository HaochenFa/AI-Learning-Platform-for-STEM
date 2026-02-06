import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import AuthHeader from "@/app/components/AuthHeader";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: classes } = await supabase
    .from("classes")
    .select("id,title,subject,level,owner_id")
    .order("created_at", { ascending: false });

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("class_id,role")
    .eq("user_id", user.id);

  const enrollmentMap = new Map(
    enrollments?.map((enrollment) => [enrollment.class_id, enrollment.role]) ?? [],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AuthHeader activeNav="dashboard" />
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-16">
        <header className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-slate-400">Dashboard</p>
            <h1 className="text-3xl font-semibold">Welcome, {user.email}</h1>
            <p className="text-sm text-slate-400">
              Manage classes, materials, and student assignments.
            </p>
          </div>
        </header>

        <section>
          <h2 className="text-lg font-semibold">Your classes</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {classes && classes.length > 0 ? (
              classes.map((classItem) => {
                const role =
                  classItem.owner_id === user.id
                    ? "Teacher"
                    : enrollmentMap.get(classItem.id) === "ta"
                      ? "TA"
                      : "Student";
                const isTeacher = role === "Teacher" || role === "TA";

                return (
                  <div
                    key={classItem.id}
                    className="ui-motion-lift group rounded-3xl border border-white/10 bg-slate-900/60 p-6 hover:-translate-y-0.5 hover:border-cyan-400/40"
                  >
                    <p className="text-xs font-medium text-slate-400">{role}</p>
                    <Link href={`/classes/${classItem.id}`} className="mt-2 block">
                      <h3 className="text-xl font-semibold group-hover:text-cyan-200">
                        {classItem.title}
                      </h3>
                    </Link>
                    <p className="mt-2 text-sm text-slate-400">
                      {classItem.subject || "STEM"} · {classItem.level || "Mixed"}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={`/classes/${classItem.id}`}
                        className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:border-white/30 hover:bg-white/5"
                      >
                        Open class
                      </Link>
                      <Link
                        href={`/classes/${classItem.id}/chat`}
                        className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:border-white/30 hover:bg-white/5"
                      >
                        Open chat
                      </Link>
                      {isTeacher ? (
                        <Link
                          href={`/classes/${classItem.id}/activities/chat/new`}
                          className="rounded-full border border-cyan-400/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-400/10"
                        >
                          New chat assignment
                        </Link>
                      ) : null}
                      {isTeacher ? (
                        <Link
                          href={`/classes/${classItem.id}/activities/quiz/new`}
                          className="rounded-full border border-cyan-400/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-400/10"
                        >
                          New quiz draft
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/40 p-6 text-sm text-slate-400">
                No classes yet. Create one or join with a code.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
