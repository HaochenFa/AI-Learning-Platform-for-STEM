import Link from "next/link";
import Sidebar from "@/app/components/Sidebar";
import { requireVerifiedUser } from "@/lib/auth/session";
import { startServerTimer } from "@/lib/perf";

type ClassSummary = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  owner_id: string;
  created_at?: string;
};

export default async function TeacherDashboardPage() {
  const timer = startServerTimer("teacher-dashboard");
  const { supabase, user, profile } = await requireVerifiedUser({ accountType: "teacher" });

  const [ownedClassesResult, teacherEnrollmentsResult] = await Promise.all([
    supabase
      .from("classes")
      .select("id,title,subject,level,owner_id,created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("enrollments")
      .select("class_id,role")
      .eq("user_id", user.id)
      .in("role", ["teacher", "ta"]),
  ]);

  const ownedClasses = ownedClassesResult.data ?? [];
  const teachingEnrollments = teacherEnrollmentsResult.data ?? [];
  const additionalClassIds = teachingEnrollments
    .map((enrollment) => enrollment.class_id)
    .filter((classId) => !ownedClasses.some((item) => item.id === classId));

  const additionalClassesResult =
    additionalClassIds.length > 0
      ? await supabase
          .from("classes")
          .select("id,title,subject,level,owner_id,created_at")
          .in("id", additionalClassIds)
      : { data: [] as ClassSummary[] };

  const classes = [...ownedClasses, ...(additionalClassesResult.data ?? [])].sort((a, b) => {
    const left = a.created_at ? new Date(a.created_at).getTime() : 0;
    const right = b.created_at ? new Date(b.created_at).getTime() : 0;
    return right - left;
  });

  const enrollmentMap = new Map(
    teachingEnrollments.map((enrollment) => [enrollment.class_id, enrollment.role]),
  );
  const displayName = profile.display_name?.trim() || user.email || "Teacher";

  timer.end({ classes: classes.length });

  return (
    <div className="surface-page min-h-screen">
      <Sidebar
        accountType="teacher"
        userEmail={user.email ?? undefined}
        userDisplayName={profile.display_name}
      />
      <div className="sidebar-content">
        <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8e8577]">
                Teacher Dashboard
              </p>
              <h1 className="editorial-title mt-2 text-4xl text-ui-primary">Welcome, {displayName}</h1>
              <p className="mt-2 text-sm text-ui-muted">
                Manage classes, materials, and assignment workflows.
              </p>
            </div>
            <Link
              href="/classes/new"
              className="btn-warm ui-motion-lift rounded-xl px-4 py-2 text-sm font-semibold"
            >
              Create class
            </Link>
          </header>

          <section id="classes" className="mt-8">
            <h2 className="text-lg font-semibold text-ui-primary">Your teaching classes</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {classes.length > 0 ? (
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
                      className="ui-motion-lift group rounded-2xl border border-default bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#cfab8a] hover:shadow-md"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8e8577]">{role}</p>
                      <Link href={`/classes/${classItem.id}`} className="mt-2 block">
                        <h3 className="text-xl font-semibold text-ui-primary">{classItem.title}</h3>
                      </Link>
                      <p className="mt-2 text-sm text-ui-muted">
                        {classItem.subject || "General"} · {classItem.level || "Mixed"}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={`/classes/${classItem.id}`}
                          className="ui-motion-color rounded-full border border-[#ddd3c2] bg-white px-3 py-1 text-xs font-medium text-ui-muted hover:border-[#c8a786] hover:bg-[#f9f3e8] hover:text-[#844633]"
                        >
                          Open class
                        </Link>
                        <Link
                          href={`/classes/${classItem.id}#teacher-chat-monitor`}
                          className="ui-motion-color rounded-full border border-[#ddd3c2] bg-white px-3 py-1 text-xs font-medium text-ui-muted hover:border-[#c8a786] hover:bg-[#f9f3e8] hover:text-[#844633]"
                        >
                          Chat monitor
                        </Link>
                        <Link
                          href={`/classes/${classItem.id}/activities/chat/new`}
                          className="ui-motion-color rounded-full border border-[#d7b79a] bg-[#fdf1eb] px-3 py-1 text-xs font-semibold text-[#8f4934] hover:bg-[#fbe7dd]"
                        >
                          New chat
                        </Link>
                        <Link
                          href={`/classes/${classItem.id}/activities/quiz/new`}
                          className="ui-motion-color rounded-full border border-[#d7b79a] bg-[#fdf1eb] px-3 py-1 text-xs font-semibold text-[#8f4934] hover:bg-[#fbe7dd]"
                        >
                          New quiz
                        </Link>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-default bg-[#f7f2e8] p-6 text-sm text-ui-muted">
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
