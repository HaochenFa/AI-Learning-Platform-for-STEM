"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildBlueprintPrompt, parseBlueprintResponse } from "@/lib/ai/blueprint";
import { generateTextWithFallback } from "@/lib/ai/providers";

const MAX_MATERIAL_CHARS = 120000;

type DraftObjectiveInput = {
  id?: string;
  statement: string;
  level?: string | null;
};

type DraftTopicInput = {
  id?: string;
  title: string;
  description?: string | null;
  sequence: number;
  objectives: DraftObjectiveInput[];
};

type DraftPayload = {
  summary: string;
  topics: DraftTopicInput[];
};

function redirectWithError(path: string, message: string) {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function requireTeacherAccess(
  classId: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
) {
  type AccessResult =
    | {
        allowed: true;
        isOwner: boolean;
        classRow: {
          id: string;
          owner_id: string;
          title: string;
          subject: string | null;
          level: string | null;
        };
      }
    | { allowed: false; reason: string };

  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id,owner_id,title,subject,level")
    .eq("id", classId)
    .single();

  if (classError || !classRow) {
    return { allowed: false, reason: "Class not found." } satisfies AccessResult;
  }

  if (classRow.owner_id === userId) {
    return { allowed: true, isOwner: true, classRow } satisfies AccessResult;
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .single();

  if (enrollment?.role === "teacher" || enrollment?.role === "ta") {
    return { allowed: true, isOwner: false, classRow } satisfies AccessResult;
  }

  return {
    allowed: false,
    reason: "Teacher access required.",
  } satisfies AccessResult;
}

function parseDraftPayload(raw: FormDataEntryValue | null): DraftPayload {
  if (!raw || typeof raw !== "string") {
    throw new Error("Draft payload is missing.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Draft payload is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Draft payload is invalid.");
  }

  const payload = parsed as DraftPayload;

  if (!isNonEmptyString(payload.summary)) {
    throw new Error("Blueprint summary is required.");
  }

  if (!Array.isArray(payload.topics) || payload.topics.length === 0) {
    throw new Error("At least one topic is required.");
  }

  const seenSequences = new Set<number>();
  payload.topics.forEach((topic, index) => {
    if (!isNonEmptyString(topic.title)) {
      throw new Error(`Topic ${index + 1} title is required.`);
    }
    if (typeof topic.sequence !== "number" || Number.isNaN(topic.sequence)) {
      throw new Error(`Topic ${index + 1} sequence must be a number.`);
    }
    if (!Number.isInteger(topic.sequence)) {
      throw new Error(`Topic ${index + 1} sequence must be an integer.`);
    }
    if (topic.sequence < 1 || topic.sequence > 1000) {
      throw new Error(`Topic ${index + 1} sequence must be between 1 and 1000.`);
    }
    if (seenSequences.has(topic.sequence)) {
      throw new Error(`Topic ${index + 1} sequence must be unique.`);
    }
    seenSequences.add(topic.sequence);
    if (!Array.isArray(topic.objectives) || topic.objectives.length === 0) {
      throw new Error(`Topic ${index + 1} must include objectives.`);
    }
    topic.objectives.forEach((objective, objectiveIndex) => {
      if (!isNonEmptyString(objective.statement)) {
        throw new Error(
          `Objective ${objectiveIndex + 1} for topic ${index + 1} is required.`
        );
      }
    });
  });

  return payload;
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export async function generateBlueprint(classId: string) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed) {
    redirectWithError(`/classes/${classId}/blueprint`, access.reason);
  }

  if (!access.classRow) {
    redirectWithError(`/classes/${classId}/blueprint`, "Class not found");
    return;
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    redirectWithError(`/classes/${classId}/blueprint`, "Server configuration error");
    return;
  }
  const { data: materials } = await admin
    .from("materials")
    .select("id,title,extracted_text,status")
    .eq("class_id", classId)
    .eq("status", "ready");

  if (!materials || materials.length === 0) {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Upload at least one processed material"
    );
    return;
  }

  const materialText = buildMaterialContext(materials);
  const prompt = buildBlueprintPrompt({
    classTitle: access.classRow.title,
    subject: access.classRow.subject,
    level: access.classRow.level,
    materialCount: materials.length,
    materialText,
  });

  const start = Date.now();
  let blueprintId: string | null = null;
  let usedProvider: string | null = null;
  try {
    const result = await generateTextWithFallback({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      maxTokens: 1600,
    });
    usedProvider = result.provider;

    const payload = parseBlueprintResponse(result.content);

    const { data: latestBlueprint } = await admin
      .from("blueprints")
      .select("version")
      .eq("class_id", classId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = latestBlueprint?.version
      ? latestBlueprint.version + 1
      : 1;

    const { data: blueprintRow, error: blueprintError } = await admin
      .from("blueprints")
      .insert({
        class_id: classId,
        version: nextVersion,
        status: "draft",
        summary: payload.summary,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (blueprintError || !blueprintRow) {
      throw new Error(blueprintError?.message ?? "Failed to save blueprint.");
    }
    blueprintId = blueprintRow.id;

    const topicIdByKey = new Map<string, string>();

    for (const topic of payload.topics) {
      const { data: topicRow, error: topicError } = await admin
        .from("topics")
        .insert({
          blueprint_id: blueprintRow.id,
          title: topic.title,
          description: topic.description ?? null,
          sequence: topic.sequence,
          prerequisite_topic_ids: [],
        })
        .select("id")
        .single();

      if (topicError || !topicRow) {
        throw new Error(topicError?.message ?? "Failed to save topic.");
      }

      topicIdByKey.set(topic.key, topicRow.id);

      const objectives = topic.objectives.map((objective) => ({
        topic_id: topicRow.id,
        statement: objective.statement,
        level: objective.level ?? null,
      }));

      if (objectives.length > 0) {
        const { error: objectivesError } = await admin
          .from("objectives")
          .insert(objectives);

        if (objectivesError) {
          throw new Error(objectivesError.message);
        }
      }
    }

    for (const topic of payload.topics) {
      const prerequisiteIds =
        topic.prerequisites
          ?.map((key) => topicIdByKey.get(key))
          .filter((value): value is string => Boolean(value)) ?? [];

      if (prerequisiteIds.length > 0) {
        const topicId = topicIdByKey.get(topic.key);
        if (topicId) {
          const { error: updateError } = await admin
            .from("topics")
            .update({ prerequisite_topic_ids: prerequisiteIds })
            .eq("id", topicId);

          if (updateError) {
            throw new Error(updateError.message);
          }
        }
      }
    }

    await admin.from("ai_requests").insert({
      class_id: classId,
      user_id: user.id,
      provider: result.provider,
      model: result.model,
      purpose: "blueprint_generation",
      prompt_tokens: result.usage?.promptTokens ?? null,
      completion_tokens: result.usage?.completionTokens ?? null,
      total_tokens: result.usage?.totalTokens ?? null,
      latency_ms: result.latencyMs,
      status: "success",
    });

    redirect(`/classes/${classId}/blueprint?generated=1`);
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    if (blueprintId) {
      await admin.from("topics").delete().eq("blueprint_id", blueprintId);
      await admin.from("blueprints").delete().eq("id", blueprintId);
    }

    await admin.from("ai_requests").insert({
      class_id: classId,
      user_id: user.id,
      provider: usedProvider ?? "unknown",
      purpose: "blueprint_generation",
      latency_ms: Date.now() - start,
      status: "error",
    });
    const message = error instanceof Error ? error.message : "Blueprint generation failed.";
    redirectWithError(`/classes/${classId}/blueprint`, message);
  }
}

export async function saveDraft(
  classId: string,
  blueprintId: string,
  formData: FormData
) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed) {
    redirectWithError(`/classes/${classId}/blueprint`, access.reason);
  }

  let payload: DraftPayload;
  try {
    payload = parseDraftPayload(formData.get("draft"));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid draft payload.";
    redirectWithError(`/classes/${classId}/blueprint`, message);
    return;
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    redirectWithError(`/classes/${classId}/blueprint`, "Server configuration error");
    return;
  }

  const { data: blueprint, error: blueprintError } = await admin
    .from("blueprints")
    .select("id,status")
    .eq("id", blueprintId)
    .eq("class_id", classId)
    .single();

  if (blueprintError || !blueprint) {
    redirectWithError(`/classes/${classId}/blueprint`, "Blueprint not found.");
    return;
  }

  if (blueprint.status !== "draft" && !access.isOwner) {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Only the class owner can edit an approved or published blueprint."
    );
  }

  const updatePayload: Record<string, unknown> = {
    summary: payload.summary.trim(),
  };

  const { data: existingTopics, error: existingTopicsError } = await admin
    .from("topics")
    .select("id,prerequisite_topic_ids")
    .eq("blueprint_id", blueprint.id);

  if (existingTopicsError) {
    redirectWithError(`/classes/${classId}/blueprint`, existingTopicsError.message);
  }

  const existingTopicIds = new Set(existingTopics?.map((topic) => topic.id));
  const payloadExistingIds = new Set(
    payload.topics
      .map((topic) => topic.id)
      .filter((id): id is string => Boolean(id))
  );

  for (const id of payloadExistingIds) {
    if (!existingTopicIds.has(id)) {
      redirectWithError(`/classes/${classId}/blueprint`, "Invalid topic reference.");
    }
  }

  if (blueprint.status !== "draft") {
    updatePayload.status = "draft";
    updatePayload.approved_by = null;
    updatePayload.approved_at = null;
    updatePayload.published_by = null;
    updatePayload.published_at = null;
  }

  const { error: updateError } = await admin
    .from("blueprints")
    .update(updatePayload)
    .eq("id", blueprint.id);

  if (updateError) {
    redirectWithError(`/classes/${classId}/blueprint`, updateError.message);
  }

  const topicsById = new Map(
    (existingTopics ?? []).map((topic) => [topic.id, topic])
  );

  const savedTopics: DraftTopicInput[] = [];

  for (const topic of payload.topics) {
    if (topic.id) {
      const { error: topicUpdateError } = await admin
        .from("topics")
        .update({
          title: topic.title.trim(),
          description: topic.description?.trim() || null,
          sequence: topic.sequence,
        })
        .eq("id", topic.id);

      if (topicUpdateError) {
        redirectWithError(`/classes/${classId}/blueprint`, topicUpdateError.message);
      }

      savedTopics.push(topic);
    } else {
      const { data: topicRow, error: topicInsertError } = await admin
        .from("topics")
        .insert({
          blueprint_id: blueprint.id,
          title: topic.title.trim(),
          description: topic.description?.trim() || null,
          sequence: topic.sequence,
          prerequisite_topic_ids: [],
        })
        .select("id")
        .single();

      if (topicInsertError || !topicRow) {
        redirectWithError(
          `/classes/${classId}/blueprint`,
          topicInsertError?.message ?? "Failed to create topic."
        );
        return;
      }

      savedTopics.push({ ...topic, id: topicRow.id });
    }
  }

  const savedTopicIds = new Set(
    savedTopics.map((topic) => topic.id).filter((id): id is string => Boolean(id))
  );

  const topicsToDelete =
    existingTopics?.filter((topic) => !savedTopicIds.has(topic.id)) ?? [];

  if (topicsToDelete.length > 0) {
    const { error: deleteError } = await admin
      .from("topics")
      .delete()
      .in(
        "id",
        topicsToDelete.map((topic) => topic.id)
      );

    if (deleteError) {
      redirectWithError(`/classes/${classId}/blueprint`, deleteError.message);
    }
  }

  for (const topic of savedTopics) {
    if (!topic.id) {
      continue;
    }
    const existingPrereqs =
      topicsById.get(topic.id)?.prerequisite_topic_ids ?? [];
    const filteredPrereqs = existingPrereqs.filter((id: string) =>
      savedTopicIds.has(id)
    );

    const { error: prereqUpdateError } = await admin
      .from("topics")
      .update({ prerequisite_topic_ids: filteredPrereqs })
      .eq("id", topic.id);

    if (prereqUpdateError) {
      redirectWithError(`/classes/${classId}/blueprint`, prereqUpdateError.message);
    }
  }

  const savedTopicIdList = Array.from(savedTopicIds);
  const { data: existingObjectives, error: existingObjectivesError } = await admin
    .from("objectives")
    .select("id,topic_id")
    .in("topic_id", savedTopicIdList);

  if (existingObjectivesError) {
    redirectWithError(`/classes/${classId}/blueprint`, existingObjectivesError.message);
  }

  const objectivesById = new Map(
    (existingObjectives ?? []).map((objective) => [objective.id, objective.topic_id])
  );
  const payloadObjectiveIds = new Set<string>();

  for (const topic of savedTopics) {
    if (!topic.id) {
      continue;
    }
    for (const objective of topic.objectives) {
      if (!objective.id) {
        continue;
      }
      const existingTopicId = objectivesById.get(objective.id);
      if (!existingTopicId || existingTopicId !== topic.id) {
        redirectWithError(`/classes/${classId}/blueprint`, "Invalid objective reference.");
      }
      payloadObjectiveIds.add(objective.id);
    }
  }

  for (const topic of savedTopics) {
    if (!topic.id) {
      continue;
    }
    const objectives = topic.objectives.map((objective) => ({
      id: objective.id ?? crypto.randomUUID(),
      topic_id: topic.id,
      statement: objective.statement.trim(),
      level: objective.level?.trim() || null,
    }));

    if (objectives.length > 0) {
      const { error: upsertObjectivesError } = await admin
        .from("objectives")
        .upsert(objectives, { onConflict: "id" });

      if (upsertObjectivesError) {
        redirectWithError(
          `/classes/${classId}/blueprint`,
          upsertObjectivesError.message
        );
      }
    }
  }

  const objectivesToDelete =
    existingObjectives?.filter((objective) => !payloadObjectiveIds.has(objective.id)) ??
    [];

  if (objectivesToDelete.length > 0) {
    const { error: deleteObjectivesError } = await admin
      .from("objectives")
      .delete()
      .in(
        "id",
        objectivesToDelete.map((objective) => objective.id)
      );

    if (deleteObjectivesError) {
      redirectWithError(`/classes/${classId}/blueprint`, deleteObjectivesError.message);
    }
  }

  redirect(`/classes/${classId}/blueprint?saved=1`);
}

export async function approveBlueprint(classId: string, blueprintId: string) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed || !access.isOwner) {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Only the class owner can approve a blueprint."
    );
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    redirectWithError(`/classes/${classId}/blueprint`, "Server configuration error");
    return;
  }
  const { data: blueprint, error } = await admin
    .from("blueprints")
    .select("id,status")
    .eq("id", blueprintId)
    .eq("class_id", classId)
    .single();

  if (error || !blueprint) {
    redirectWithError(`/classes/${classId}/blueprint`, "Blueprint not found.");
    return;
  }

  if (blueprint.status !== "draft") {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Only drafts can be approved."
    );
  }

  const { error: approveError } = await admin
    .from("blueprints")
    .update({
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      published_by: null,
      published_at: null,
    })
    .eq("id", blueprint.id);

  if (approveError) {
    redirectWithError(`/classes/${classId}/blueprint`, approveError.message);
  }

  redirect(`/classes/${classId}/blueprint/overview?approved=1`);
}

export async function publishBlueprint(classId: string, blueprintId: string) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed || !access.isOwner) {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Only the class owner can publish a blueprint."
    );
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    redirectWithError(`/classes/${classId}/blueprint`, "Server configuration error");
    return;
  }
  const { data: blueprint, error } = await admin
    .from("blueprints")
    .select("id,status")
    .eq("id", blueprintId)
    .eq("class_id", classId)
    .single();

  if (error || !blueprint) {
    redirectWithError(`/classes/${classId}/blueprint`, "Blueprint not found.");
    return;
  }

  if (blueprint.status === "published") {
    redirect(`/classes/${classId}/blueprint?published=1`);
  }

  if (blueprint.status !== "approved") {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Blueprint must be approved before publishing."
    );
  }

  const { data: archivedBlueprints, error: archiveError } = await admin
    .from("blueprints")
    .update({ status: "archived" })
    .eq("class_id", classId)
    .eq("status", "published")
    .neq("id", blueprint.id)
    .select("id");

  if (archiveError) {
    redirectWithError(`/classes/${classId}/blueprint`, archiveError.message);
  }

  const { error: publishError } = await admin
    .from("blueprints")
    .update({
      status: "published",
      published_by: user.id,
      published_at: new Date().toISOString(),
    })
    .eq("id", blueprint.id);

  if (publishError) {
    if (archivedBlueprints && archivedBlueprints.length > 0) {
      await admin
        .from("blueprints")
        .update({ status: "published" })
        .in(
          "id",
          archivedBlueprints.map((row) => row.id)
        );
    }
    redirectWithError(`/classes/${classId}/blueprint`, publishError.message);
  }

  redirect(`/classes/${classId}/blueprint?published=1`);
}

function buildMaterialContext(
  materials: { title: string; extracted_text: string | null }[]
) {
  const joined = materials
    .map((material) => `### ${material.title}\n${material.extracted_text ?? ""}`)
    .join("\n\n");

  if (joined.length <= MAX_MATERIAL_CHARS) {
    return joined;
  }

  return `${joined.slice(0, MAX_MATERIAL_CHARS)}\n\n[Truncated due to size]`;
}
