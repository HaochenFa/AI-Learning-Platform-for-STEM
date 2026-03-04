import Link from "next/link";
import DashboardHashRedirect from "@/app/components/DashboardHashRedirect";
import RoleAppShell from "@/app/components/RoleAppShell";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireVerifiedUser } from "@/lib/auth/session";
import { startServerTimer } from "@/lib/perf";

type AssignmentWithMeta = {
  id: string;
  classId: string;
  classTitle: string;
  activityTitle: string;
  activityType: string;
  dueAt: string | null;
  status: string;
};

function categorizeAssignments(assignments: AssignmentWithMeta[]) {
  const now = new Date();
  const current: AssignmentWithMeta[] = [];
  const upcoming: AssignmentWithMeta[] = [];
  const completed: AssignmentWithMeta[] = [];
  const overdue: AssignmentWithMeta[] = [];

  for (const assignment of assignments) {
    if (assignment.status === "reviewed" || assignment.status === "submitted") {
      completed.push(assignment);
    } else if (assignment.dueAt) {
      const dueDate = new Date(assignment.dueAt);
      if (dueDate < now) {
        overdue.push(assignment);
      } else {
        const daysUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        if (daysUntilDue <= 3) {
          current.push(assignment);
        } else {
          upcoming.push(assignment);
        }
      }
    } else {
      current.push(assignment);
    }
  }

  return { current: [...current, ...overdue], upcoming, completed };
}

function formatDueDate(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${date.toLocaleDateString()}`;
}

function getActivityIcon(type: string) {
  if (type === "chat") return AppIcons.chat;
  if (type === "quiz") return AppIcons.quiz;
  return AppIcons.flashcards;
}

export default async function StudentDashboardPage() {
  const timer = startServerTimer("student-dashboard");
  const { supabase, user, profile } = await requireVerifiedUser({ accountType: "student" });

  const [enrollmentsResult, recipientsResult] = await Promise.all([
    supabase
      .from("enrollments")
      .select("class_id,role")
      .eq("user_id", user.id)
      .eq("role", "student"),
    supabase
      .from("assignment_recipients")
      .select("assignment_id,status,assigned_at")
      .eq("student_id", user.id)
      .order("assigned_at", { ascending: false })
      .limit(20),
  ]);

  const enrollments = enrollmentsResult.data;
  const recipients = recipientsResult.data;
  const classIds = (enrollments ?? []).map((enrollment) => enrollment.class_id);
  const { data: classes } =
    classIds.length > 0
      ? await supabase
          .from("classes")
          .select("id,title,subject,level,owner_id")
          .in("id", classIds)
          .order("created_at", { ascending: false })
      : { data: [] };

  const assignmentIds = (recipients ?? []).map((r) => r.assignment_id);

  const { data: assignments } =
    assignmentIds.length > 0
      ? await supabase
          .from("assignments")
          .select("id,activity_id,due_at,class_id")
          .in("id", assignmentIds)
      : { data: null };

  const activityIds = (assignments ?? []).map((a) => a.activity_id);

  const { data: activities } =
    activityIds.length > 0
      ? await supabase.from("activities").select("id,title,type").in("id", activityIds)
      : { data: null };

  const activityMap = new Map((activities ?? []).map((a) => [a.id, a]));
  const classMap = new Map((classes ?? []).map((c) => [c.id, c]));
  const recipientMap = new Map(recipients?.map((r) => [r.assignment_id, r]) ?? []);

  const allAssignments: AssignmentWithMeta[] = (assignments ?? [])
    .map((assignment) => {
      const activity = activityMap.get(assignment.activity_id);
      const classItem = classMap.get(assignment.class_id);
      const recipient = recipientMap.get(assignment.id);
      if (!activity || !classItem || !recipient) return null;

      return {
        id: assignment.id,
        classId: assignment.class_id,
        classTitle: classItem.title,
        activityTitle: activity.title,
        activityType: activity.type,
        dueAt: assignment.due_at,
        status: recipient.status,
      };
    })
    .filter((a): a is AssignmentWithMeta => a !== null);

  const { current, upcoming, completed } = categorizeAssignments(allAssignments);

  const displayName = profile.display_name?.trim() || user.email || "Student";
  timer.end({ classes: classes?.length ?? 0, assignments: allAssignments.length });

  return (
    <RoleAppShell
      accountType="student"
      userEmail={user.email ?? undefined}
      userDisplayName={profile.display_name}
    >
      <DashboardHashRedirect classesHref="/student/classes" />
      <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                Student Dashboard
              </p>
              <h1 className="editorial-title mt-2 text-4xl text-ui-primary">Welcome, {displayName}</h1>
              <p className="mt-2 text-sm text-ui-muted">
                Join classes and complete your assignments in one place.
              </p>
            </div>
            <Button asChild variant="warm">
              <Link href="/join">
                <AppIcons.add className="h-4 w-4" />
                Join class
              </Link>
            </Button>
          </header>

          {(current.length > 0 || upcoming.length > 0 || completed.length > 0) && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-ui-primary">Your Progress</h2>
              <div className="mt-4 grid grid-cols-3 gap-4">
                <Card className="rounded-2xl bg-accent-soft p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <AppIcons.clock className="h-4 w-4" />
                    </div>
                    <span className="text-2xl font-bold text-accent">{current.length}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-accent">Due Now</p>
                </Card>
                <Card className="rounded-2xl bg-[var(--surface-muted)] p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-ui-muted">
                      <AppIcons.calendar className="h-4 w-4" />
                    </div>
                    <span className="text-2xl font-bold text-ui-primary">{upcoming.length}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-ui-muted">Upcoming</p>
                </Card>
                <Card className="rounded-2xl bg-[var(--surface-muted)] p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-ui-muted">
                      <AppIcons.success className="h-4 w-4" />
                    </div>
                    <span className="text-2xl font-bold text-ui-primary">{completed.length}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-ui-muted">Completed</p>
                </Card>
              </div>

              {current.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-accent">
                    Due Now
                  </h3>
                  <div className="space-y-2">
                    {current.slice(0, 3).map((assignment) => {
                      const ActivityIcon = getActivityIcon(assignment.activityType);
                      return (
                        <Link
                          key={assignment.id}
                          href={`/classes/${assignment.classId}/assignments/${assignment.id}/${assignment.activityType}`}
                          className="ui-motion-lift flex items-center justify-between rounded-xl border border-default bg-white p-3 shadow-sm hover:border-accent hover:shadow-md"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                              <ActivityIcon className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-ui-primary">{assignment.activityTitle}</p>
                              <p className="text-xs text-ui-muted">{assignment.classTitle}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium text-accent">
                              {assignment.status === "in_progress"
                                ? "In Progress"
                                : formatDueDate(assignment.dueAt)}
                            </p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {upcoming.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ui-muted">
                    Upcoming
                  </h3>
                  <div className="space-y-2">
                    {upcoming.slice(0, 3).map((assignment) => {
                      const ActivityIcon = getActivityIcon(assignment.activityType);
                      return (
                        <Link
                          key={assignment.id}
                          href={`/classes/${assignment.classId}/assignments/${assignment.id}/${assignment.activityType}`}
                          className="ui-motion-lift flex items-center justify-between rounded-xl border border-default bg-white p-3 shadow-sm hover:border-accent hover:shadow-md"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-ui-muted">
                              <ActivityIcon className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-ui-primary">{assignment.activityTitle}</p>
                              <p className="text-xs text-ui-muted">{assignment.classTitle}</p>
                            </div>
                          </div>
                          <p className="text-xs font-medium text-ui-muted">{formatDueDate(assignment.dueAt)}</p>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          <Card className="mt-8 rounded-2xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ui-primary">My Classes</h2>
                <p className="mt-1 text-sm text-ui-muted">
                  See all your joined classes and open each class workspace from one dedicated view.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-default bg-[var(--surface-muted)] px-3 py-1 text-sm font-semibold text-ui-primary">
                  {classes?.length ?? 0} joined
                </span>
                <Button asChild variant="default">
                  <Link href="/student/classes">Open My Classes</Link>
                </Button>
              </div>
            </div>
          </Card>
      </main>
    </RoleAppShell>
  );
}
