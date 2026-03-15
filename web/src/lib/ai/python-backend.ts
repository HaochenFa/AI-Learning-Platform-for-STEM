import "server-only";

export type PythonBackendProvider = "openrouter" | "openai" | "gemini";

export type PythonBackendUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type PythonBackendGenerateOptions = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  sessionId?: string;
  transforms?: string[];
  providerOrder?: PythonBackendProvider[];
  defaultProvider?: PythonBackendProvider;
};

export type PythonBackendGenerateResult = {
  provider: PythonBackendProvider;
  model: string;
  content: string;
  usage?: PythonBackendUsage;
  latencyMs: number;
};

export type PythonBackendEmbeddingsOptions = {
  inputs: string[];
  timeoutMs: number;
  providerOrder?: PythonBackendProvider[];
  defaultProvider?: PythonBackendProvider;
};

export type PythonBackendEmbeddingsResult = {
  provider: PythonBackendProvider;
  model: string;
  embeddings: number[][];
  usage?: PythonBackendUsage;
  latencyMs: number;
};

type EnvelopeError = {
  message?: string;
  code?: string;
};

type Envelope<T> = {
  ok?: boolean;
  data?: T;
  error?: EnvelopeError | null;
  meta?: {
    request_id?: string;
  };
};

export async function generateTextViaPythonBackend(
  options: PythonBackendGenerateOptions,
): Promise<PythonBackendGenerateResult> {
  const payload = await postToPythonBackend<{
    provider: PythonBackendProvider;
    model: string;
    content: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    latency_ms: number;
  }>({
    path: "/v1/llm/generate",
    timeoutMs: options.timeoutMs,
    body: {
      system: options.system,
      user: options.user,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      timeout_ms: options.timeoutMs,
      session_id: options.sessionId,
      transforms: options.transforms,
      provider_order: options.providerOrder,
      default_provider: options.defaultProvider,
    },
  });

  return {
    provider: payload.provider,
    model: payload.model,
    content: payload.content,
    usage: normalizeUsage(payload.usage),
    latencyMs: payload.latency_ms,
  };
}

export async function generateEmbeddingsViaPythonBackend(
  options: PythonBackendEmbeddingsOptions,
): Promise<PythonBackendEmbeddingsResult> {
  const payload = await postToPythonBackend<{
    provider: PythonBackendProvider;
    model: string;
    embeddings: number[][];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    latency_ms: number;
  }>({
    path: "/v1/llm/embeddings",
    timeoutMs: options.timeoutMs,
    body: {
      inputs: options.inputs,
      timeout_ms: options.timeoutMs,
      provider_order: options.providerOrder,
      default_provider: options.defaultProvider,
    },
  });

  return {
    provider: payload.provider,
    model: payload.model,
    embeddings: payload.embeddings,
    usage: normalizeUsage(payload.usage),
    latencyMs: payload.latency_ms,
  };
}

async function postToPythonBackend<T>(input: {
  path: string;
  timeoutMs: number;
  body: Record<string, unknown>;
}): Promise<T> {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("PYTHON_BACKEND_URL is not configured.");
  }

  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/+$/, "")}${input.path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify(input.body),
    },
    input.timeoutMs,
    `Python backend request (${input.path})`,
  );

  const payload = (await safeJson(response)) as Envelope<T> | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error?.message ?? `Python backend request failed with ${response.status}.`);
  }

  return payload.data;
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
