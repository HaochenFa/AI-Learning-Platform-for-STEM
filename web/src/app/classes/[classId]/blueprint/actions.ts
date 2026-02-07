"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  DEFAULT_BLUEPRINT_SCHEMA_VERSION,
  buildBlueprintPrompt,
  parseBlueprintResponse,
} from "@/lib/ai/blueprint";
import type { BloomLevel, BlueprintPayload, BlueprintTopic } from "@/lib/ai/blueprint";
import { generateTextWithFallback } from "@/lib/ai/providers";
import { retrieveMaterialContext } from "@/lib/materials/retrieval";
import { requireVerifiedUser } from "@/lib/auth/session";

const DRAFT_ALREADY_EXISTS_MESSAGE = "A draft version already exists. Open it to continue editing.";
const BLUEPRINT_REQUEST_PURPOSE = "blueprint_generation_v2";

type DraftObjectiveInput = {
  id?: string;
  statement: string;
  level?: string | null;
};

type DraftTopicInput = {
  id?: string;
  clientId: string;
  title: string;
  description?: string | null;
  section?: string | null;
  sequence: number;
  prerequisiteClientIds?: string[];
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
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
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

  const seenClientIds = new Set<string>();
  const seenSequences = new Set<number>();
  payload.topics.forEach((topic, index) => {
    if (!isNonEmptyString(topic.clientId)) {
      throw new Error(`Topic ${index + 1} client id is required.`);
    }
    if (seenClientIds.has(topic.clientId)) {
      throw new Error(`Topic ${index + 1} client id must be unique.`);
    }
    seenClientIds.add(topic.clientId);
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
    if (topic.prerequisiteClientIds && !Array.isArray(topic.prerequisiteClientIds)) {
      throw new Error(`Topic ${index + 1} prerequisite client ids must be an array.`);
    }
    if (Array.isArray(topic.prerequisiteClientIds)) {
      topic.prerequisiteClientIds.forEach((clientId, prereqIndex) => {
        if (!isNonEmptyString(clientId)) {
          throw new Error(`Topic ${index + 1} prerequisite ${prereqIndex + 1} is invalid.`);
        }
      });
    }
    topic.objectives.forEach((objective, objectiveIndex) => {
      if (!isNonEmptyString(objective.statement)) {
        throw new Error(`Objective ${objectiveIndex + 1} for topic ${index + 1} is required.`);
      }
    });
  });

  return payload;
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function makeClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasCycle(graph: Map<string, string[]>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): boolean => {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }
    visiting.add(node);
    const edges = graph.get(node) ?? [];
    for (const next of edges) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  for (const node of graph.keys()) {
    if (visit(node)) {
      return true;
    }
  }
  return false;
}

function validatePrerequisites(topics: DraftTopicInput[]) {
  const clientIds = new Set(topics.map((topic) => topic.clientId));
  const graph = new Map<string, string[]>();

  for (const topic of topics) {
    // Ensure every topic is represented even if it has no prerequisites.
    const prereqs = topic.prerequisiteClientIds ?? [];
    for (const prereq of prereqs) {
      if (!clientIds.has(prereq)) {
        throw new Error("Prerequisite references a missing topic.");
      }
      if (prereq === topic.clientId) {
        throw new Error("Prerequisite cannot reference itself.");
      }
    }
    graph.set(topic.clientId, prereqs);
  }

  if (hasCycle(graph)) {
    throw new Error("Prerequisite graph contains a cycle.");
  }

  return graph;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

const BLOOM_LEVEL_SET = new Set<BloomLevel>([
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
]);

function normalizeBloomLevel(level?: string | null): BloomLevel | undefined {
  if (!level) {
    return undefined;
  }
  const normalized = level.trim().toLowerCase();
  return BLOOM_LEVEL_SET.has(normalized as BloomLevel) ? (normalized as BloomLevel) : undefined;
}

function slugifyKey(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function parseStoredBlueprintContent(raw: unknown): BlueprintPayload | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!summary) {
    return null;
  }

  const topics = Array.isArray(record.topics) ? record.topics : [];
  if (topics.length === 0) {
    return null;
  }

  return {
    schemaVersion:
      typeof record.schemaVersion === "string" ? record.schemaVersion : DEFAULT_BLUEPRINT_SCHEMA_VERSION,
    summary,
    assumptions: Array.isArray(record.assumptions)
      ? record.assumptions.filter((value): value is string => typeof value === "string")
      : [],
    uncertaintyNotes: Array.isArray(record.uncertaintyNotes)
      ? record.uncertaintyNotes.filter((value): value is string => typeof value === "string")
      : [],
    qualityRubric: toRecord(record.qualityRubric)
      ? {
          coverageCompleteness:
            (toRecord(record.qualityRubric)?.coverageCompleteness as "low" | "medium" | "high") ??
            "medium",
          logicalProgression:
            (toRecord(record.qualityRubric)?.logicalProgression as "low" | "medium" | "high") ??
            "medium",
          evidenceGrounding:
            (toRecord(record.qualityRubric)?.evidenceGrounding as "low" | "medium" | "high") ??
            "medium",
          notes: Array.isArray(toRecord(record.qualityRubric)?.notes)
            ? (toRecord(record.qualityRubric)?.notes as unknown[]).filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        }
      : undefined,
    topics: topics.filter((topic): topic is BlueprintTopic => Boolean(toRecord(topic))) as BlueprintTopic[],
  };
}

function buildCanonicalBlueprintFromDraft(
  payload: DraftPayload,
  existing?: BlueprintPayload | null,
): BlueprintPayload {
  const usedKeys = new Set<string>();
  const topicKeyByClientId = new Map<string, string>();
  const existingTopicByNormalizedTitle = new Map(
    (existing?.topics ?? []).map((topic) => [topic.title.trim().toLowerCase(), topic]),
  );

  const orderedTopics = [...payload.topics].sort((a, b) => a.sequence - b.sequence);

  for (const [index, topic] of orderedTopics.entries()) {
    let candidate = slugifyKey(topic.title || "") || `topic-${index + 1}`;
    if (candidate.length < 3) {
      candidate = `topic-${index + 1}`;
    }
    let suffix = 2;
    let unique = candidate;
    while (usedKeys.has(unique)) {
      unique = `${candidate}-${suffix}`;
      suffix += 1;
    }
    usedKeys.add(unique);
    topicKeyByClientId.set(topic.clientId, unique);
  }

  return {
    schemaVersion: DEFAULT_BLUEPRINT_SCHEMA_VERSION,
    summary: payload.summary.trim(),
    assumptions: existing?.assumptions ?? [],
    uncertaintyNotes: existing?.uncertaintyNotes ?? [],
    qualityRubric: existing?.qualityRubric ?? {
      coverageCompleteness: "medium",
      logicalProgression: "medium",
      evidenceGrounding: "medium",
      notes: ["Converted from editable draft fields."],
    },
    topics: orderedTopics.map((topic, index) => {
      const key = topicKeyByClientId.get(topic.clientId) ?? `topic-${index + 1}`;
      const existingTopic = existingTopicByNormalizedTitle.get(topic.title.trim().toLowerCase());
      return {
        key,
        title: topic.title.trim(),
        description: topic.description?.trim() || undefined,
        section: topic.section?.trim() || undefined,
        sequence: topic.sequence,
        prerequisites:
          topic.prerequisiteClientIds
            ?.map((clientId) => topicKeyByClientId.get(clientId))
            .filter((value): value is string => Boolean(value)) ?? [],
        objectives: topic.objectives.map((objective) => ({
          statement: objective.statement.trim(),
          level: normalizeBloomLevel(objective.level),
          masteryCriteria: undefined,
          misconceptionAddressed: undefined,
          evidence: [],
        })),
        assessmentIdeas:
          existingTopic?.assessmentIdeas && existingTopic.assessmentIdeas.length > 0
            ? existingTopic.assessmentIdeas
            : [`Formative check focused on ${topic.title.trim()}.`],
        misconceptionFlags: existingTopic?.misconceptionFlags ?? [],
        evidence: existingTopic?.evidence ?? [],
      };
    }),
  };
}

async function fetchNextBlueprintVersion(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  classId: string,
) {
  const { data: latestBlueprint } = await supabase
    .from("blueprints")
    .select("version")
    .eq("class_id", classId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latestBlueprint?.version ? latestBlueprint.version + 1 : 1;
}

async function insertDraftFromPayload({
  supabase,
  classId,
  userId,
  payload,
  prereqGraph,
  canonicalPayload,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  userId: string;
  payload: DraftPayload;
  prereqGraph: Map<string, string[]>;
  canonicalPayload?: BlueprintPayload;
}) {
  const nextVersion = await fetchNextBlueprintVersion(supabase, classId);
  const canonical = canonicalPayload ?? buildCanonicalBlueprintFromDraft(payload);

  const { data: blueprintRow, error: blueprintError } = await supabase
    .from("blueprints")
    .insert({
      class_id: classId,
      version: nextVersion,
      status: "draft",
      summary: payload.summary.trim(),
      content_json: canonical,
      content_schema_version: canonical.schemaVersion ?? DEFAULT_BLUEPRINT_SCHEMA_VERSION,
      created_by: userId,
    })
    .select("id")
    .single();

  if (blueprintError || !blueprintRow) {
    if (blueprintError?.code === "23505") {
      throw new Error(DRAFT_ALREADY_EXISTS_MESSAGE);
    }
    throw new Error(blueprintError?.message ?? "Failed to create draft.");
  }

  const topicIdByClientId = new Map<string, string>();
  const blueprintId = blueprintRow.id;

  try {
    for (const topic of payload.topics) {
      const { data: topicRow, error: topicError } = await supabase
        .from("topics")
        .insert({
          blueprint_id: blueprintId,
          title: topic.title.trim(),
          description: topic.description?.trim() || null,
          section: topic.section?.trim() || null,
          sequence: topic.sequence,
          prerequisite_topic_ids: [],
        })
        .select("id")
        .single();

      if (topicError || !topicRow) {
        throw new Error(topicError?.message ?? "Failed to create topic.");
      }

      topicIdByClientId.set(topic.clientId, topicRow.id);

      const objectives = topic.objectives.map((objective) => ({
        topic_id: topicRow.id,
        statement: objective.statement.trim(),
        level: objective.level?.trim() || null,
      }));

      if (objectives.length > 0) {
        const { error: objectivesError } = await supabase.from("objectives").insert(objectives);

        if (objectivesError) {
          throw new Error(objectivesError.message);
        }
      }
    }

    for (const [clientId, prereqClientIds] of prereqGraph.entries()) {
      if (prereqClientIds.length === 0) {
        continue;
      }
      const topicId = topicIdByClientId.get(clientId);
      if (!topicId) {
        continue;
      }
      const mappedPrereqs = prereqClientIds
        .map((prereqId) => topicIdByClientId.get(prereqId))
        .filter((value): value is string => Boolean(value));

      if (mappedPrereqs.length > 0) {
        const { error: prereqUpdateError } = await supabase
          .from("topics")
          .update({ prerequisite_topic_ids: mappedPrereqs })
          .eq("id", topicId);

        if (prereqUpdateError) {
          throw new Error(prereqUpdateError.message);
        }
      }
    }
  } catch (error) {
    const { error: topicsDeleteError } = await supabase
      .from("topics")
      .delete()
      .eq("blueprint_id", blueprintId);
    if (topicsDeleteError) {
      console.error("Failed to cleanup topics after draft creation error", {
        blueprintId,
        error: topicsDeleteError.message,
      });
    }

    const { error: blueprintDeleteError } = await supabase
      .from("blueprints")
      .delete()
      .eq("id", blueprintId);
    if (blueprintDeleteError) {
      console.error("Failed to cleanup blueprint after draft creation error", {
        blueprintId,
        error: blueprintDeleteError.message,
      });
    }
    throw error;
  }

  return blueprintId;
}

async function rollbackDraftCreation(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  blueprintId: string,
) {
  const { data, error } = await supabase
    .from("blueprints")
    .delete()
    .eq("id", blueprintId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("Failed to rollback draft creation", {
      blueprintId,
      error: error?.message ?? "No rows deleted",
    });
    return error?.message ?? "Rollback delete did not remove the draft.";
  }
  return null;
}

export async function generateBlueprint(classId: string) {
  const { supabase, user } = await requireVerifiedUser({ accountType: "teacher" });

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed) {
    redirectWithError(`/classes/${classId}/blueprint`, access.reason);
    return;
  }

  const classRow = access.classRow;
  if (!classRow) {
    redirectWithError(`/classes/${classId}/blueprint`, "Class not found");
    return;
  }

  const { data: materials } = await supabase
    .from("materials")
    .select("id,title,status")
    .eq("class_id", classId)
    .eq("status", "ready");

  if (!materials || materials.length === 0) {
    redirectWithError(`/classes/${classId}/blueprint`, "Upload at least one processed material");
    return;
  }

  const query = `Course blueprint for ${classRow.title}. Focus on core topics, objectives, prerequisites, and assessment ideas.`;
  let materialText = "";
  try {
    materialText = await retrieveMaterialContext(classId, query);
  } catch (error) {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      error instanceof Error ? error.message : "Failed to retrieve material context.",
    );
    return;
  }
  if (!materialText) {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Materials are still processing. Try again in a few minutes.",
    );
    return;
  }
  const prompt = buildBlueprintPrompt({
    classTitle: classRow.title,
    subject: classRow.subject,
    level: classRow.level,
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

    const { data: latestBlueprint } = await supabase
      .from("blueprints")
      .select("version")
      .eq("class_id", classId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = latestBlueprint?.version ? latestBlueprint.version + 1 : 1;

    const { data: blueprintRow, error: blueprintError } = await supabase
      .from("blueprints")
      .insert({
        class_id: classId,
        version: nextVersion,
        status: "draft",
        summary: payload.summary.trim(),
        content_json: payload,
        content_schema_version: payload.schemaVersion ?? DEFAULT_BLUEPRINT_SCHEMA_VERSION,
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
      const { data: topicRow, error: topicError } = await supabase
        .from("topics")
        .insert({
          blueprint_id: blueprintRow.id,
          title: topic.title.trim(),
          description: topic.description?.trim() || null,
          section: topic.section?.trim() || null,
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
        statement: objective.statement.trim(),
        level: objective.level ?? null,
      }));

      if (objectives.length > 0) {
        const { error: objectivesError } = await supabase.from("objectives").insert(objectives);

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
          const { error: updateError } = await supabase
            .from("topics")
            .update({ prerequisite_topic_ids: prerequisiteIds })
            .eq("id", topicId);

          if (updateError) {
            throw new Error(updateError.message);
          }
        }
      }
    }

    await supabase.from("ai_requests").insert({
      class_id: classId,
      user_id: user.id,
      provider: result.provider,
      model: result.model,
      purpose: BLUEPRINT_REQUEST_PURPOSE,
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
      await supabase.from("topics").delete().eq("blueprint_id", blueprintId);
      await supabase.from("blueprints").delete().eq("id", blueprintId);
    }

    await supabase.from("ai_requests").insert({
      class_id: classId,
      user_id: user.id,
      provider: usedProvider ?? "unknown",
      purpose: BLUEPRINT_REQUEST_PURPOSE,
      latency_ms: Date.now() - start,
      status: "error",
    });
    const message = error instanceof Error ? error.message : "Blueprint generation failed.";
    redirectWithError(`/classes/${classId}/blueprint`, message);
  }
}

export async function saveDraft(classId: string, blueprintId: string, formData: FormData) {
  const { supabase, user } = await requireVerifiedUser({ accountType: "teacher" });

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed) {
    redirectWithError(`/classes/${classId}/blueprint`, access.reason);
    return;
  }

  let payload: DraftPayload;
  try {
    payload = parseDraftPayload(formData.get("draft"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid draft payload.";
    redirectWithError(`/classes/${classId}/blueprint`, message);
    return;
  }

  let prereqGraph: Map<string, string[]>;
  try {
    prereqGraph = validatePrerequisites(payload.topics);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid prerequisites.";
    redirectWithError(`/classes/${classId}/blueprint`, message);
    return;
  }

  const { data: blueprint, error: blueprintError } = await supabase
    .from("blueprints")
    .select("id,status,version,content_json")
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
      "Only the class owner can edit an approved or published blueprint.",
    );
    return;
  }

  if (blueprint.status !== "draft") {
    const { data: existingDraft, error: existingDraftError } = await supabase
      .from("blueprints")
      .select("id")
      .eq("class_id", classId)
      .eq("status", "draft")
      .limit(1)
      .maybeSingle();

    if (existingDraftError) {
      redirectWithError(`/classes/${classId}/blueprint`, existingDraftError.message);
      return;
    }

    if (existingDraft) {
      redirectWithError(`/classes/${classId}/blueprint`, DRAFT_ALREADY_EXISTS_MESSAGE);
      return;
    }

    let newDraftId: string | null = null;
    const canonicalPayload = buildCanonicalBlueprintFromDraft(
      payload,
      parseStoredBlueprintContent(blueprint.content_json),
    );
    try {
      newDraftId = await insertDraftFromPayload({
        supabase,
        classId,
        userId: user.id,
        payload,
        prereqGraph,
        canonicalPayload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create draft.";
      redirectWithError(`/classes/${classId}/blueprint`, message);
      return;
    }

    const { error: archiveError } = await supabase
      .from("blueprints")
      .update({ status: "archived" })
      .eq("id", blueprint.id);

    if (archiveError) {
      const rollbackError = newDraftId ? await rollbackDraftCreation(supabase, newDraftId) : null;
      const rollbackMessage = rollbackError ? ` Rollback issues: ${rollbackError}.` : "";
      redirectWithError(
        `/classes/${classId}/blueprint`,
        `${archiveError.message}${rollbackMessage}`,
      );
      return;
    }

    redirect(`/classes/${classId}/blueprint?draft=1`);
    return;
  }

  const { data: existingTopics, error: existingTopicsError } = await supabase
    .from("topics")
    .select("id")
    .eq("blueprint_id", blueprint.id);

  if (existingTopicsError) {
    redirectWithError(`/classes/${classId}/blueprint`, existingTopicsError.message);
    return;
  }

  const existingTopicIds = new Set(existingTopics?.map((topic) => topic.id));
  const payloadExistingIds = new Set(
    payload.topics.map((topic) => topic.id).filter((id): id is string => Boolean(id)),
  );

  for (const id of payloadExistingIds) {
    if (!existingTopicIds.has(id)) {
      redirectWithError(`/classes/${classId}/blueprint`, "Invalid topic reference.");
      return;
    }
  }

  const { error: updateError } = await supabase
    .from("blueprints")
    .update({
      summary: payload.summary.trim(),
      content_json: buildCanonicalBlueprintFromDraft(
        payload,
        parseStoredBlueprintContent(blueprint.content_json),
      ),
      content_schema_version: DEFAULT_BLUEPRINT_SCHEMA_VERSION,
    })
    .eq("id", blueprint.id);

  if (updateError) {
    redirectWithError(`/classes/${classId}/blueprint`, updateError.message);
    return;
  }

  const savedTopics: DraftTopicInput[] = [];

  for (const topic of payload.topics) {
    if (topic.id) {
      const { error: topicUpdateError } = await supabase
        .from("topics")
        .update({
          title: topic.title.trim(),
          description: topic.description?.trim() || null,
          section: topic.section?.trim() || null,
          sequence: topic.sequence,
        })
        .eq("id", topic.id);

      if (topicUpdateError) {
        redirectWithError(`/classes/${classId}/blueprint`, topicUpdateError.message);
        return;
      }

      savedTopics.push(topic);
    } else {
      const { data: topicRow, error: topicInsertError } = await supabase
        .from("topics")
        .insert({
          blueprint_id: blueprint.id,
          title: topic.title.trim(),
          description: topic.description?.trim() || null,
          section: topic.section?.trim() || null,
          sequence: topic.sequence,
          prerequisite_topic_ids: [],
        })
        .select("id")
        .single();

      if (topicInsertError || !topicRow) {
        redirectWithError(
          `/classes/${classId}/blueprint`,
          topicInsertError?.message ?? "Failed to create topic.",
        );
        return;
      }

      savedTopics.push({ ...topic, id: topicRow.id });
    }
  }

  const savedTopicIds = new Set(
    savedTopics.map((topic) => topic.id).filter((id): id is string => Boolean(id)),
  );

  const topicsToDelete = existingTopics?.filter((topic) => !savedTopicIds.has(topic.id)) ?? [];

  if (topicsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("topics")
      .delete()
      .in(
        "id",
        topicsToDelete.map((topic) => topic.id),
      );

    if (deleteError) {
      redirectWithError(`/classes/${classId}/blueprint`, deleteError.message);
      return;
    }
  }

  const topicIdByClientId = new Map(
    savedTopics
      .map((topic) => [topic.clientId, topic.id] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  for (const [clientId, prereqClientIds] of prereqGraph.entries()) {
    const topicId = topicIdByClientId.get(clientId);
    if (!topicId) {
      continue;
    }
    const mappedPrereqs = prereqClientIds
      .map((prereqId) => topicIdByClientId.get(prereqId))
      .filter((value): value is string => Boolean(value));

    const { error: prereqUpdateError } = await supabase
      .from("topics")
      .update({ prerequisite_topic_ids: mappedPrereqs })
      .eq("id", topicId);

    if (prereqUpdateError) {
      redirectWithError(`/classes/${classId}/blueprint`, prereqUpdateError.message);
      return;
    }
  }

  const savedTopicIdList = Array.from(savedTopicIds);
  const { data: existingObjectives, error: existingObjectivesError } = await supabase
    .from("objectives")
    .select("id,topic_id")
    .in("topic_id", savedTopicIdList);

  if (existingObjectivesError) {
    redirectWithError(`/classes/${classId}/blueprint`, existingObjectivesError.message);
    return;
  }

  const objectivesById = new Map(
    (existingObjectives ?? []).map((objective) => [objective.id, objective.topic_id]),
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
        return;
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
      const { error: upsertObjectivesError } = await supabase
        .from("objectives")
        .upsert(objectives, { onConflict: "id" });

      if (upsertObjectivesError) {
        redirectWithError(`/classes/${classId}/blueprint`, upsertObjectivesError.message);
        return;
      }
    }
  }

  const objectivesToDelete =
    existingObjectives?.filter((objective) => !payloadObjectiveIds.has(objective.id)) ?? [];

  if (objectivesToDelete.length > 0) {
    const { error: deleteObjectivesError } = await supabase
      .from("objectives")
      .delete()
      .in(
        "id",
        objectivesToDelete.map((objective) => objective.id),
      );

    if (deleteObjectivesError) {
      redirectWithError(`/classes/${classId}/blueprint`, deleteObjectivesError.message);
      return;
    }
  }

  redirect(`/classes/${classId}/blueprint?saved=1`);
}

export async function approveBlueprint(classId: string, blueprintId: string) {
  const { supabase, user } = await requireVerifiedUser({ accountType: "teacher" });

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed || !access.isOwner) {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Only the class owner can approve a blueprint.",
    );
    return;
  }

  const { data: blueprint, error } = await supabase
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
    redirectWithError(`/classes/${classId}/blueprint`, "Only drafts can be approved.");
    return;
  }

  const { error: approveError } = await supabase
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
    return;
  }

  redirect(`/classes/${classId}/blueprint/overview?approved=1`);
}

// Creates a new draft based on the latest published blueprint and archives the
// published version. Use publishBlueprint to promote an approved draft.
export async function createDraftFromPublished(classId: string) {
  const { supabase, user } = await requireVerifiedUser({ accountType: "teacher" });

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed || !access.isOwner) {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Only the class owner can create a new draft from the published blueprint.",
    );
    return;
  }

  const { data: existingDraft, error: existingDraftError } = await supabase
    .from("blueprints")
    .select("id")
    .eq("class_id", classId)
    .eq("status", "draft")
    .limit(1)
    .maybeSingle();

  if (existingDraftError) {
    redirectWithError(`/classes/${classId}/blueprint`, existingDraftError.message);
    return;
  }

  if (existingDraft) {
    redirectWithError(`/classes/${classId}/blueprint`, DRAFT_ALREADY_EXISTS_MESSAGE);
    return;
  }

  const { data: publishedBlueprint, error: publishedError } = await supabase
    .from("blueprints")
    .select("id,summary,content_json")
    .eq("class_id", classId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (publishedError || !publishedBlueprint) {
    redirectWithError(`/classes/${classId}/blueprint`, "No published blueprint found.");
    return;
  }

  const { data: topics, error: topicsError } = await supabase
    .from("topics")
    .select("id,title,description,section,sequence,prerequisite_topic_ids")
    .eq("blueprint_id", publishedBlueprint.id)
    .order("sequence", { ascending: true });

  if (topicsError) {
    redirectWithError(`/classes/${classId}/blueprint`, topicsError.message);
    return;
  }

  const clientIdByTopicId = new Map<string, string>();
  topics?.forEach((topic) => {
    clientIdByTopicId.set(topic.id, makeClientId());
  });

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

  const objectivesByTopic = new Map<string, { statement: string; level?: string | null }[]>();
  objectives?.forEach((objective) => {
    const list = objectivesByTopic.get(objective.topic_id) ?? [];
    list.push({ statement: objective.statement, level: objective.level });
    objectivesByTopic.set(objective.topic_id, list);
  });

  const payload: DraftPayload = {
    summary: publishedBlueprint.summary ?? "",
    topics:
      topics?.map((topic) => ({
        clientId: clientIdByTopicId.get(topic.id) ?? makeClientId(),
        title: topic.title,
        description: topic.description ?? null,
        section: topic.section ?? null,
        sequence: topic.sequence,
        prerequisiteClientIds: (topic.prerequisite_topic_ids ?? []).map(
          (id: string) => clientIdByTopicId.get(id) ?? id,
        ),
        objectives: (objectivesByTopic.get(topic.id) ?? []).map((objective) => ({
          statement: objective.statement,
          level: objective.level ?? null,
        })),
      })) ?? [],
  };

  let prereqGraph: Map<string, string[]>;
  try {
    prereqGraph = validatePrerequisites(payload.topics);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid prerequisites.";
    redirectWithError(`/classes/${classId}/blueprint`, message);
    return;
  }

  let newDraftId: string | null = null;
  try {
    const canonicalPayload = buildCanonicalBlueprintFromDraft(
      payload,
      parseStoredBlueprintContent(publishedBlueprint.content_json),
    );
    newDraftId = await insertDraftFromPayload({
      supabase,
      classId,
      userId: user.id,
      payload,
      prereqGraph,
      canonicalPayload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create draft.";
    redirectWithError(`/classes/${classId}/blueprint`, message);
    return;
  }

  const { error: archiveError } = await supabase
    .from("blueprints")
    .update({ status: "archived" })
    .eq("id", publishedBlueprint.id);

  if (archiveError) {
    const rollbackError = newDraftId ? await rollbackDraftCreation(supabase, newDraftId) : null;
    const rollbackMessage = rollbackError ? ` Rollback issues: ${rollbackError}.` : "";
    redirectWithError(`/classes/${classId}/blueprint`, `${archiveError.message}${rollbackMessage}`);
    return;
  }

  redirect(`/classes/${classId}/blueprint?draft=1`);
}

// Publishes an approved draft and archives any older approved/published versions.
export async function publishBlueprint(classId: string, blueprintId: string) {
  const { supabase, user } = await requireVerifiedUser({ accountType: "teacher" });

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed || !access.isOwner) {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Only the class owner can publish a blueprint.",
    );
    return;
  }

  const { data: blueprint, error } = await supabase
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
    return;
  }

  if (blueprint.status !== "approved") {
    redirectWithError(
      `/classes/${classId}/blueprint`,
      "Blueprint must be approved before publishing.",
    );
    return;
  }

  const { error: publishError } = await supabase.rpc("publish_blueprint", {
    p_class_id: classId,
    p_blueprint_id: blueprint.id,
  });

  if (publishError) {
    redirectWithError(`/classes/${classId}/blueprint`, publishError.message);
    return;
  }

  redirect(`/classes/${classId}/blueprint?published=1`);
}
