import "server-only";

import { generateChatViaPythonBackend } from "@/lib/ai/python-chat";
import { loadPublishedBlueprintContext } from "@/lib/chat/context";
import type { ChatModelResponse, ChatTurn } from "@/lib/chat/types";
import { retrieveMaterialContext } from "@/lib/materials/retrieval";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const DEFAULT_CHAT_MAX_TOKENS = 9000;

export type GroundedChatPurpose =
  | "student_chat_open_v2"
  | "student_chat_assignment_v2"
  | "student_chat_always_on_v1"
  | "teacher_chat_always_on_v1";

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

function resolveChatMaxTokens() {
  const rawValue = process.env.CHAT_GENERATION_MAX_TOKENS;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CHAT_MAX_TOKENS;
  }
  return Math.floor(parsed);
}

function resolvePythonChatEngine() {
  const value = process.env.PYTHON_BACKEND_CHAT_ENGINE?.trim().toLowerCase();
  if (value === "langgraph_v1") {
    return "langgraph_v1";
  }
  return "direct_v1";
}

function resolvePythonChatToolMode() {
  const value = process.env.PYTHON_BACKEND_CHAT_TOOL_MODE?.trim().toLowerCase();
  if (value === "plan" || value === "auto") {
    return value;
  }
  return "off";
}

function resolvePythonChatToolCatalog() {
  const raw = process.env.PYTHON_BACKEND_CHAT_TOOL_CATALOG;
  if (!raw) {
    return ["grounding_context.read", "memory.search", "memory.save"];
  }
  const catalog = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return catalog.length > 0 ? catalog : ["grounding_context.read", "memory.search", "memory.save"];
}

function toFriendlyChatGenerationError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Unable to generate a chat response right now. Please try again.";
  }

  if (/NEXT_REDIRECT/i.test(error.message)) {
    return "Unable to generate a chat response right now. Please try again.";
  }

  if (/timed out/i.test(error.message)) {
    return "Chat response generation timed out. Please try again.";
  }

  if (
    /no json object found|not valid json|model response payload is invalid|invalid chat json/i.test(
      error.message,
    )
  ) {
    return "The AI response was incomplete. Please ask again.";
  }

  return error.message;
}

export async function generateGroundedChatResponse(input: {
  classId: string;
  classTitle: string;
  userId: string;
  userMessage: string;
  transcript: ChatTurn[];
  sandboxId?: string | null;
  compactedMemoryContext?: string;
  sessionId?: string;
  assignmentInstructions?: string | null;
  purpose: GroundedChatPurpose;
}): Promise<ChatModelResponse> {
  const supabase = await createServerSupabaseClient();
  const startedAt = Date.now();
  let usedProvider = "unknown";
  let usedModel: string | null = null;
  let usedUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
  let usedLatencyMs: number | null = null;

  try {
    const blueprintContext = await loadPublishedBlueprintContext(input.classId);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) {
      throw new Error("User session token is missing.");
    }

    const retrievalQuery = input.assignmentInstructions
      ? `${input.assignmentInstructions}\n\n${input.userMessage}`
      : input.userMessage;
    const materialContext = await retrieveMaterialContext(input.classId, retrievalQuery, undefined, {
      accessToken,
      sandboxId: input.sandboxId ?? null,
    });
    const maxTokens = resolveChatMaxTokens();
    const pythonChatEngine = resolvePythonChatEngine();
    const pythonChatToolMode = resolvePythonChatToolMode();
    const pythonChatToolCatalog = resolvePythonChatToolCatalog();

    const pythonResult = await generateChatViaPythonBackend({
      classId: input.classId,
      userId: input.userId,
      accessToken,
      sandboxId: input.sandboxId ?? null,
      classTitle: input.classTitle,
      userMessage: input.userMessage,
      transcript: input.transcript,
      blueprintContext: blueprintContext.blueprintContext,
      materialContext,
      compactedMemoryContext: input.compactedMemoryContext,
      assignmentInstructions: input.assignmentInstructions,
      purpose: input.purpose,
      sessionId: input.sessionId,
      maxTokens,
      toolMode: pythonChatToolMode,
      toolCatalog: pythonChatToolCatalog,
      orchestrationHints: {
        phase: "phase_7_langgraph_orchestration",
        engine: pythonChatEngine,
        reserved_for: "langgraph_tool_calling",
      },
    });
    usedProvider = pythonResult.provider;
    usedModel = pythonResult.model;
    usedUsage = pythonResult.usage;
    usedLatencyMs = pythonResult.latencyMs;
    const parsed: ChatModelResponse = pythonResult.payload;

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
      provider: usedProvider,
      model: usedModel,
      purpose: input.purpose,
      status: "success",
      latencyMs: usedLatencyMs ?? Date.now() - startedAt,
      promptTokens: usedUsage?.promptTokens,
      completionTokens: usedUsage?.completionTokens,
      totalTokens: usedUsage?.totalTokens,
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
      provider: usedProvider,
      purpose: input.purpose,
      status: "error",
      latencyMs: Date.now() - startedAt,
    });
    throw new Error(toFriendlyChatGenerationError(error));
  }
}
