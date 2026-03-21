import Link from "next/link";
import DashboardHashRedirect from "@/app/components/DashboardHashRedirect";
import EmptyStateCard from "@/app/components/EmptyStateCard";
import RoleAppShell from "@/app/components/RoleAppShell";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  const ownedClassCount = ownedClasses.length;
  const assistantClassCount = classes.filter((classItem) => classItem.owner_id !== user.id).length;
  const recentClasses = classes
    .filter((classItem) => enrollmentMap.get(classItem.id))
    .slice(0, 3);
  const displayName = profile.display_name?.trim() || user.email || "Teacher";

  timer.end({ classes: classes.length });

  return (
    <RoleAppShell
      accountType="teacher"
      userEmail={user.email ?? undefined}
      userDisplayName={profile.display_name}
    >
      <DashboardHashRedirect classesHref="/teacher/classes" />
      <main className="mx-auto max-w-5xl p-6 pt-16 page-enter">
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                Teacher Dashboard
              </p>
              <h1 className="editorial-title mt-2 text-4xl text-ui-primary">Welcome, {displayName}</h1>
              <p className="mt-2 text-sm text-ui-muted">
                Manage classes, materials, and assignment workflows.
              </p>
            </div>
            <Button asChild variant="warm">
              <Link href="/classes/new">
                <AppIcons.add className="h-4 w-4" />
                Create class
              </Link>
            </Button>
          </header>

          <section className="mt-8 grid gap-4 sm:grid-cols-3">
            <Card className="rounded-2xl p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Total classes</p>
              <p className="mt-3 text-3xl font-semibold text-ui-primary">{classes.length}</p>
              <p className="mt-2 text-sm text-ui-muted">Across all classes where you teach.</p>
            </Card>
            <Card className="rounded-2xl p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Owner classes</p>
              <p className="mt-3 text-3xl font-semibold text-ui-primary">{ownedClassCount}</p>
              <p className="mt-2 text-sm text-ui-muted">Classes you created and manage.</p>
            </Card>
            <Card className="rounded-2xl p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Assistant roles</p>
              <p className="mt-3 text-3xl font-semibold text-ui-primary">{assistantClassCount}</p>
              <p className="mt-2 text-sm text-ui-muted">Classes where you support as teacher or TA.</p>
            </Card>
          </section>

          <section className="mt-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ui-primary">Recent classes</h2>
              <Link href="/teacher/classes" className="text-sm font-semibold text-accent hover:text-accent-strong">
                View all
              </Link>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {recentClasses.length > 0 ? (
                recentClasses.map((classItem) => (
                  <Link
                    key={classItem.id}
                    href={`/classes/${classItem.id}`}
                    className="ui-motion-lift block rounded-2xl border border-default bg-white p-5 shadow-sm hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                      {classItem.owner_id === user.id ? "Teacher" : "TA"}
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-ui-primary">{classItem.title}</h3>
                    <p className="mt-2 text-sm text-ui-muted">
                      {classItem.subject || "General"} · {classItem.level || "Mixed"}
                    </p>
                  </Link>
                ))
              ) : (
                <EmptyStateCard
                  className="md:col-span-3"
                  icon="classes"
                  title="No classes yet"
                  description="Create your first class to start building a blueprint and assigning activities."
                  primaryAction={{ label: "Create class", href: "/classes/new", variant: "default" }}
                />
              )}
            </div>
          </section>
      </main>
    </RoleAppShell>
  );
}
