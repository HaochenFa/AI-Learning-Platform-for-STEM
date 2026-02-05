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
      <AuthHeader />
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-16">
        <header className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Dashboard</p>
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
              classes.map((classItem) => (
                <Link
                  key={classItem.id}
                  href={`/classes/${classItem.id}`}
                  className="group rounded-3xl border border-white/10 bg-slate-900/60 p-6 transition hover:border-cyan-400/40"
                >
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                    {classItem.owner_id === user.id
                      ? "Teacher"
                      : enrollmentMap.get(classItem.id) === "ta"
                        ? "TA"
                        : "Student"}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold group-hover:text-cyan-200">
                    {classItem.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-400">
                    {classItem.subject || "STEM"} · {classItem.level || "Mixed"}
                  </p>
                </Link>
              ))
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
