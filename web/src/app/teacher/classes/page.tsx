import Link from "next/link";
import Sidebar from "@/app/components/Sidebar";
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

export default async function TeacherClassesPage() {
  const timer = startServerTimer("teacher-classes");
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
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">My Classes</p>
              <h1 className="editorial-title mt-2 text-4xl text-ui-primary">{displayName}&apos;s teaching hub</h1>
              <p className="mt-2 text-sm text-ui-muted">
                Open classes, monitor chat activity, and create new assignments.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline">
                <Link href="/teacher/dashboard">
                  <AppIcons.arrowLeft className="h-4 w-4" />
                  Back to Dashboard
                </Link>
              </Button>
              <Button asChild variant="warm">
                <Link href="/classes/new">
                  <AppIcons.add className="h-4 w-4" />
                  Create class
                </Link>
              </Button>
            </div>
          </header>

          <section className="mt-8">
            <div className="grid gap-4 md:grid-cols-2">
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
                    <Card
                      key={classItem.id}
                      className="ui-motion-lift group rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">{role}</p>
                      <Link href={`/classes/${classItem.id}`} className="mt-2 block">
                        <h2 className="text-xl font-semibold text-ui-primary">{classItem.title}</h2>
                      </Link>
                      <p className="mt-2 text-sm text-ui-muted">
                        {classItem.subject || "General"} · {classItem.level || "Mixed"}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/classes/${classItem.id}`}>Open class</Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/classes/${classItem.id}#teacher-chat-monitor`}>Chat monitor</Link>
                        </Button>
                        <Button asChild variant="default" size="sm">
                          <Link href={`/classes/${classItem.id}/activities/chat/new`}>New chat</Link>
                        </Button>
                        <Button asChild variant="default" size="sm">
                          <Link href={`/classes/${classItem.id}/activities/quiz/new`}>New quiz</Link>
                        </Button>
                      </div>
                    </Card>
                  );
                })
              ) : (
                <Card className="rounded-2xl border-dashed bg-[var(--surface-muted)] p-6 text-sm text-ui-muted md:col-span-2">
                  No classes yet. Create one to get started.
                </Card>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
