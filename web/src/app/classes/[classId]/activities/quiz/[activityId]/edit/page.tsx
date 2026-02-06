import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import QuizDraftEditor from "@/app/classes/[classId]/activities/quiz/[activityId]/edit/QuizDraftEditor";

export const dynamic = "force-dynamic";

type SearchParams = {
  created?: string;
  saved?: string;
  published?: string;
  error?: string;
};

export default async function EditQuizDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; activityId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { classId, activityId } = await params;
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

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id || enrollment?.role === "teacher" || enrollment?.role === "ta";

  if (!isTeacher) {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Teacher access required.")}`);
  }

  const { data: activity } = await supabase
    .from("activities")
    .select("id,class_id,type,title,status,config")
    .eq("id", activityId)
    .eq("class_id", classId)
    .single();

  if (!activity || activity.type !== "quiz") {
    redirect(`/classes/${classId}?error=${encodeURIComponent("Quiz activity not found.")}`);
  }

  const { data: questionRows } = await supabase
    .from("quiz_questions")
    .select("id,question,choices,answer,explanation,order_index")
    .eq("activity_id", activityId)
    .order("order_index", { ascending: true });

  const config =
    activity.config && typeof activity.config === "object"
      ? (activity.config as Record<string, unknown>)
      : {};

  const initialInstructions =
    typeof config.instructions === "string" ? config.instructions : "Review and refine quiz questions.";

  const createdMessage =
    resolvedSearchParams?.created === "1"
      ? "Quiz draft generated. Review and edit before publishing."
      : null;
  const savedMessage = resolvedSearchParams?.saved === "1" ? "Quiz draft saved." : null;
  const publishedMessage =
    resolvedSearchParams?.published === "1"
      ? "Quiz published. You can now create an assignment."
      : null;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;

  const initialQuestions = (questionRows ?? []).map((row) => {
    const choices = Array.isArray(row.choices)
      ? row.choices.filter((choice): choice is string => typeof choice === "string")
      : [];

    return {
      question: row.question,
      choices: [choices[0] ?? "", choices[1] ?? "", choices[2] ?? "", choices[3] ?? ""] as [
        string,
        string,
        string,
        string,
      ],
      answer: row.answer ?? "",
      explanation: row.explanation ?? "",
    };
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: "Edit Quiz Draft" },
        ]}
      />

      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-slate-400">Teacher Studio</p>
          <h1 className="text-3xl font-semibold">{activity.title}</h1>
          <p className="text-sm text-slate-400">
            Status: {activity.status === "published" ? "Published" : "Draft"}
          </p>
        </header>

        {createdMessage ? (
          <div className="mb-4 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {createdMessage}
          </div>
        ) : null}
        {savedMessage ? (
          <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {savedMessage}
          </div>
        ) : null}
        {publishedMessage ? (
          <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {publishedMessage}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        <QuizDraftEditor
          classId={classId}
          activityId={activityId}
          initialTitle={activity.title}
          initialInstructions={initialInstructions}
          initialQuestions={initialQuestions}
          isPublished={activity.status === "published"}
        />
      </div>
    </div>
  );
}
