import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { generateBlueprint } from "@/app/classes/[classId]/blueprint/actions";
import { BlueprintEditor } from "@/app/classes/[classId]/blueprint/BlueprintEditor";
import BlueprintTimeoutRetryBanner from "@/app/classes/[classId]/blueprint/BlueprintTimeoutRetryBanner";
import AuthHeader from "@/app/components/AuthHeader";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import MaterialProcessingAutoRefresh from "@/app/classes/[classId]/_components/MaterialProcessingAutoRefresh";
import { AppIcons } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";

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

  const { data: materials } = await supabase
    .from("materials")
    .select("status")
    .eq("class_id", classId);
  const materialCount = materials?.length ?? 0;
  const readyMaterialCount =
    materials?.filter((material) => material.status === "ready").length ?? 0;
  const processingMaterialCount =
    materials?.filter((material) => material.status === "processing").length ?? 0;
  const hasReadyMaterials = readyMaterialCount > 0;

  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const isBlueprintTimeoutError = Boolean(errorMessage && /timed out/i.test(errorMessage));
  const canRetryTimeoutGeneration = isBlueprintTimeoutError && isTeacher && hasReadyMaterials;
  const retryGenerationAction = generateBlueprint.bind(null, classRow.id);
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
    <div className="min-h-screen surface-page text-ui-primary">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: "Blueprint" },
        ]}
      />
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <header className="mb-10 space-y-2">
          <p className="text-sm font-medium text-ui-muted">Course Blueprint</p>
          <h1 className="text-3xl font-semibold">{classRow.title}</h1>
          <p className="text-sm text-ui-muted">
            {classRow.subject || "General"} · {classRow.level || "Mixed level"}
          </p>
        </header>

        {errorMessage && canRetryTimeoutGeneration ? (
          <BlueprintTimeoutRetryBanner
            message={errorMessage}
            retryAction={retryGenerationAction}
          />
        ) : errorMessage ? (
          <TransientFeedbackAlert
            variant="error"
            title="Blueprint generation failed"
            message={errorMessage}
            className="mb-6"
          />
        ) : null}

        {generatedMessage ? (
          <Alert variant="accent" className="mb-6">
            <AlertTitle>Blueprint generated</AlertTitle>
            <AlertDescription>{generatedMessage}</AlertDescription>
          </Alert>
        ) : null}
        {savedMessage ? (
          <Alert variant="accent" className="mb-6">
            <AlertTitle>Draft saved</AlertTitle>
            <AlertDescription>{savedMessage}</AlertDescription>
          </Alert>
        ) : null}
        {approvedMessage ? (
          <Alert variant="accent" className="mb-6">
            <AlertTitle>Blueprint approved</AlertTitle>
            <AlertDescription>{approvedMessage}</AlertDescription>
          </Alert>
        ) : null}
        {publishedMessage ? (
          <Alert variant="success" className="mb-6">
            <AlertTitle>Blueprint published</AlertTitle>
            <AlertDescription>{publishedMessage}</AlertDescription>
          </Alert>
        ) : null}
        {draftedMessage ? (
          <Alert variant="accent" className="mb-6">
            <AlertTitle>Draft version created</AlertTitle>
            <AlertDescription>{draftedMessage}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-3">
          <Card className="rounded-3xl lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle>Blueprint workspace</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ui-muted">
                Edit the draft, approve for overview, and publish when ready.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  <AppIcons.fileText className="h-3.5 w-3.5" />
                  Draft
                </Badge>
                <Badge variant="secondary">Owner review required</Badge>
                <Badge variant="secondary">Publish to unlock student blueprint view</Badge>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-3xl">
            <CardHeader className="pb-3">
              <CardTitle>Materials check</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ui-muted">
                {materialCount === 0
                  ? "Upload materials before generating the blueprint."
                  : readyMaterialCount > 0
                    ? `${readyMaterialCount} of ${materialCount} materials are processed and ready.`
                    : "Materials uploaded, but none are processed yet."}
              </p>
              <MaterialProcessingAutoRefresh processingCount={processingMaterialCount} />
              {isTeacher ? (
                <form action={generateBlueprint.bind(null, classRow.id)}>
                  <PendingSubmitButton
                    label="Generate blueprint"
                    pendingLabel="Generating blueprint..."
                    disabled={!hasReadyMaterials}
                    variant="warm"
                    className="mt-6 w-full"
                  />
                  {!hasReadyMaterials ? (
                    <p className="mt-3 text-xs text-ui-muted">
                      {materialCount > 0
                        ? processingMaterialCount > 0
                          ? `${processingMaterialCount} material${processingMaterialCount === 1 ? " is" : "s are"} still processing.`
                          : "At least one processed material is required."
                        : "Upload at least one material to enable blueprint generation."}
                    </p>
                  ) : null}
                </form>
              ) : (
                <p className="mt-4 text-xs text-ui-muted">
                  Only teachers can regenerate the blueprint.
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="mt-10 rounded-3xl">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Draft editor</CardTitle>
              <Link
                href={`/classes/${classRow.id}`}
                className="ui-motion-color text-xs font-medium text-ui-muted hover:text-ui-subtle"
              >
                Back to class
              </Link>
            </div>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
