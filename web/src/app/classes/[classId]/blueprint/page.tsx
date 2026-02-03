import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { generateBlueprint } from "@/app/classes/[classId]/blueprint/actions";

type SearchParams = {
  error?: string;
  generated?: string;
};

export default async function BlueprintPage({
  params,
  searchParams,
}: {
  params: { classId: string };
  searchParams?: SearchParams;
}) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: classRow } = await supabase
    .from("classes")
    .select("id,title,description,subject,level,owner_id")
    .eq("id", params.classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", params.classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id ||
    enrollment?.role === "teacher" ||
    enrollment?.role === "ta";

  const { data: blueprint } = await supabase
    .from("blueprints")
    .select("id,summary,status,version,created_at")
    .eq("class_id", params.classId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: topics } = blueprint
    ? await supabase
        .from("topics")
        .select("id,title,description,sequence,prerequisite_topic_ids")
        .eq("blueprint_id", blueprint.id)
        .order("sequence", { ascending: true })
    : { data: null };

  const { data: objectives } =
    topics && topics.length > 0
      ? await supabase
          .from("objectives")
          .select("topic_id,statement,level")
          .in(
            "topic_id",
            topics.map((topic) => topic.id)
          )
      : { data: null };

  const objectivesByTopic = new Map<string, { statement: string; level?: string | null }[]>();
  objectives?.forEach((objective) => {
    const list = objectivesByTopic.get(objective.topic_id) ?? [];
    list.push({ statement: objective.statement, level: objective.level });
    objectivesByTopic.set(objective.topic_id, list);
  });

  const { count: materialCount } = await supabase
    .from("materials")
    .select("id", { count: "exact", head: true })
    .eq("class_id", params.classId);

  const errorMessage =
    typeof searchParams?.error === "string" ? searchParams.error : null;
  const generatedMessage =
    searchParams?.generated === "1" ? "Blueprint generated in draft mode." : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <header className="mb-10 space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Course Blueprint
          </p>
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

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold">Blueprint summary</h2>
            <p className="mt-2 text-sm text-slate-400">
              {blueprint?.summary ||
                "No blueprint yet. Generate one from your uploaded materials."}
            </p>
            {blueprint ? (
              <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
                <span className="rounded-full border border-white/10 px-3 py-1">
                  Version {blueprint.version}
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1">
                  Status: {blueprint.status}
                </span>
              </div>
            ) : null}
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
            <h2 className="text-lg font-semibold">Topics</h2>
            <Link
              href={`/classes/${classRow.id}`}
              className="text-xs uppercase tracking-[0.3em] text-slate-400 hover:text-slate-200"
            >
              Back to class
            </Link>
          </div>
          <div className="mt-4 space-y-4">
            {topics && topics.length > 0 ? (
              topics.map((topic) => (
                <div
                  key={topic.id}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold">{topic.title}</h3>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                      Sequence {topic.sequence}
                    </span>
                  </div>
                  {topic.description ? (
                    <p className="mt-2 text-sm text-slate-400">
                      {topic.description}
                    </p>
                  ) : null}
                  <ul className="mt-3 space-y-1 text-sm text-slate-400">
                    {(objectivesByTopic.get(topic.id) ?? []).map((objective, index) => (
                      <li key={`${topic.id}-objective-${index}`}>
                        - {objective.statement}
                        {objective.level ? ` (${objective.level})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                No topics yet. Generate a blueprint to populate this list.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
