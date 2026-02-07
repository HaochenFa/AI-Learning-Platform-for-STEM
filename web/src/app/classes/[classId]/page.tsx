import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { uploadMaterial } from "@/app/classes/actions";
import MaterialUploadForm from "./MaterialUploadForm";
import AuthHeader from "@/app/components/AuthHeader";

export const dynamic = "force-dynamic";

type SearchParams = {
  error?: string;
  uploaded?: string;
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
  const { classId } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: classRow } = await supabase
    .from("classes")
    .select("id,title,description,subject,level,join_code,owner_id")
    .eq("id", classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id || enrollment?.role === "teacher" || enrollment?.role === "ta";

  const { data: materials } = isTeacher
    ? await supabase
        .from("materials")
        .select("id,title,status,created_at,mime_type,size_bytes,metadata")
        .eq("class_id", classId)
        .order("created_at", { ascending: false })
    : { data: null };

  const { data: publishedBlueprint } = await supabase
    .from("blueprints")
    .select("id,version")
    .eq("class_id", classId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: classRow.title }]}
      />
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <header className="mb-10 space-y-2">
          <p className="text-sm font-medium text-slate-400">Class Overview</p>
          <h1 className="text-3xl font-semibold">{classRow.title}</h1>
          <p className="text-sm text-slate-400">
            {classRow.subject || "STEM"} · {classRow.level || "Mixed level"}
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {uploadNotice ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {uploadNotice}
          </div>
        ) : null}

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">Course blueprint</h2>
            <p className="mt-2 text-sm text-slate-400">
              {isTeacher
                ? "Generate a structured blueprint from uploaded materials to unlock AI activities."
                : publishedBlueprint
                  ? "Review the published blueprint that powers your class activities."
                  : "The blueprint is being prepared by your teacher."}
            </p>
            {isTeacher ? (
              <Link
                href={`/classes/${classRow.id}/blueprint`}
                className="ui-motion-lift mt-6 inline-flex rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:-translate-y-0.5"
              >
                Open blueprint studio
              </Link>
            ) : publishedBlueprint ? (
              <Link
                href={`/classes/${classRow.id}/blueprint/published`}
                className="ui-motion-lift mt-6 inline-flex rounded-xl border border-cyan-400/40 px-4 py-2 text-sm font-semibold text-cyan-200 hover:-translate-y-0.5"
              >
                View published blueprint
              </Link>
            ) : (
              <span className="mt-6 inline-flex rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-500">
                Awaiting publication
              </span>
            )}
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">Enrollment</h2>
            {isTeacher ? (
              <div className="mt-3 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-200">
                Join code: <span className="font-semibold">{classRow.join_code}</span>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">You are enrolled in this class.</p>
            )}
            <p className="mt-4 text-sm text-slate-400">
              {classRow.description || "Add a class description and upload materials to begin."}
            </p>
          </div>
        </section>

        <section className="mt-10 rounded-3xl border border-white/10 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">AI Chat</h2>
              <p className="mt-2 text-sm text-slate-400">
                {publishedBlueprint
                  ? "Use open practice chat or assignment chat grounded in the published blueprint."
                  : "Publish the blueprint to unlock chat experiences."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/classes/${classRow.id}/chat`}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-white/30 hover:bg-white/5"
              >
                Open practice chat
              </Link>
              {isTeacher ? (
                <Link
                  href={`/classes/${classRow.id}/activities/chat/new`}
                  className="rounded-xl bg-cyan-400/90 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
                >
                  Create chat assignment
                </Link>
              ) : null}
            </div>
          </div>

          {isTeacher ? (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Recent chat assignments
              </p>
              {teacherChatAssignments.length > 0 ? (
                teacherChatAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{assignment.title}</p>
                      <p className="text-xs text-slate-500">{formatDueDate(assignment.dueAt)}</p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/review`}
                      className="rounded-lg border border-cyan-400/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"
                    >
                      Review
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">
                  No chat assignments yet. Create one to start collecting student submissions.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Your chat assignments
              </p>
              {studentChatAssignments.length > 0 ? (
                studentChatAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{assignment.title}</p>
                      <p className="text-xs text-slate-500">
                        {formatDueDate(assignment.dueAt)} · Status:{" "}
                        {formatAssignmentStatus(assignment.status)}
                      </p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/chat`}
                      className="rounded-lg border border-cyan-400/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"
                    >
                      Open
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">
                  No chat assignments yet. Use open practice chat while you wait.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="mt-10 rounded-3xl border border-white/10 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Quizzes</h2>
              <p className="mt-2 text-sm text-slate-400">
                {publishedBlueprint
                  ? "Generate, curate, publish, and assign blueprint-grounded quizzes."
                  : "Publish the blueprint to unlock quiz generation."}
              </p>
            </div>
            {isTeacher ? (
              <Link
                href={`/classes/${classRow.id}/activities/quiz/new`}
                className="rounded-xl bg-cyan-400/90 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Generate quiz draft
              </Link>
            ) : null}
          </div>

          {isTeacher ? (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Recent quiz assignments
              </p>
              {teacherQuizAssignments.length > 0 ? (
                teacherQuizAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{assignment.title}</p>
                      <p className="text-xs text-slate-500">{formatDueDate(assignment.dueAt)}</p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/review`}
                      className="rounded-lg border border-cyan-400/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"
                    >
                      Review
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">
                  No quiz assignments yet. Generate and publish a quiz draft to begin.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Your quiz assignments
              </p>
              {studentQuizAssignments.length > 0 ? (
                studentQuizAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{assignment.title}</p>
                      <p className="text-xs text-slate-500">
                        {formatDueDate(assignment.dueAt)} · Status:{" "}
                        {formatAssignmentStatus(assignment.status)}
                      </p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/quiz`}
                      className="rounded-lg border border-cyan-400/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"
                    >
                      Open
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">
                  No quiz assignments yet. Your teacher will publish them here.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="mt-10 rounded-3xl border border-white/10 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Flashcards</h2>
              <p className="mt-2 text-sm text-slate-400">
                {publishedBlueprint
                  ? "Generate, curate, publish, and assign blueprint-grounded flashcards."
                  : "Publish the blueprint to unlock flashcard generation."}
              </p>
            </div>
            {isTeacher ? (
              <Link
                href={`/classes/${classRow.id}/activities/flashcards/new`}
                className="rounded-xl bg-cyan-400/90 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Generate flashcards draft
              </Link>
            ) : null}
          </div>

          {isTeacher ? (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Recent flashcards assignments
              </p>
              {teacherFlashcardsAssignments.length > 0 ? (
                teacherFlashcardsAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{assignment.title}</p>
                      <p className="text-xs text-slate-500">{formatDueDate(assignment.dueAt)}</p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/review`}
                      className="rounded-lg border border-cyan-400/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"
                    >
                      Review
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">
                  No flashcards assignments yet. Generate and publish a draft to begin.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Your flashcards assignments
              </p>
              {studentFlashcardsAssignments.length > 0 ? (
                studentFlashcardsAssignments.slice(0, 5).map((assignment) => (
                  <div
                    key={assignment.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{assignment.title}</p>
                      <p className="text-xs text-slate-500">
                        {formatDueDate(assignment.dueAt)} · Status:{" "}
                        {formatAssignmentStatus(assignment.status)}
                      </p>
                    </div>
                    <Link
                      href={`/classes/${classRow.id}/assignments/${assignment.assignmentId}/flashcards`}
                      className="rounded-lg border border-cyan-400/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"
                    >
                      Open
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">
                  No flashcards assignments yet. Your teacher will publish them here.
                </p>
              )}
            </div>
          )}
        </section>

        {isTeacher ? (
          <section className="mt-10 grid gap-6 lg:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 lg:col-span-1">
              <h2 className="text-lg font-semibold">Upload materials</h2>
              <p className="mt-2 text-sm text-slate-400">
                Supported formats: PDF, DOCX, PPTX. Images require vision extraction.
              </p>
              <MaterialUploadForm action={uploadMaterial.bind(null, classRow.id)} />
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Materials library</h2>
                <span className="text-xs font-medium tracking-wide text-slate-400">
                  {materials?.length ?? 0} items
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {materials && materials.length > 0 ? (
                  materials.map((material) => (
                    <div
                      key={material.id}
                      className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{material.title}</p>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-3 py-1 text-xs ${
                              material.status === "processing"
                                ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
                                : material.status === "failed"
                                  ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                                  : "border-white/10 text-slate-400"
                            }`}
                          >
                            {material.status === "processing"
                              ? "Processing"
                              : material.status === "failed"
                                ? "Failed"
                                : material.status || "Pending"}
                          </span>
                          {material.status === "processing" ? (
                            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
                          ) : null}
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        {material.mime_type || "unknown type"} ·{" "}
                        {material.size_bytes
                          ? `${Math.round(material.size_bytes / 1024)} KB`
                          : "size unknown"}
                      </p>
                      {Array.isArray(material.metadata?.warnings) &&
                      material.metadata.warnings.length > 0 ? (
                        <ul className="text-xs text-amber-200">
                          {material.metadata.warnings.map((warning: string) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                      {material.status === "processing" ? (
                        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full w-2/3 animate-pulse rounded-full bg-cyan-400/60" />
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                    No materials yet. Upload materials to begin blueprint generation.
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <h2 className="text-lg font-semibold">Student hub</h2>
              <p className="mt-2 text-sm text-slate-400">
                Use open practice chat, then complete chat assignments as they are published.
              </p>
              <Link
                href={`/classes/${classRow.id}/chat`}
                className="mt-4 inline-flex rounded-xl border border-cyan-400/40 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"
              >
                Open practice chat
              </Link>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <h2 className="text-lg font-semibold">Blueprint status</h2>
              {publishedBlueprint ? (
                <>
                  <p className="mt-2 text-sm text-slate-400">
                    The latest blueprint is published and ready.
                  </p>
                  <Link
                    href={`/classes/${classRow.id}/blueprint/published`}
                    className="ui-motion-color mt-4 inline-flex rounded-xl border border-cyan-400/40 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10"
                  >
                    View published blueprint
                  </Link>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-400">
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
