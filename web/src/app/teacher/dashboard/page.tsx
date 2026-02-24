import Link from "next/link";
import Sidebar from "@/app/components/Sidebar";
import { requireVerifiedUser } from "@/lib/auth/session";

export default async function TeacherDashboardPage() {
  const { supabase, user } = await requireVerifiedUser({ accountType: "teacher" });

  const [classesResult, enrollmentsResult] = await Promise.all([
    supabase
      .from("classes")
      .select("id,title,subject,level,owner_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("enrollments")
      .select("class_id,role")
      .eq("user_id", user.id),
  ]);

  const classes = classesResult.data;
  const enrollments = enrollmentsResult.data;

  const enrollmentMap = new Map(
    enrollments?.map((enrollment) => [enrollment.class_id, enrollment.role]) ?? [],
  );

  return (
    <div className="surface-page min-h-screen">
      <Sidebar accountType="teacher" userEmail={user.email ?? undefined} />
      <div className="sidebar-content">
        <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-slate-500">Teacher Dashboard</p>
              <h1 className="text-3xl font-semibold text-slate-900">Welcome, {user.email}</h1>
              <p className="mt-1 text-sm text-slate-600">
                Manage classes, materials, and assignment workflows.
              </p>
            </div>
            <Link
              href="/classes/new"
              className="btn-secondary rounded-xl px-4 py-2 text-sm font-semibold"
            >
              Create class
            </Link>
          </header>

          <section id="classes" className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">Your teaching classes</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {classes && classes.length > 0 ? (
                classes.map((classItem) => {
                  const enrollmentRole = enrollmentMap.get(classItem.id);
                  const role =
                    classItem.owner_id === user.id
                      ? "Teacher"
                      : enrollmentRole === "teacher"
                        ? "Teacher"
                        : enrollmentRole === "ta"
                          ? "TA"
                          : null;
                  if (!role) {
                    return null;
                  }

                  return (
                    <div
                      key={classItem.id}
                      className="ui-motion-lift group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md"
                    >
                      <p className="text-xs font-medium text-slate-500">{role}</p>
                      <Link href={`/classes/${classItem.id}`} className="mt-2 block">
                        <h3 className="text-xl font-semibold text-slate-900">{classItem.title}</h3>
                      </Link>
                      <p className="mt-2 text-sm text-slate-500">
                        {classItem.subject || "STEM"} · {classItem.level || "Mixed"}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={`/classes/${classItem.id}`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 hover:border-cyan-300 hover:text-cyan-700"
                        >
                          Open class
                        </Link>
                        <Link
                          href={`/classes/${classItem.id}#teacher-chat-monitor`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 hover:border-cyan-300 hover:text-cyan-700"
                        >
                          Chat monitor
                        </Link>
                        <Link
                          href={`/classes/${classItem.id}/activities/chat/new`}
                          className="rounded-full border border-cyan-300 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700 hover:border-cyan-400 hover:bg-cyan-100"
                        >
                          New chat
                        </Link>
                        <Link
                          href={`/classes/${classItem.id}/activities/quiz/new`}
                          className="rounded-full border border-cyan-300 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700 hover:border-cyan-400 hover:bg-cyan-100"
                        >
                          New quiz
                        </Link>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                  No classes yet. Create one to get started.
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
