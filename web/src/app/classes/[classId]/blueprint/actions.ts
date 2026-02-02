"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildBlueprintPrompt, parseBlueprintResponse } from "@/lib/ai/blueprint";
import { generateTextWithFallback } from "@/lib/ai/providers";

const MAX_MATERIAL_CHARS = 120000;

async function requireTeacherAccess(
  classId: string,
  userId: string,
  supabase: ReturnType<typeof createServerSupabaseClient>
) {
  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id,owner_id,title,subject,level")
    .eq("id", classId)
    .single();

  if (classError || !classRow) {
    return { allowed: false, reason: "Class not found." };
  }

  if (classRow.owner_id === userId) {
    return { allowed: true, classRow };
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .single();

  if (enrollment?.role === "teacher" || enrollment?.role === "ta") {
    return { allowed: true, classRow };
  }

  return { allowed: false, reason: "Teacher access required." };
}

export async function generateBlueprint(classId: string) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed || !access.classRow) {
    redirect(`/classes/${classId}/blueprint?error=${encodeURIComponent(access.reason ?? "Access denied")}`);
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    redirect(`/classes/${classId}/blueprint?error=Server configuration error`);
  }
  const { data: materials } = await admin
    .from("materials")
    .select("id,title,extracted_text,status")
    .eq("class_id", classId)
    .eq("status", "ready");

  if (!materials || materials.length === 0) {
    redirect(`/classes/${classId}/blueprint?error=Upload at least one processed material`);
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
    if (blueprintId) {
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
    redirect(`/classes/${classId}/blueprint?error=${encodeURIComponent(message)}`);
  }
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
