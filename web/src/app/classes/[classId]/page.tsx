import Link from "next/link";
import { redirect } from "next/navigation";
import { uploadMaterialMutation } from "@/app/classes/actions";
import MaterialUploadForm from "./MaterialUploadForm";
import AuthHeader from "@/app/components/AuthHeader";
import StudentClassExperience from "@/app/classes/[classId]/StudentClassExperience";
import TeacherChatMonitorPanel from "@/app/classes/[classId]/chat/TeacherChatMonitorPanel";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Button } from "@/components/ui/button";
import { startServerTimer } from "@/lib/perf";
import { requireVerifiedUser } from "@/lib/auth/session";

type SearchParams = {
  error?: string;
  uploaded?: string;
  view?: string;
};

type ActivityAssignmentSummary = {
  assignmentId: string;
  title: string;
  dueAt: string | null;
  activityType: "chat" | "quiz" | "flashcards";
  status?: string;
};

function formatDueDate(value: string | null) {
  if (!value) {
    return "No due date";
  }
  return `Due ${new Date(value).toLocaleString()}`;
}

function formatAssignmentStatus(value: string | null | undefined) {
  const status = value ?? "assigned";
  if (status === "in_progress") {
    return "In progress";
  }
  if (status === "submitted") {
    return "Submitted";
  }
  if (status === "reviewed") {
    return "Reviewed";
  }
  return "Assigned";
}

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
  const { supabase, user } = await requireVerifiedUser();

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

  const isTeacher =
    classRow.owner_id === user.id || enrollment?.role === "teacher" || enrollment?.role === "ta";

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
          .select("id,title,status,created_at,mime_type,size_bytes,metadata")
          .eq("class_id", classId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);
  const publishedBlueprint = publishedBlueprintResult.data;
  const materials = materialsResult.data;

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

    const activityIds = (assignments ?? []).map((assignment) => assignment.activity_id);
    const { data: activities } =
      activityIds.length > 0
        ? await supabase
            .from("activities")
            .select("id,title,type,config")
            .in("id", activityIds)
            .eq("class_id", classId)
        : { data: null };

    const activityById = new Map((activities ?? []).map((activity) => [activity.id, activity]));

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
      .filter((value): value is ActivityAssignmentSummary => value !== null);

    teacherChatAssignments = mappedAssignments.filter(
      (assignment) => assignment.activityType === "chat"
    );
    teacherQuizAssignments = mappedAssignments.filter(
      (assignment) => assignment.activityType === "quiz"
    );
    teacherFlashcardsAssignments = mappedAssignments.filter(
      (assignment) => assignment.activityType === "flashcards"
    );
  } else {
    const { data: recipients } = await supabase
      .from("assignment_recipients")
      .select("assignment_id,status,assigned_at")
      .eq("student_id", user.id)
      .order("assigned_at", { ascending: false })
      .limit(20);

    const assignmentIds = (recipients ?? []).map((recipient) => recipient.assignment_id);
    const { data: assignments } =
      assignmentIds.length > 0
        ? await supabase
            .from("assignments")
            .select("id,activity_id,due_at,class_id")
            .in("id", assignmentIds)
            .eq("class_id", classId)
        : { data: null };

    const activityIds = (assignments ?? []).map((assignment) => assignment.activity_id);
    const { data: activities } =
      activityIds.length > 0
        ? await supabase
            .from("activities")
            .select("id,title,type,config")
            .in("id", activityIds)
            .eq("class_id", classId)
        : { data: null };

    const assignmentById = new Map(
      (assignments ?? []).map((assignment) => [assignment.id, assignment])
    );
    const activityById = new Map((activities ?? []).map((activity) => [activity.id, activity]));
    const { data: submissions } =
      assignmentIds.length > 0
        ? await supabase
            .from("submissions")
            .select("assignment_id")
            .eq("student_id", user.id)
            .in("assignment_id", assignmentIds)
        : { data: null };

    const submissionCountByAssignmentId = new Map<string, number>();
    (submissions ?? []).forEach((submission) => {
      submissionCountByAssignmentId.set(
        submission.assignment_id,
        (submissionCountByAssignmentId.get(submission.assignment_id) ?? 0) + 1
      );
    });

    const mappedStudentAssignments: Array<ActivityAssignmentSummary | null> = (
      recipients ?? []
    ).map((recipient) => {
      const assignment = assignmentById.get(recipient.assignment_id);
      if (!assignment) {
        return null;
      }
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
      };
    });

    const filteredAssignments = mappedStudentAssignments.filter(
      (value): value is ActivityAssignmentSummary => value !== null
    );
    studentChatAssignments = filteredAssignments.filter(
      (assignment) => assignment.activityType === "chat"
    );
    studentQuizAssignments = filteredAssignments.filter(
      (assignment) => assignment.activityType === "quiz"
    );
    studentFlashcardsAssignments = filteredAssignments.filter(
      (assignment) => assignment.activityType === "flashcards"
    );
  }

  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const uploadNotice =
    resolvedSearchParams?.uploaded === "processing"
      ? "Material uploaded. Processing will complete shortly."
      : resolvedSearchParams?.uploaded === "failed"
        ? "Material uploaded, but extraction failed."
        : null;

  if (!isTeacher) {
    timer.end({
      role: "student",
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
        chatAssignments={studentChatAssignments}
        quizAssignments={studentQuizAssignments}
        flashcardsAssignments={studentFlashcardsAssignments}
        initialView={resolvedSearchParams?.view === "chat" ? "chat" : null}
      />
    );
  }

  const totalAssignments =
    teacherChatAssignments.length + teacherQuizAssignments.length + teacherFlashcardsAssignments.length;

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
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[{ label: "Dashboard", href: "/teacher/dashboard" }, { label: classRow.title }]}
      />
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <header className="mb-10 rounded-[2rem] border border-default bg-white px-7 py-7 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Class Overview</p>
          <h1 className="editorial-title mt-2 text-4xl text-ui-primary">{classRow.title}</h1>
          <p className="mt-2 text-sm text-ui-muted">
            {classRow.subject || "General"} · {classRow.level || "Mixed level"}
          </p>
        </header>

        {errorMessage ? (
          <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
        ) : null}

        {uploadNotice ? (
          <div className="notice-warm mb-6 rounded-xl px-4 py-3 text-sm">
            {uploadNotice}
          </div>
        ) : null}

        <section className="mb-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-default bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ui-subtle">
              Blueprint
            </p>
            <p className="mt-2 text-sm font-semibold text-ui-primary">
              {publishedBlueprint ? "Published and active" : "Draft / pending publication"}
            </p>
          </div>
          <div className="rounded-2xl border border-default bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ui-subtle">
              Assignments
            </p>
            <p className="mt-2 text-sm font-semibold text-ui-primary">{totalAssignments} recent assignments</p>
          </div>
          <div className="rounded-2xl border border-default bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ui-subtle">
              Materials
            </p>
            <p className="mt-2 text-sm font-semibold text-ui-primary">
              {materials?.length ?? 0} item{(materials?.length ?? 0) === 1 ? "" : "s"}
            </p>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-default bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Course blueprint</h2>
            <p className="mt-2 text-sm text-ui-muted">
              {isTeacher
                ? "Generate a structured blueprint from uploaded materials to unlock AI activities."
                : publishedBlueprint
                  ? "Review the published blueprint that powers your class activities."
                  : "The blueprint is being prepared by your teacher."}
            </p>
            {isTeacher ? (
              <Button asChild variant="warm" className="ui-motion-lift mt-6">
                <Link href={`/classes/${classRow.id}/blueprint`}>Open blueprint studio</Link>
              </Button>
            ) : publishedBlueprint ? (
              <Link
                href={`/classes/${classRow.id}/blueprint/published`}
                className="ui-motion-lift mt-6 inline-flex rounded-xl border border-accent px-4 py-2 text-sm font-semibold text-accent hover:-translate-y-0.5 hover:bg-accent-soft"
              >
                View published blueprint
              </Link>
            ) : (
              <span className="mt-6 inline-flex rounded-xl border border-default px-4 py-2 text-sm text-ui-muted">
                Awaiting publication
              </span>
            )}
          </div>
          <div className="rounded-3xl border border-default bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Enrollment</h2>
            {isTeacher ? (
              <div className="mt-3 rounded-2xl border border-accent bg-accent-soft px-4 py-3 text-sm text-accent">
                Join code: <span className="font-semibold">{classRow.join_code}</span>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ui-muted">You are enrolled in this class.</p>
            )}
            <p className="mt-4 text-sm text-ui-muted">
              {classRow.description || "Add a class description and upload materials to begin."}
            </p>
          </div>
        </section>

        <section className="mt-10 rounded-3xl border border-default bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">AI Chat</h2>
              <p className="mt-2 text-sm text-ui-muted">
                {publishedBlueprint
                  ? "Always-on class chat is available for teachers and students. Use this panel to monitor student chat history."
                  : "Publish the blueprint to unlock always-on chat and assignment chat experiences."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="#teacher-chat-monitor"
                className="ui-motion-color rounded-xl border border-default px-4 py-2 text-xs font-semibold text-ui-muted hover:border-accent hover:bg-accent-soft hover:text-accent"
              >
                Open chat monitor
              </Link>
              <Link
                href={`/classes/${classRow.id}/activities/chat/new`}
                className="rounded-xl border border-accent bg-accent px-4 py-2 text-xs font-semibold text-ui-primary hover:bg-accent-strong"
              >
                Create chat assignment
              </Link>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
              Recent chat assignments
            </p>
            {teacherChatAssignments.length > 0 ? (
              teacherChatAssignments.slice(0, 5).map((assignment) => (
                <div
                  key={assignment.assignmentId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-ui-primary">{assignment.title}</p>
                    <p className="text-xs text-ui-muted">{formatDueDate(assignment.dueAt)}</p>
                  </div>
                  <Link
                    href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/review`}
                    className="ui-motion-color rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-soft"
                  >
                    Review
                  </Link>
                </div>
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
            <p className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-800">
              Publish the class blueprint before opening teacher chat monitor.
            </p>
          )}
        </section>

        <section className="mt-10 rounded-3xl border border-default bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Quizzes</h2>
              <p className="mt-2 text-sm text-ui-muted">
                {publishedBlueprint
                  ? "Generate, curate, publish, and assign blueprint-grounded quizzes."
                  : "Publish the blueprint to unlock quiz generation."}
              </p>
            </div>
            {isTeacher ? (
              <Link
                href={`/classes/${classRow.id}/activities/quiz/new`}
                className="rounded-xl border border-accent bg-accent px-4 py-2 text-xs font-semibold text-ui-primary hover:bg-accent-strong"
              >
                Generate quiz draft
              </Link>
            ) : null}
          </div>

          {isTeacher ? (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
                Recent quiz assignments
              </p>
              {teacherQuizAssignments.length > 0 ? (
                teacherQuizAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ui-primary">{assignment.title}</p>
                      <p className="text-xs text-ui-muted">{formatDueDate(assignment.dueAt)}</p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/review`}
                      className="ui-motion-color rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-soft"
                    >
                      Review
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ui-muted">
                  No quiz assignments yet. Generate and publish a quiz draft to begin.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
                Your quiz assignments
              </p>
              {studentQuizAssignments.length > 0 ? (
                studentQuizAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ui-primary">{assignment.title}</p>
                      <p className="text-xs text-ui-muted">
                        {formatDueDate(assignment.dueAt)} · Status:{" "}
                        {formatAssignmentStatus(assignment.status)}
                      </p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/quiz`}
                      className="ui-motion-color rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-soft"
                    >
                      Open
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ui-muted">
                  No quiz assignments yet. Your teacher will publish them here.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="mt-10 rounded-3xl border border-default bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Flashcards</h2>
              <p className="mt-2 text-sm text-ui-muted">
                {publishedBlueprint
                  ? "Generate, curate, publish, and assign blueprint-grounded flashcards."
                  : "Publish the blueprint to unlock flashcard generation."}
              </p>
            </div>
            {isTeacher ? (
              <Link
                href={`/classes/${classRow.id}/activities/flashcards/new`}
                className="rounded-xl border border-accent bg-accent px-4 py-2 text-xs font-semibold text-ui-primary hover:bg-accent-strong"
              >
                Generate flashcards draft
              </Link>
            ) : null}
          </div>

          {isTeacher ? (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
                Recent flashcards assignments
              </p>
              {teacherFlashcardsAssignments.length > 0 ? (
                teacherFlashcardsAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ui-primary">{assignment.title}</p>
                      <p className="text-xs text-ui-muted">{formatDueDate(assignment.dueAt)}</p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/review`}
                      className="ui-motion-color rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-soft"
                    >
                      Review
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ui-muted">
                  No flashcards assignments yet. Generate and publish a draft to begin.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">
                Your flashcards assignments
              </p>
              {studentFlashcardsAssignments.length > 0 ? (
                studentFlashcardsAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ui-primary">{assignment.title}</p>
                      <p className="text-xs text-ui-muted">
                        {formatDueDate(assignment.dueAt)} · Status:{" "}
                        {formatAssignmentStatus(assignment.status)}
                      </p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/flashcards`}
                      className="ui-motion-color rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-soft"
                    >
                      Open
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ui-muted">
                  No flashcards assignments yet. Your teacher will publish them here.
                </p>
              )}
            </div>
          )}
        </section>

        {isTeacher ? (
          <section className="mt-10 grid gap-6 lg:grid-cols-3">
            <div className="rounded-3xl border border-default bg-white p-6 shadow-sm lg:col-span-1">
              <h2 className="text-lg font-semibold">Upload materials</h2>
              <p className="mt-2 text-sm text-ui-muted">
                Supported formats: PDF, DOCX, PPTX.
              </p>
              <MaterialUploadForm action={uploadMaterialMutation.bind(null, classRow.id)} />
            </div>
            <div className="rounded-3xl border border-default bg-white p-6 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Materials library</h2>
                <span className="text-xs font-medium tracking-wide text-ui-muted">
                  {materials?.length ?? 0} items
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {materials && materials.length > 0 ? (
                  materials.map((material) => (
                    <div
                      key={material.id}
                      className="flex flex-col gap-1 rounded-2xl border border-default bg-white p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{material.title}</p>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-3 py-1 text-xs ${
                              material.status === "processing"
                                ? "border-accent bg-accent-soft text-accent"
                                : material.status === "failed"
                                  ? "border-rose-500/40 bg-rose-500/10 text-rose-700"
                                  : "border-default text-ui-muted"
                            }`}
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
                        <ul className="text-xs text-amber-700">
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
            </div>
          </section>
        ) : (
          <section className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-default bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Student hub</h2>
              <p className="mt-2 text-sm text-ui-muted">
                Use open practice chat, then complete chat assignments as they are published.
              </p>
              <Link
                href={`/classes/${classRow.id}/chat`}
                className="ui-motion-color mt-4 inline-flex rounded-xl border border-accent px-4 py-2 text-xs font-semibold text-accent hover:bg-accent-soft"
              >
                Open practice chat
              </Link>
            </div>
            <div className="rounded-3xl border border-default bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Blueprint status</h2>
              {publishedBlueprint ? (
                <>
                  <p className="mt-2 text-sm text-ui-muted">
                    The latest blueprint is published and ready.
                  </p>
                  <Link
                    href={`/classes/${classRow.id}/blueprint/published`}
                    className="ui-motion-color mt-4 inline-flex rounded-xl border border-accent px-4 py-2 text-xs font-semibold text-accent hover:bg-accent-soft"
                  >
                    View published blueprint
                  </Link>
                </>
              ) : (
                <p className="mt-2 text-sm text-ui-muted">
                  Awaiting teacher approval. Check back soon for AI powered activities.
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
