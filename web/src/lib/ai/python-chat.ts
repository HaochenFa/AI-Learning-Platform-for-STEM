import "server-only";

import type { ChatModelResponse, ChatTurn } from "@/lib/chat/types";

export type PythonChatGenerateRequest = {
  classId: string;
  userId: string;
  accessToken: string;
  classTitle: string;
  userMessage: string;
  transcript: ChatTurn[];
  blueprintContext: string;
  materialContext: string;
  compactedMemoryContext?: string;
  assignmentInstructions?: string | null;
  purpose: string;
  sessionId?: string;
  maxTokens: number;
  timeoutMs?: number;
  toolMode?: "off" | "plan" | "auto";
  toolCatalog?: string[];
  orchestrationHints?: Record<string, unknown>;
};

export type PythonChatGenerateResult = {
  payload: ChatModelResponse;
  provider: "openrouter" | "openai" | "gemini";
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
  orchestration?: {
    engine?: string;
    tool_mode?: "off" | "plan" | "auto";
    tool_calls?: unknown[];
    tool_catalog?: string[];
    notes?: string;
  };
};

export async function generateChatViaPythonBackend(
  input: PythonChatGenerateRequest,
): Promise<PythonChatGenerateResult> {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("PYTHON_BACKEND_URL is not configured.");
  }

  const timeoutMs = resolveTimeoutMs(input.timeoutMs);
  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/+$/, "")}/v1/chat/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        class_id: input.classId,
        user_id: input.userId,
        class_title: input.classTitle,
        user_message: input.userMessage,
        transcript: input.transcript.map((turn) => ({
          role: turn.role,
          message: turn.message,
          created_at: turn.createdAt,
        })),
        blueprint_context: input.blueprintContext,
        material_context: input.materialContext,
        compacted_memory_context: input.compactedMemoryContext ?? null,
        assignment_instructions: input.assignmentInstructions ?? null,
        purpose: input.purpose,
        session_id: input.sessionId,
        max_tokens: input.maxTokens,
        timeout_ms: timeoutMs,
        tool_mode: input.toolMode ?? "off",
        tool_catalog: input.toolCatalog ?? [],
        orchestration_hints: input.orchestrationHints ?? null,
      }),
    },
    timeoutMs,
    "Python backend chat request",
  );

  const payload = (await safeJson(response)) as {
    ok?: boolean;
    data?: {
      payload?: ChatModelResponse;
      provider?: "openrouter" | "openai" | "gemini";
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      latency_ms?: number;
      orchestration?: {
        engine?: string;
        tool_mode?: "off" | "plan" | "auto";
        tool_calls?: unknown[];
        tool_catalog?: string[];
        notes?: string;
      };
    };
    error?: {
      message?: string;
    };
  } | null;

  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error?.message ?? `Python backend chat request failed with ${response.status}.`);
  }

  if (!payload.data.payload || !payload.data.provider || !payload.data.model) {
    throw new Error("Python backend chat payload is invalid.");
  }

  return {
    payload: payload.data.payload,
    provider: payload.data.provider,
    model: payload.data.model,
    usage: normalizeUsage(payload.data.usage),
    latencyMs: payload.data.latency_ms ?? timeoutMs,
    orchestration: payload.data.orchestration,
  };
}

function normalizeUsage(usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}) {
  if (!usage) {
    return undefined;
  }
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function resolveTimeoutMs(timeoutMs: number | undefined) {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 30000;
  }
  return Math.floor(timeoutMs);
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
) {
  let didTimeout = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (didTimeout || isAbortError(error)) {
      throw new Error(`${label} timed out after ${timeoutMs}ms.`);
    }
    throw error instanceof Error ? error : new Error(`${label} failed.`);
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
