import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import type { ChatTurn } from "@/lib/chat/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import AssignmentChatPanel from "@/app/classes/[classId]/assignments/[assignmentId]/chat/AssignmentChatPanel";

type SearchParams = {
  error?: string;
  submitted?: string;
};

function parseSubmissionContent(content: unknown): { transcript: ChatTurn[]; reflection: string } {
  if (!content || typeof content !== "object") {
    return { transcript: [], reflection: "" };
  }

  const transcriptRaw = (content as { transcript?: unknown }).transcript;
  const reflectionRaw = (content as { reflection?: unknown }).reflection;

  const transcript = Array.isArray(transcriptRaw)
    ? transcriptRaw
        .filter((turn): turn is ChatTurn => {
          if (!turn || typeof turn !== "object") {
            return false;
          }
          const role = (turn as { role?: unknown }).role;
          const message = (turn as { message?: unknown }).message;
          const createdAt = (turn as { createdAt?: unknown }).createdAt;
          return (
            (role === "student" || role === "assistant") &&
            typeof message === "string" &&
            typeof createdAt === "string"
          );
        })
        .map((turn) => ({
          role: turn.role,
          message: turn.message,
          createdAt: turn.createdAt,
          citations: Array.isArray(turn.citations) ? turn.citations : undefined,
        }))
    : [];

  return {
    transcript,
    reflection: typeof reflectionRaw === "string" ? reflectionRaw : "",
  };
}

export default async function AssignmentChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { classId, assignmentId } = await params;
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
    .select("id,title,owner_id")
    .eq("id", classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  const { data: recipient } = await supabase
    .from("assignment_recipients")
    .select("assignment_id,status")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (!recipient) {
    redirect(
      `/classes/${classId}?error=${encodeURIComponent("You are not assigned to this chat.")}`,
    );
  }

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id,class_id,activity_id,due_at")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .single();

  if (!assignment) {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Assignment not found.")}`);
  }

  const { data: activity } = await supabase
    .from("activities")
    .select("id,title,type,config")
    .eq("id", assignment.activity_id)
    .eq("class_id", classId)
    .single();

  if (!activity || activity.type !== "chat") {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Chat activity not found.")}`);
  }

  const { data: submission } = await supabase
    .from("submissions")
    .select("id,content,submitted_at")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const isSubmitted =
    Boolean(submission) || recipient.status === "submitted" || recipient.status === "reviewed";
  const initialPayload = parseSubmissionContent(submission?.content);
  const instructions =
    typeof activity.config?.instructions === "string"
      ? activity.config.instructions
      : "Use class context to answer each question.";

  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const submittedMessage =
    resolvedSearchParams?.submitted === "1"
      ? "Assignment submitted. You can return to class while your teacher reviews it."
      : null;

  return (
    <div className="min-h-screen surface-page text-slate-900">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId: classRow.id, isTeacher: false }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: "Chat Assignment" },
        ]}
      />

      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-slate-500">Assignment Workspace</p>
          <h1 className="text-3xl font-semibold">{activity.title}</h1>
          <p className="text-sm text-slate-500">
            {assignment.due_at
              ? `Due ${new Date(assignment.due_at).toLocaleString()}`
              : "No due date"}
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        {submittedMessage ? (
          <div className="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {submittedMessage}
          </div>
        ) : null}

        <AssignmentChatPanel
          classId={classId}
          assignmentId={assignmentId}
          instructions={instructions}
          initialTranscript={initialPayload.transcript}
          initialReflection={initialPayload.reflection}
          isSubmitted={isSubmitted}
        />
      </div>
    </div>
  );
}
