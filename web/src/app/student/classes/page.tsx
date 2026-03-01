import Link from "next/link";
import Sidebar from "@/app/components/Sidebar";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireVerifiedUser } from "@/lib/auth/session";
import { startServerTimer } from "@/lib/perf";

export default async function StudentClassesPage() {
  const timer = startServerTimer("student-classes");
  const { supabase, user, profile } = await requireVerifiedUser({ accountType: "student" });

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("class_id,role")
    .eq("user_id", user.id)
    .eq("role", "student");

  const classIds = (enrollments ?? []).map((enrollment) => enrollment.class_id);

  const { data: classes } =
    classIds.length > 0
      ? await supabase
          .from("classes")
          .select("id,title,subject,level,owner_id")
          .in("id", classIds)
          .order("created_at", { ascending: false })
      : { data: [] };

  const displayName = profile.display_name?.trim() || user.email || "Student";
  timer.end({ classes: classes?.length ?? 0 });

  return (
    <div className="surface-page min-h-screen">
      <Sidebar
        accountType="student"
        userEmail={user.email ?? undefined}
        userDisplayName={profile.display_name}
      />
      <div className="sidebar-content">
        <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">My Classes</p>
              <h1 className="editorial-title mt-2 text-4xl text-ui-primary">{displayName}&apos;s classes</h1>
              <p className="mt-2 text-sm text-ui-muted">
                Open class workspaces and continue chats, quizzes, and flashcards.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline">
                <Link href="/student/dashboard">
                  <AppIcons.arrowLeft className="h-4 w-4" />
                  Back to Dashboard
                </Link>
              </Button>
              <Button asChild variant="warm">
                <Link href="/join">
                  <AppIcons.add className="h-4 w-4" />
                  Join class
                </Link>
              </Button>
            </div>
          </header>

          <section className="mt-8">
            <div className="grid gap-4 md:grid-cols-2">
              {classes && classes.length > 0 ? (
                classes.map((classItem) => (
                  <Card
                    key={classItem.id}
                    className="ui-motion-lift group rounded-2xl p-6 transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Student</p>
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
                        <Link href={`/classes/${classItem.id}?view=chat`}>Open AI chat</Link>
                      </Button>
                    </div>
                  </Card>
                ))
              ) : (
                <Card className="rounded-2xl border-dashed bg-[var(--surface-muted)] p-6 text-sm text-ui-muted md:col-span-2">
                  No classes joined yet. Use a join code from your teacher.
                </Card>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
