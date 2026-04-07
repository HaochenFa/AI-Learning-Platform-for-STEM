import Link from "next/link";
import { redirect } from "next/navigation";
import MaterialUploadForm from "./MaterialUploadForm";
import AuthHeader from "@/app/components/AuthHeader";
import StudentClassExperience from "@/app/classes/[classId]/StudentClassExperience";
import MaterialProcessingAutoRefresh from "@/app/classes/[classId]/_components/MaterialProcessingAutoRefresh";
import { MaterialActionsMenu } from "@/app/classes/[classId]/_components/MaterialActionsMenu";
import { AdaptiveTeachingBriefWidget } from "@/app/classes/[classId]/_components/AdaptiveTeachingBriefWidget";
import TeacherChatMonitorPanel from "@/app/classes/[classId]/chat/TeacherChatMonitorPanel";
import { LocalizedDateTimeText } from "@/components/ui/localized-date-time";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppIcons } from "@/components/icons";
import { startServerTimer } from "@/lib/perf";
import { requireGuestOrVerifiedUser } from "@/lib/auth/session";
import { getClassTeachingBrief } from "@/lib/actions/teaching-brief";
import { cn } from "@/lib/utils";

/**
 * URL search params accepted by the class overview page.
 *
 * - `error` — flash error message surfaced from a prior redirect.
 * - `uploaded` — material upload outcome: `"processing"` | `"ready"` | `"failed"`.
 * - `view` — deep-link to a student widget; currently only `"chat"` is supported.
 * - `as` — role override for teachers: `"student"` activates student preview mode.
 */
type SearchParams = {
  error?: string;
  uploaded?: string;
  view?: string;
  as?: string;
};

type ActivityAssignmentSummary = {
  assignmentId: string;
  title: string;
  dueAt: string | null;
  activityType: "chat" | "quiz" | "flashcards";
  status?: string;
};

function formatAssignmentStatus(value: string | null | undefined) {
  const status = value ?? "assigned";
  if (status === "in_progress") return "In progress";
  if (status === "submitted") return "Submitted";
  if (status === "reviewed") return "Reviewed";
  return "Assigned";
}

/**
 * Colour-coded pill badge that labels an activity type.
 *
 * Renders the type string inside a token-driven CSS class
 * (`pill-chat`, `pill-quiz`, `pill-flashcards`) defined in `globals.css`.
 */
function ActivityTypePill({ type }: { type: "chat" | "quiz" | "flashcards" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        type === "chat" && "pill-chat",
        type === "quiz" && "pill-quiz",
        type === "flashcards" && "pill-flashcards",
      )}
    >
      {type}
    </span>
  );
}

/**
 * Clickable list row representing a single assignment.
 *
 * Renders the activity type pill, title, due date, and an action label
 * ("Review" for teachers, "Open" for students). Links to either the teacher
 * review page (`reviewHref`) or the student assignment workspace (`openHref`).
 */
function AssignmentRow({
  assignment,
  reviewHref,
  openHref,
  isTeacher,
}: {
  assignment: ActivityAssignmentSummary;
  reviewHref?: string;
  openHref?: string;
  isTeacher: boolean;
}) {
  const href = isTeacher ? reviewHref! : openHref!;
  const actionLabel = isTeacher ? "Review" : "Open";

  return (
    <Link
      href={href}
      className="ui-motion-lift group flex items-center justify-between gap-3 rounded-2xl border border-default bg-[var(--surface-card,white)] px-4 py-3 hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
    >
      <div className="flex items-center gap-3 min-w-0">
        <ActivityTypePill type={assignment.activityType} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ui-primary group-hover:text-accent transition-colors duration-200">
            {assignment.title}
          </p>
          <p className="text-xs text-ui-muted">
            {assignment.dueAt ? (
              <LocalizedDateTimeText value={assignment.dueAt} prefix="Due " />
            ) : (
              "No due date"
            )}
            {!isTeacher && assignment.status
              ? ` · ${formatAssignmentStatus(assignment.status)}`
              : null}
          </p>
        </div>
      </div>
      <span className="shrink-0 text-xs font-semibold text-accent transition-colors duration-200 group-hover:text-accent-strong">
        {actionLabel} →
      </span>
    </Link>
  );
}

/**
 * Top-level class page — renders the teacher dashboard or the student hub
 * depending on the resolved role.
 *
 * **Role resolution (three-step):**
 * 1. Guest users: role comes from `guestRole` in the sandbox session.
 * 2. Real teachers: `classRow.owner_id === user.id` OR `enrollment.role` is
 *    `"teacher"` or `"ta"`.
 * 3. Teacher in student preview: `?as=student` activates `isStudentPreview`,
 *    overriding `isTeacher` to `false` so the student render path is used
 *    while a preview banner is shown at the top.
 *
 * **Data loading strategy (three sequential batches):**
 * - Batch 1 (parallel): class row + caller's enrollment record.
 * - Batch 2 (parallel): published blueprint + materials list (teachers only).
 * - Batch 3 (conditional): teacher assignments OR student recipients — run
 *   after role is known to avoid fetching unnecessary data.
 *
 * **Render paths:**
 * - Student / preview → delegates entirely to `<StudentClassExperience />`.
 * - Teacher → full dashboard with upload form, assignment cards, blueprint
 *   panel, materials library, and `<TeacherChatMonitorPanel />`.
 *
 * @param params.classId The class UUID from the dynamic URL segment.
 * @param searchParams Optional URL search params — see `SearchParams`.
 */
export default async function ClassOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const timer = startServerTimer("class-overview");
  const { classId } = await params;
  const resolvedSearchParams = await searchParams;
  const context = await requireGuestOrVerifiedUser();
  const { supabase, user, isGuest, guestRole, guestClassId } = context;

  // --- Guest class guard ---
  // Redirect guests who somehow navigate to a class outside their sandbox.
  if (isGuest && guestClassId && guestClassId !== classId) {
    redirect(`/classes/${guestClassId}`);
  }

  const [classResult, enrollmentResult] = await Promise.all([
    supabase
      .from("classes")
      .select("id,title,description,subject,level,join_code,owner_id")
      .eq("id", classId)
      .single(),
    supabase
      .from("enrollments")
      .select("role")
      .eq("class_id", classId)
      .eq("user_id", user.id)
      .single(),
  ]);
  const classRow = classResult.data;
  const enrollment = enrollmentResult.data;

  if (!classRow) {
    redirect("/dashboard");
  }

  // --- Role resolution ---
  const isActualTeacher =
    classRow.owner_id === user.id || enrollment?.role === "teacher" || enrollment?.role === "ta";

  // isStudentPreview: teacher previews the student view via ?as=student.
  // isTeacher: false in preview mode so the student render path is used.
  const isStudentPreview = !isGuest && isActualTeacher && resolvedSearchParams?.as === "student";
  const isTeacher = isGuest ? guestRole === "teacher" : isActualTeacher && !isStudentPreview;

  const [publishedBlueprintResult, materialsResult] = await Promise.all([
    supabase
      .from("blueprints")
      .select("id,version")
      .eq("class_id", classId)
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    isTeacher
      ? supabase
          .from("materials")
          .select("id,title,status,created_at,mime_type,size_bytes,metadata,storage_path")
          .eq("class_id", classId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);
  const publishedBlueprint = publishedBlueprintResult.data;
  const materials = materialsResult.data;
  const processingMaterialCount =
    materials?.filter((m) => m.status === "processing").length ?? 0;

  let teacherChatAssignments: ActivityAssignmentSummary[] = [];
  let teacherQuizAssignments: ActivityAssignmentSummary[] = [];
  let studentChatAssignments: ActivityAssignmentSummary[] = [];
  let studentQuizAssignments: ActivityAssignmentSummary[] = [];
  let teacherFlashcardsAssignments: ActivityAssignmentSummary[] = [];
  let studentFlashcardsAssignments: ActivityAssignmentSummary[] = [];

  if (isTeacher) {
    const { data: assignments } = await supabase
      .from("assignments")
      .select("id,activity_id,due_at")
      .eq("class_id", classId)
      .order("created_at", { ascending: false })
      .limit(20);

    const activityIds = (assignments ?? []).map((a) => a.activity_id);
    const { data: activities } =
      activityIds.length > 0
        ? await supabase
            .from("activities")
            .select("id,title,type,config")
            .in("id", activityIds)
            .eq("class_id", classId)
        : { data: null };

    const activityById = new Map((activities ?? []).map((a) => [a.id, a]));

    const mappedAssignments = (assignments ?? [])
      .map((assignment) => {
        const activity = activityById.get(assignment.activity_id);
        if (
          !activity ||
          (activity.type !== "chat" && activity.type !== "quiz" && activity.type !== "flashcards")
        ) {
          return null;
        }
        return {
          assignmentId: assignment.id,
          title: activity.title,
          dueAt: assignment.due_at,
          activityType: activity.type,
        } satisfies ActivityAssignmentSummary;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null) as ActivityAssignmentSummary[];

    teacherChatAssignments = mappedAssignments.filter((a) => a.activityType === "chat");
    teacherQuizAssignments = mappedAssignments.filter((a) => a.activityType === "quiz");
    teacherFlashcardsAssignments = mappedAssignments.filter((a) => a.activityType === "flashcards");
  } else {
    let recipientsData: Array<{ assignment_id: string; status: string; assigned_at: string }> = [];

    if (isStudentPreview) {
      const { data: recentAssignments } = await supabase
        .from("assignments")
        .select("id,created_at")
        .eq("class_id", classId)
        .order("created_at", { ascending: false })
        .limit(20);

      recipientsData = (recentAssignments ?? []).map((a) => ({
        assignment_id: a.id,
        status: "assigned",
        assigned_at: a.created_at,
      }));
    } else {
      const { data: recipients } = await supabase
        .from("assignment_recipients")
        .select("assignment_id,status,assigned_at")
        .eq("student_id", user.id)
        .order("assigned_at", { ascending: false })
        .limit(20);
      recipientsData = recipients ?? [];
    }

    const assignmentIds = recipientsData.map((r) => r.assignment_id);
    const { data: assignments } =
      assignmentIds.length > 0
        ? await supabase
            .from("assignments")
            .select("id,activity_id,due_at,class_id")
            .in("id", assignmentIds)
            .eq("class_id", classId)
        : { data: null };

    const activityIds = (assignments ?? []).map((a) => a.activity_id);
    const { data: activities } =
      activityIds.length > 0
        ? await supabase
            .from("activities")
            .select("id,title,type,config")
            .in("id", activityIds)
            .eq("class_id", classId)
        : { data: null };

    const assignmentById = new Map((assignments ?? []).map((a) => [a.id, a]));
    const activityById = new Map((activities ?? []).map((a) => [a.id, a]));
    const { data: submissions } =
      assignmentIds.length > 0 && !isStudentPreview
        ? await supabase
            .from("submissions")
            .select("assignment_id")
            .eq("student_id", user.id)
            .in("assignment_id", assignmentIds)
        : { data: [] };

    const submissionCountByAssignmentId = new Map<string, number>();
    (submissions ?? []).forEach((s) => {
      submissionCountByAssignmentId.set(
        s.assignment_id,
        (submissionCountByAssignmentId.get(s.assignment_id) ?? 0) + 1,
      );
    });

    const mappedStudentAssignments = recipientsData
      .map((recipient) => {
        const assignment = assignmentById.get(recipient.assignment_id);
        if (!assignment) return null;
        const activity = activityById.get(assignment.activity_id);
        if (
          !activity ||
          (activity.type !== "chat" && activity.type !== "quiz" && activity.type !== "flashcards")
        ) {
          return null;
        }

        const submissionCount = submissionCountByAssignmentId.get(assignment.id) ?? 0;
        const activityConfig =
          activity.config && typeof activity.config === "object"
            ? (activity.config as Record<string, unknown>)
            : {};
        const attemptLimit =
          typeof activityConfig.attemptLimit === "number" ? activityConfig.attemptLimit : 2;

        const status =
          recipient.status === "reviewed"
            ? "reviewed"
            : activity.type === "chat"
              ? submissionCount > 0
                ? "submitted"
                : recipient.status
              : submissionCount === 0
                ? recipient.status
                : submissionCount >= attemptLimit
                  ? "submitted"
                  : "in_progress";

        return {
          assignmentId: assignment.id,
          title: activity.title,
          dueAt: assignment.due_at,
          activityType: activity.type,
          status,
        } satisfies ActivityAssignmentSummary;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null) as ActivityAssignmentSummary[];

    studentChatAssignments = mappedStudentAssignments.filter((a) => a.activityType === "chat");
    studentQuizAssignments = mappedStudentAssignments.filter((a) => a.activityType === "quiz");
    studentFlashcardsAssignments = mappedStudentAssignments.filter(
      (a) => a.activityType === "flashcards",
    );
  }

  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const uploadNotice =
    resolvedSearchParams?.uploaded === "processing"
      ? "Material uploaded. Processing will complete shortly."
      : resolvedSearchParams?.uploaded === "ready"
        ? "Material uploaded. It is ready to use."
        : resolvedSearchParams?.uploaded === "failed"
          ? "Material uploaded, but extraction failed."
        : null;

  if (!isTeacher) {
    const totalStudentAssignments =
      studentChatAssignments.length + studentQuizAssignments.length + studentFlashcardsAssignments.length;
    timer.end({
      role: "student",
      totalAssignments: totalStudentAssignments,
      chatAssignments: studentChatAssignments.length,
      quizAssignments: studentQuizAssignments.length,
      flashcardsAssignments: studentFlashcardsAssignments.length,
    });
    return (
      <StudentClassExperience
        classId={classRow.id}
        classTitle={classRow.title}
        subject={classRow.subject}
        level={classRow.level}
        publishedBlueprint={Boolean(publishedBlueprint)}
        errorMessage={errorMessage}
        uploadNotice={uploadNotice}
        totalAssignments={totalStudentAssignments}
        chatAssignments={studentChatAssignments}
        quizAssignments={studentQuizAssignments}
        flashcardsAssignments={studentFlashcardsAssignments}
        initialView={resolvedSearchParams?.view === "chat" ? "chat" : null}
        isPreviewMode={isStudentPreview}
      />
    );
  }

  const totalAssignments =
    teacherChatAssignments.length + teacherQuizAssignments.length + teacherFlashcardsAssignments.length;
  const teachingBriefState = await getClassTeachingBrief(classRow.id);

  timer.end({
    role: "teacher",
    publishedBlueprint: Boolean(publishedBlueprint),
    assignments: totalAssignments,
    materials: materials?.length ?? 0,
  });

  return (
    <div className="min-h-screen surface-page text-ui-primary">
      <AuthHeader
        activeNav="dashboard"
        isGuest={isGuest}
        guestRole={guestRole}
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[{ label: "Dashboard", href: "/teacher/dashboard" }, { label: classRow.title }]}
      />
      <div className="mx-auto w-full max-w-5xl px-6 py-16 page-enter">
        {/* ── Page header ── */}
        <header className="mb-8 flex flex-col justify-between gap-4 rounded-[2rem] border border-default bg-[var(--surface-card,white)] px-7 py-6 shadow-card sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
              Class Overview
            </p>
            <h1 className="editorial-title mt-2 text-4xl text-ui-primary">{classRow.title}</h1>
            <p className="mt-1.5 text-sm text-ui-muted">
              {classRow.subject || "General"} · {classRow.level || "Mixed level"}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="self-start sm:self-center">
            <Link href={`/classes/${classRow.id}?as=student`}>
              <AppIcons.user className="h-3.5 w-3.5" />
              Preview as student
            </Link>
          </Button>
        </header>

        {errorMessage ? (
          <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
        ) : null}

        {uploadNotice ? (
          <div className="notice-warm mb-6 rounded-xl px-4 py-3 text-sm">{uploadNotice}</div>
        ) : null}

        {/* ── Stats strip ── */}
        <section className="mb-8 grid gap-3 sm:grid-cols-3 stagger-children">
          <Card className="rounded-2xl p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-ui-muted">
                <AppIcons.classes className="h-4 w-4" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                Blueprint
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-ui-primary">
              {publishedBlueprint ? "Published ✓" : "Draft / pending"}
            </p>
          </Card>
          <Card className={cn("rounded-2xl p-4", totalAssignments > 0 && "bg-accent-soft border-[color-mix(in_srgb,var(--accent-primary)_22%,transparent)]")}>
            <div className="flex items-center gap-2.5">
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", totalAssignments > 0 ? "bg-[var(--surface-card,white)]/60 text-accent" : "bg-[var(--surface-muted)] text-ui-muted")}>
                <AppIcons.quiz className="h-4 w-4" />
              </div>
              <p className={cn("text-xs font-semibold uppercase tracking-[0.14em]", totalAssignments > 0 ? "text-accent/70" : "text-ui-subtle")}>
                Assignments
              </p>
            </div>
            <p className={cn("mt-3 text-sm font-semibold", totalAssignments > 0 ? "text-accent" : "text-ui-primary")}>
              {totalAssignments} total
            </p>
            {totalAssignments > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {teacherChatAssignments.length > 0 && (
                  <span className="pill-chat inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                    {teacherChatAssignments.length} chat
                  </span>
                )}
                {teacherQuizAssignments.length > 0 && (
                  <span className="pill-quiz inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                    {teacherQuizAssignments.length} quiz
                  </span>
                )}
                {teacherFlashcardsAssignments.length > 0 && (
                  <span className="pill-flashcards inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                    {teacherFlashcardsAssignments.length} flash
                  </span>
                )}
              </div>
            )}
          </Card>
          <Card className="rounded-2xl p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-ui-muted">
                <AppIcons.flashcards className="h-4 w-4" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                Materials
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-ui-primary">
              {materials?.length ?? 0} item{(materials?.length ?? 0) === 1 ? "" : "s"}
            </p>
          </Card>
        </section>

        <section className="mb-8">
          <AdaptiveTeachingBriefWidget
            classId={classRow.id}
            state={teachingBriefState}
          />
        </section>

        {/* ── Blueprint + Enrollment ── */}
        <section className="grid gap-6 md:grid-cols-2">
          <Card className="rounded-3xl p-6">
            <h2 className="text-lg font-semibold text-ui-primary">Course blueprint</h2>
            <p className="mt-2 text-sm text-ui-muted">
              Generate a structured blueprint from uploaded materials to unlock AI activities.
            </p>
            <Button asChild variant="warm" size="sm" className="mt-5 ui-motion-lift">
              <Link href={`/classes/${classRow.id}/blueprint`}>Open blueprint studio</Link>
            </Button>
          </Card>
          <Card className="rounded-3xl p-6">
            <h2 className="text-lg font-semibold text-ui-primary">Enrollment</h2>
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-accent bg-accent-soft px-4 py-3 text-sm text-accent">
              <AppIcons.user className="h-4 w-4 shrink-0" />
              <span>
                Join code:{" "}
                <span className="select-all font-bold tracking-wider">{classRow.join_code}</span>
              </span>
            </div>
            <p className="mt-4 text-sm text-ui-muted">
              {classRow.description || "Add a description and upload materials to begin."}
            </p>
          </Card>
        </section>

        {/* ── AI Chat ── */}
        <Card className="mt-6 rounded-3xl p-6" id="teacher-chat-monitor">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ui-primary">AI Chat</h2>
              <p className="mt-1.5 text-sm text-ui-muted">
                {publishedBlueprint
                  ? "Monitor student chats and create guided chat assignments."
                  : "Publish the blueprint to unlock always-on chat experiences."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="#teacher-chat-monitor">Chat monitor</Link>
              </Button>
              <Button asChild variant="warm" size="sm">
                <Link href={`/classes/${classRow.id}/activities/chat/new`}>
                  <AppIcons.add className="h-3.5 w-3.5" />
                  New chat assignment
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-2 stagger-children">
            {teacherChatAssignments.length > 0 ? (
              teacherChatAssignments.slice(0, 5).map((assignment) => (
                <AssignmentRow
                  key={assignment.assignmentId}
                  assignment={assignment}
                  reviewHref={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/review`}
                  isTeacher
                />
              ))
            ) : (
              <p className="text-sm text-ui-muted">
                No chat assignments yet. Create one to start collecting student submissions.
              </p>
            )}
          </div>

          {publishedBlueprint ? (
            <div className="mt-6">
              <TeacherChatMonitorPanel classId={classRow.id} />
            </div>
          ) : (
            <p className="mt-6 rounded-2xl status-warning p-4 text-sm">
              Publish the class blueprint before opening teacher chat monitor.
            </p>
          )}
        </Card>

        {/* ── Quizzes ── */}
        <Card className="mt-6 rounded-3xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ui-primary">Quizzes</h2>
              <p className="mt-1.5 text-sm text-ui-muted">
                {publishedBlueprint
                  ? "Generate, curate, publish, and assign blueprint-grounded quizzes."
                  : "Publish the blueprint to unlock quiz generation."}
              </p>
            </div>
            <Button asChild variant="warm" size="sm">
              <Link href={`/classes/${classRow.id}/activities/quiz/new`}>
                <AppIcons.add className="h-3.5 w-3.5" />
                Generate quiz
              </Link>
            </Button>
          </div>

          <div className="mt-5 space-y-2 stagger-children">
            {teacherQuizAssignments.length > 0 ? (
              teacherQuizAssignments.slice(0, 5).map((assignment) => (
                <AssignmentRow
                  key={assignment.assignmentId}
                  assignment={assignment}
                  reviewHref={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/review`}
                  isTeacher
                />
              ))
            ) : (
              <p className="text-sm text-ui-muted">
                No quiz assignments yet. Generate and publish a quiz draft to begin.
              </p>
            )}
          </div>
        </Card>

        {/* ── Flashcards ── */}
        <Card className="mt-6 rounded-3xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ui-primary">Flashcards</h2>
              <p className="mt-1.5 text-sm text-ui-muted">
                {publishedBlueprint
                  ? "Generate, curate, publish, and assign blueprint-grounded flashcards."
                  : "Publish the blueprint to unlock flashcard generation."}
              </p>
            </div>
            <Button asChild variant="warm" size="sm">
              <Link href={`/classes/${classRow.id}/activities/flashcards/new`}>
                <AppIcons.add className="h-3.5 w-3.5" />
                Generate flashcards
              </Link>
            </Button>
          </div>

          <div className="mt-5 space-y-2 stagger-children">
            {teacherFlashcardsAssignments.length > 0 ? (
              teacherFlashcardsAssignments.slice(0, 5).map((assignment) => (
                <AssignmentRow
                  key={assignment.assignmentId}
                  assignment={assignment}
                  reviewHref={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/review`}
                  isTeacher
                />
              ))
            ) : (
              <p className="text-sm text-ui-muted">
                No flashcards assignments yet. Generate and publish a draft to begin.
              </p>
            )}
          </div>
        </Card>

        {/* ── Materials ── */}
        <section className="mt-6 grid gap-6 lg:grid-cols-3" id="materials">
          <Card className="rounded-3xl p-6 lg:col-span-1">
            <h2 className="text-lg font-semibold text-ui-primary">Upload materials</h2>
            <p className="mt-1.5 text-sm text-ui-muted">Supported: PDF, DOCX, PPTX.</p>
            <MaterialUploadForm classId={classRow.id} />
          </Card>

          <Card className="rounded-3xl p-6 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ui-primary">Materials library</h2>
              <span className="text-xs font-medium tracking-wide text-ui-muted">
                {materials?.length ?? 0} items
              </span>
            </div>
            <MaterialProcessingAutoRefresh processingCount={processingMaterialCount} />
            <div className="mt-4 max-h-88 space-y-2 overflow-y-auto pr-1">
              {materials && materials.length > 0 ? (
                materials.map((material) => (
                  <div
                    key={material.id}
                    className="flex flex-col gap-1 rounded-2xl border border-default bg-[var(--surface-card,white)] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ui-primary">{material.title}</p>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            material.status === "processing"
                              ? "status-processing"
                              : material.status === "failed"
                                ? "status-error"
                                : "border-default text-ui-muted",
                          )}
                        >
                          {material.status === "processing"
                            ? "Processing"
                            : material.status === "failed"
                              ? "Failed"
                              : material.status || "Pending"}
                        </span>
                        {material.status === "processing" ? (
                          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                        ) : null}
                        <MaterialActionsMenu
                          classId={classRow.id}
                          material={{
                            id: material.id,
                            title: material.title,
                            mime_type: material.mime_type ?? null,
                            status: material.status ?? null,
                            storage_path: material.storage_path,
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-ui-muted">
                      {material.mime_type || "unknown type"} ·{" "}
                      {material.size_bytes
                        ? `${Math.round(material.size_bytes / 1024)} KB`
                        : "size unknown"}
                    </p>
                    {Array.isArray(material.metadata?.warnings) &&
                    material.metadata.warnings.length > 0 ? (
                      <ul className="text-xs text-accent-strong">
                        {material.metadata.warnings.map((warning: string) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                    {material.status === "processing" ? (
                      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--border-default)]">
                        <div className="h-full w-2/3 animate-pulse rounded-full bg-accent" />
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-default bg-[var(--surface-muted)] p-4 text-sm text-ui-muted">
                  No materials yet. Upload materials to begin blueprint generation.
                </div>
              )}
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
