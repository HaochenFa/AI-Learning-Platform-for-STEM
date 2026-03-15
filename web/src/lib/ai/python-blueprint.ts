import "server-only";

import type { BlueprintPayload } from "@/lib/ai/blueprint";

export type PythonBlueprintGenerateRequest = {
  classTitle: string;
  subject?: string | null;
  level?: string | null;
  materialCount: number;
  materialText: string;
  timeoutMs: number;
};

export type PythonBlueprintGenerateResult = {
  payload: BlueprintPayload;
  provider: "openrouter" | "openai" | "gemini";
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
};

export async function generateBlueprintViaPythonBackend(
  input: PythonBlueprintGenerateRequest,
): Promise<PythonBlueprintGenerateResult> {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("PYTHON_BACKEND_URL is not configured.");
  }

  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/+$/, "")}/v1/blueprints/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        class_title: input.classTitle,
        subject: input.subject ?? null,
        level: input.level ?? null,
        material_count: input.materialCount,
        material_text: input.materialText,
        timeout_ms: input.timeoutMs,
      }),
    },
    input.timeoutMs,
    "Python backend blueprint request",
  );

  const payload = (await safeJson(response)) as {
    ok?: boolean;
    data?: {
      payload?: BlueprintPayload;
      provider?: "openrouter" | "openai" | "gemini";
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      latency_ms?: number;
    };
    error?: {
      message?: string;
    };
  } | null;

  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(
      payload?.error?.message ?? `Python backend blueprint request failed with ${response.status}.`,
    );
  }

  if (!payload.data.payload || !payload.data.provider || !payload.data.model) {
    throw new Error("Python backend blueprint payload is invalid.");
  }

  return {
    payload: payload.data.payload,
    provider: payload.data.provider,
    model: payload.data.model,
    usage: normalizeUsage(payload.data.usage),
    latencyMs: payload.data.latency_ms ?? input.timeoutMs,
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
