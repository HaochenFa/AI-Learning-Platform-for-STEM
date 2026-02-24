import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import AuthHeader from "@/app/components/AuthHeader";

export default async function BlueprintPublishedPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
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

  const { data: blueprint } = await supabase
    .from("blueprints")
    .select("id,summary,version,published_at")
    .eq("class_id", classId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!blueprint) {
    redirect(
      `/classes/${classId}?error=${encodeURIComponent("No published blueprint available.")}`,
    );
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id || enrollment?.role === "teacher" || enrollment?.role === "ta";

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

  return (
    <div className="min-h-screen surface-page text-ui-primary">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: "Blueprint", href: `/classes/${classRow.id}/blueprint` },
          { label: "Published" },
        ]}
      />
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ui-muted">Published Blueprint</p>
            <h1 className="text-3xl font-semibold">{classRow.title}</h1>
            <p className="text-sm text-ui-muted">
              {classRow.subject || "General"} · {classRow.level || "Mixed level"}
            </p>
          </div>
          <Link
            href={`/classes/${classRow.id}`}
            className="ui-motion-color text-xs font-medium text-ui-muted hover:text-ui-subtle"
          >
            Back to class
          </Link>
        </header>

        <div className="rounded-3xl border border-default bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-ui-muted">
                Version {blueprint.version}
              </p>
              <p className="text-sm text-ui-muted">
                Published{" "}
                {blueprint.published_at
                  ? new Date(blueprint.published_at).toLocaleDateString()
                  : ""}
              </p>
            </div>
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs uppercase tracking-[0.2em] text-emerald-700">
              Published
            </span>
          </div>
        </div>

        <section className="mt-10 rounded-4xl border border-default bg-white text-ui-primary shadow-2xl">
          <div className="border-b border-default px-10 py-8">
            <p className="text-xs uppercase tracking-[0.3em] text-ui-muted">Compiled Blueprint</p>
            <h2 className="mt-3 text-3xl font-semibold text-ui-primary">{classRow.title}</h2>
            <p className="mt-2 text-sm text-ui-muted">
              {classRow.subject || "General"} · {classRow.level || "Mixed level"}
            </p>
          </div>
          <div className="px-10 py-8">
            <div className="rounded-2xl border border-default bg-[var(--surface-muted)] p-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-ui-muted">
                Summary
              </p>
              <p className="mt-3 text-base text-ui-subtle">
                {blueprint.summary || "No summary provided."}
              </p>
            </div>

            <div className="mt-8 space-y-6">
              {topics && topics.length > 0 ? (
                topics.map((topic) => (
                  <div key={topic.id} className="rounded-2xl border border-default bg-white p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xl font-semibold text-ui-primary">{topic.title}</h3>
                        {topic.section ? (
                          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-ui-muted">
                            Section: {topic.section}
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full border border-default px-3 py-1 text-xs text-ui-muted">
                        Sequence {topic.sequence}
                      </span>
                    </div>
                    {topic.description ? (
                      <p className="mt-3 text-sm text-ui-muted">{topic.description}</p>
                    ) : null}
                    {topic.prerequisite_topic_ids.length > 0 ? (
                      <p className="mt-3 text-xs text-ui-muted">
                        Prerequisites:{" "}
                        {topic.prerequisite_topic_ids
                          .map((id: string) => titleById.get(id))
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    ) : null}
                    <ul className="mt-4 space-y-2 text-sm text-ui-subtle">
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
                <div className="rounded-2xl border border-dashed border-default bg-[var(--surface-muted)] p-6 text-sm text-ui-muted">
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
