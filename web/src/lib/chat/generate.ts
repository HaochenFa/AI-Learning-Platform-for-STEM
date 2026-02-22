import "server-only";

import { generateTextWithFallback } from "@/lib/ai/providers";
import { buildChatPrompt, loadPublishedBlueprintContext } from "@/lib/chat/context";
import type { ChatModelResponse, ChatTurn } from "@/lib/chat/types";
import { parseChatModelResponse } from "@/lib/chat/validation";
import { retrieveMaterialContext } from "@/lib/materials/retrieval";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type GroundedChatPurpose =
  | "student_chat_open_v2"
  | "student_chat_assignment_v2"
  | "student_chat_always_on_v1"
  | "teacher_chat_always_on_v1";

function resolveOpenRouterTransforms() {
  const raw = process.env.OPENROUTER_CHAT_TRANSFORMS;
  if (!raw) {
    return undefined;
  }
  const transforms = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return transforms.length > 0 ? transforms : undefined;
}

async function logChatAiRequest(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  userId: string;
  provider: string;
  model?: string | null;
  purpose: GroundedChatPurpose;
  status: string;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}) {
  const { error } = await input.supabase.from("ai_requests").insert({
    class_id: input.classId,
    user_id: input.userId,
    provider: input.provider,
    model: input.model ?? null,
    purpose: input.purpose,
    status: input.status,
    latency_ms: input.latencyMs,
    prompt_tokens: input.promptTokens ?? null,
    completion_tokens: input.completionTokens ?? null,
    total_tokens: input.totalTokens ?? null,
  });

  if (error) {
    console.error("Failed to log chat ai request", {
      classId: input.classId,
      userId: input.userId,
      purpose: input.purpose,
      error: error.message,
    });
  }
}

function collectSourceLabels(blueprintContext: string, materialContext: string) {
  const labels = new Map<string, string>();
  labels.set(normalizeSourceLabelKey("Blueprint Context"), "Blueprint Context");
  const content = [blueprintContext, materialContext].join("\n");
  const matches = content.matchAll(/(?:^|\n)([^|\n]+)\s*\|/g);
  for (const match of matches) {
    if (match[1]) {
      const label = match[1].trim();
      labels.set(normalizeSourceLabelKey(label), label);
    }
  }
  return labels;
}

function normalizeSourceLabelKey(value: string) {
  return value
    .trim()
    .replace(/^source:\s*/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeCitationSourceLabel(sourceLabel: string, knownLabels: Map<string, string>) {
  const key = normalizeSourceLabelKey(sourceLabel);
  return knownLabels.get(key) ?? sourceLabel.trim();
}

export async function generateGroundedChatResponse(input: {
  classId: string;
  classTitle: string;
  userId: string;
  userMessage: string;
  transcript: ChatTurn[];
  compactedMemoryContext?: string;
  sessionId?: string;
  assignmentInstructions?: string | null;
  purpose: GroundedChatPurpose;
}): Promise<ChatModelResponse> {
  const supabase = await createServerSupabaseClient();

  const blueprintContext = await loadPublishedBlueprintContext(input.classId);
  const retrievalQuery = input.assignmentInstructions
    ? `${input.assignmentInstructions}\n\n${input.userMessage}`
    : input.userMessage;
  const materialContext = await retrieveMaterialContext(input.classId, retrievalQuery);
  const prompt = buildChatPrompt({
    classTitle: input.classTitle,
    userMessage: input.userMessage,
    transcript: input.transcript,
    blueprintContext: blueprintContext.blueprintContext,
    materialContext,
    compactedMemoryContext: input.compactedMemoryContext,
    assignmentInstructions: input.assignmentInstructions,
  });

  const startedAt = Date.now();
  try {
    const result = await generateTextWithFallback({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      maxTokens: 1200,
      sessionId: input.sessionId,
      transforms: resolveOpenRouterTransforms(),
    });

    const parsed = parseChatModelResponse(result.content);
    const sourceLabels = collectSourceLabels(blueprintContext.blueprintContext, materialContext);
    const normalizedCitations = parsed.citations
      .map((citation) => ({
        ...citation,
        sourceLabel: normalizeCitationSourceLabel(citation.sourceLabel, sourceLabels),
      }))
      .filter(
        (citation, index, list) =>
          list.findIndex(
            (item) =>
              item.sourceLabel === citation.sourceLabel && item.rationale === citation.rationale,
          ) === index,
      );

    await logChatAiRequest({
      supabase,
      classId: input.classId,
      userId: input.userId,
      provider: result.provider,
      model: result.model,
      purpose: input.purpose,
      status: "success",
      latencyMs: result.latencyMs,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      totalTokens: result.usage?.totalTokens,
    });

    return {
      ...parsed,
      citations: normalizedCitations,
    };
  } catch (error) {
    await logChatAiRequest({
      supabase,
      classId: input.classId,
      userId: input.userId,
      provider: "unknown",
      purpose: input.purpose,
      status: "error",
      latencyMs: Date.now() - startedAt,
    });
    throw error;
  }
}
