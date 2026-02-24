import Link from "next/link";
import Sidebar from "@/app/components/Sidebar";
import { requireVerifiedUser } from "@/lib/auth/session";

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
  if (type === "chat") {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
        />
      </svg>
    );
  }
  if (type === "quiz") {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6c0-.98.626-1.813 1.5-2.122"
      />
    </svg>
  );
}

export default async function StudentDashboardPage() {
  const { supabase, user } = await requireVerifiedUser({ accountType: "student" });

  const [classesResult, enrollmentsResult, recipientsResult] = await Promise.all([
    supabase
      .from("classes")
      .select("id,title,subject,level,owner_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("enrollments")
      .select("class_id,role")
      .eq("user_id", user.id),
    supabase
      .from("assignment_recipients")
      .select("assignment_id,status,assigned_at")
      .eq("student_id", user.id)
      .order("assigned_at", { ascending: false })
      .limit(20),
  ]);

  const classes = classesResult.data;
  const enrollments = enrollmentsResult.data;
  const recipients = recipientsResult.data;

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

  const enrollmentMap = new Map(
    enrollments?.map((enrollment) => [enrollment.class_id, enrollment.role]) ?? [],
  );

  return (
    <div className="surface-page min-h-screen">
      <Sidebar accountType="student" userEmail={user.email ?? undefined} />
      <div className="sidebar-content">
        <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-slate-500">Student Dashboard</p>
              <h1 className="text-3xl font-semibold text-slate-900">Welcome, {user.email}</h1>
              <p className="mt-1 text-sm text-slate-600">
                Join classes and complete your assignments in one place.
              </p>
            </div>
            <Link href="/join" className="btn-secondary rounded-xl px-4 py-2 text-sm font-semibold">
              Join class
            </Link>
          </header>

          {(current.length > 0 || upcoming.length > 0 || completed.length > 0) && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">Your Progress</h2>
              <div className="mt-4 grid grid-cols-3 gap-4">
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-red-600">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <span className="text-2xl font-bold text-red-700">{current.length}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-red-600">Due Now</p>
                </div>
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                        />
                      </svg>
                    </div>
                    <span className="text-2xl font-bold text-blue-700">{upcoming.length}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-blue-600">Upcoming</p>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <span className="text-2xl font-bold text-emerald-700">{completed.length}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-emerald-600">Completed</p>
                </div>
              </div>

              {current.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-red-600">
                    Due Now
                  </h3>
                  <div className="space-y-2">
                    {current.slice(0, 3).map((assignment) => (
                      <Link
                        key={assignment.id}
                        href={`/classes/${assignment.classId}/assignments/${assignment.id}/${assignment.activityType}`}
                        className="flex items-center justify-between rounded-xl border border-red-200 bg-white p-3 shadow-sm hover:border-red-300 hover:shadow-md"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
                            {getActivityIcon(assignment.activityType)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{assignment.activityTitle}</p>
                            <p className="text-xs text-slate-500">{assignment.classTitle}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p
                            className={`text-xs font-medium ${
                              assignment.status === "in_progress" ? "text-amber-600" : "text-red-600"
                            }`}
                          >
                            {assignment.status === "in_progress"
                              ? "In Progress"
                              : formatDueDate(assignment.dueAt)}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {upcoming.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-blue-600">
                    Upcoming
                  </h3>
                  <div className="space-y-2">
                    {upcoming.slice(0, 3).map((assignment) => (
                      <Link
                        key={assignment.id}
                        href={`/classes/${assignment.classId}/assignments/${assignment.id}/${assignment.activityType}`}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:border-slate-300 hover:shadow-md"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                            {getActivityIcon(assignment.activityType)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{assignment.activityTitle}</p>
                            <p className="text-xs text-slate-500">{assignment.classTitle}</p>
                          </div>
                        </div>
                        <p className="text-xs font-medium text-blue-600">{formatDueDate(assignment.dueAt)}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section id="classes" className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">Your Classes</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {classes && classes.length > 0 ? (
                classes.map((classItem) => {
                  const role = enrollmentMap.get(classItem.id);
                  if (role !== "student") {
                    return null;
                  }

                  return (
                    <div
                      key={classItem.id}
                      className="ui-motion-lift group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md"
                    >
                      <p className="text-xs font-medium text-slate-500">Student</p>
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
                          href={`/classes/${classItem.id}?view=chat`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 hover:border-cyan-300 hover:text-cyan-700"
                        >
                          Open AI chat
                        </Link>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                  No classes joined yet. Use a join code from your teacher.
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
