import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { generateBlueprint } from "@/app/classes/[classId]/blueprint/actions";
import { BlueprintEditor } from "@/app/classes/[classId]/blueprint/BlueprintEditor";

export const dynamic = "force-dynamic";

type SearchParams = {
  error?: string;
  generated?: string;
  saved?: string;
  approved?: string;
  published?: string;
  draft?: string;
};

export default async function BlueprintPage({
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
    .select("id,title,description,subject,level,owner_id")
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

  const isOwner = classRow.owner_id === user.id;
  const isTeacher = isOwner || enrollment?.role === "teacher" || enrollment?.role === "ta";

  if (!isTeacher) {
    const { data: publishedBlueprint } = await supabase
      .from("blueprints")
      .select("id")
      .eq("class_id", classId)
      .eq("status", "published")
      .limit(1)
      .maybeSingle();

    if (!publishedBlueprint) {
      redirect(
        `/classes/${classId}?error=${encodeURIComponent("No published blueprint available.")}`,
      );
    }

    redirect(`/classes/${classId}/blueprint/published`);
  }

  const { data: blueprint } = await supabase
    .from("blueprints")
    .select("id,summary,status,version,created_at")
    .eq("class_id", classId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: topics } = blueprint
    ? await supabase
        .from("topics")
        .select("id,title,description,section,sequence,prerequisite_topic_ids")
        .eq("blueprint_id", blueprint.id)
        .order("sequence", { ascending: true })
    : { data: null };

  const { data: objectives } =
    topics && topics.length > 0
      ? await supabase
          .from("objectives")
          .select("id,topic_id,statement,level")
          .in(
            "topic_id",
            topics.map((topic) => topic.id),
          )
      : { data: null };

  const objectivesByTopic = new Map<
    string,
    { id: string; statement: string; level?: string | null }[]
  >();
  objectives?.forEach((objective) => {
    const list = objectivesByTopic.get(objective.topic_id) ?? [];
    list.push({
      id: objective.id,
      statement: objective.statement,
      level: objective.level,
    });
    objectivesByTopic.set(objective.topic_id, list);
  });

  const { count: materialCount } = await supabase
    .from("materials")
    .select("id", { count: "exact", head: true })
    .eq("class_id", classId);

  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const generatedMessage =
    resolvedSearchParams?.generated === "1" ? "Blueprint generated in draft mode." : null;
  const savedMessage = resolvedSearchParams?.saved === "1" ? "Draft saved." : null;
  const approvedMessage =
    resolvedSearchParams?.approved === "1" ? "Blueprint approved. Overview is ready." : null;
  const publishedMessage = resolvedSearchParams?.published === "1" ? "Blueprint published." : null;
  const draftedMessage = resolvedSearchParams?.draft === "1" ? "New draft version created." : null;

  const initialDraft = blueprint
    ? {
        summary: blueprint.summary ?? "",
        topics:
          topics?.map((topic) => ({
            id: topic.id,
            clientId: topic.id,
            title: topic.title,
            description: topic.description ?? "",
            section: topic.section ?? "",
            sequence: topic.sequence,
            prerequisiteClientIds: topic.prerequisite_topic_ids ?? [],
            objectives: (objectivesByTopic.get(topic.id) ?? []).map((objective) => ({
              id: objective.id,
              statement: objective.statement,
              level: objective.level ?? "",
            })),
          })) ?? [],
      }
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <header className="mb-10 space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Course Blueprint</p>
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

        {generatedMessage ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {generatedMessage}
          </div>
        ) : null}
        {savedMessage ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {savedMessage}
          </div>
        ) : null}
        {approvedMessage ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {approvedMessage}
          </div>
        ) : null}
        {publishedMessage ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {publishedMessage}
          </div>
        ) : null}
        {draftedMessage ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {draftedMessage}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold">Blueprint workspace</h2>
            <p className="mt-2 text-sm text-slate-400">
              Edit the draft, approve for overview, and publish when ready.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">Materials check</h2>
            <p className="mt-2 text-sm text-slate-400">
              {materialCount
                ? `${materialCount} materials ready for generation.`
                : "Upload materials before generating the blueprint."}
            </p>
            {isTeacher ? (
              <form action={generateBlueprint.bind(null, classRow.id)}>
                <button
                  type="submit"
                  className="mt-6 w-full rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  Generate blueprint
                </button>
              </form>
            ) : (
              <p className="mt-4 text-xs text-slate-500">
                Only teachers can regenerate the blueprint.
              </p>
            )}
          </div>
        </section>

        <section className="mt-10 rounded-3xl border border-white/10 bg-slate-900/70 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Draft editor</h2>
            <Link
              href={`/classes/${classRow.id}`}
              className="text-xs uppercase tracking-[0.3em] text-slate-400 hover:text-slate-200"
            >
              Back to class
            </Link>
          </div>
          <div className="mt-6">
            <BlueprintEditor
              classId={classRow.id}
              blueprint={
                blueprint
                  ? {
                      id: blueprint.id,
                      summary: blueprint.summary ?? "",
                      status: blueprint.status,
                      version: blueprint.version,
                    }
                  : null
              }
              initialDraft={initialDraft}
              isTeacher={isTeacher}
              isOwner={isOwner}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
