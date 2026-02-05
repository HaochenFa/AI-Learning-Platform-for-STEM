import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { publishBlueprint } from "@/app/classes/[classId]/blueprint/actions";
import AuthHeader from "@/app/components/AuthHeader";

export const dynamic = "force-dynamic";

type SearchParams = {
  approved?: string;
};

export default async function BlueprintOverviewPage({
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
    .select("id,title,subject,level,owner_id")
    .eq("id", classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  if (classRow.owner_id !== user.id) {
    redirect(
      `/classes/${classId}/blueprint?error=${encodeURIComponent(
        "Only the class owner can view the overview.",
      )}`,
    );
  }

  const { data: blueprint } = await supabase
    .from("blueprints")
    .select("id,summary,status,version,approved_at,published_at")
    .eq("class_id", classId)
    .in("status", ["approved", "published"])
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!blueprint) {
    redirect(
      `/classes/${classId}/blueprint?error=${encodeURIComponent(
        "No approved blueprint available.",
      )}`,
    );
  }

  const { data: topics } = await supabase
    .from("topics")
    .select("id,title,description,section,sequence,prerequisite_topic_ids")
    .eq("blueprint_id", blueprint.id)
    .order("sequence", { ascending: true });

  const { data: objectives } =
    topics && topics.length > 0
      ? await supabase
          .from("objectives")
          .select("topic_id,statement,level")
          .in(
            "topic_id",
            topics.map((topic) => topic.id),
          )
      : { data: null };

  const objectivesByTopic = new Map<string, { statement: string; level?: string | null }[]>();
  objectives?.forEach((objective) => {
    const list = objectivesByTopic.get(objective.topic_id) ?? [];
    list.push({ statement: objective.statement, level: objective.level });
    objectivesByTopic.set(objective.topic_id, list);
  });

  const titleById = new Map<string, string>();
  topics?.forEach((topic) => {
    titleById.set(topic.id, topic.title);
  });

  const approvedMessage =
    resolvedSearchParams?.approved === "1"
      ? "Blueprint approved. Review the compiled overview before publishing."
      : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AuthHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: "Blueprint", href: `/classes/${classRow.id}/blueprint` },
          { label: "Overview" },
        ]}
      />
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Blueprint Overview</p>
            <h1 className="text-3xl font-semibold">{classRow.title}</h1>
            <p className="text-sm text-slate-400">
              {classRow.subject || "STEM"} · {classRow.level || "Mixed level"}
            </p>
          </div>
          <Link
            href={`/classes/${classRow.id}/blueprint`}
            className="text-xs uppercase tracking-[0.3em] text-slate-400 hover:text-slate-200"
          >
            Back to editor
          </Link>
        </header>

        {approvedMessage ? (
          <div className="mb-6 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {approvedMessage}
          </div>
        ) : null}

        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Version {blueprint.version}
              </p>
              <p className="text-sm text-slate-300">Status: {blueprint.status}</p>
            </div>
            {blueprint.status === "approved" ? (
              <form action={publishBlueprint.bind(null, classRow.id, blueprint.id)}>
                <button
                  type="submit"
                  className="rounded-full bg-cyan-400/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950"
                >
                  Publish blueprint
                </button>
              </form>
            ) : (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-emerald-200">
                Published
              </span>
            )}
          </div>
        </div>

        <section className="mt-10 rounded-4xl border border-white/10 bg-white text-slate-900 shadow-2xl">
          <div className="border-b border-slate-200 px-10 py-8">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Compiled Blueprint</p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-900">{classRow.title}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {classRow.subject || "STEM"} · {classRow.level || "Mixed level"}
            </p>
          </div>
          <div className="px-10 py-8">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                Summary
              </p>
              <p className="mt-3 text-base text-slate-700">
                {blueprint.summary || "No summary provided."}
              </p>
            </div>

            <div className="mt-8 space-y-6">
              {topics && topics.length > 0 ? (
                topics.map((topic) => (
                  <div key={topic.id} className="rounded-2xl border border-slate-200 bg-white p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xl font-semibold text-slate-900">{topic.title}</h3>
                        {topic.section ? (
                          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                            Section: {topic.section}
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
                        Sequence {topic.sequence}
                      </span>
                    </div>
                    {topic.description ? (
                      <p className="mt-3 text-sm text-slate-600">{topic.description}</p>
                    ) : null}
                    {topic.prerequisite_topic_ids.length > 0 ? (
                      <p className="mt-3 text-xs text-slate-500">
                        Prerequisites:{" "}
                        {topic.prerequisite_topic_ids
                          .map((id: string) => titleById.get(id))
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    ) : null}
                    <ul className="mt-4 space-y-2 text-sm text-slate-700">
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
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                  No topics found in this blueprint.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
