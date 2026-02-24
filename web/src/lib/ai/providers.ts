/// <reference types="node" />
import "server-only";

export type AiProvider = "openrouter" | "openai" | "gemini";

export type AiGenerateOptions = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  sessionId?: string;
  transforms?: string[];
};

export type AiUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type AiGenerateResult = {
  provider: AiProvider;
  model: string;
  content: string;
  usage?: AiUsage;
  latencyMs: number;
};

export type AiEmbeddingResult = {
  provider: AiProvider;
  model: string;
  embeddings: number[][];
  usage?: AiUsage;
  latencyMs: number;
};

const PROVIDER_ORDER: AiProvider[] = ["openrouter", "openai", "gemini"];
const DEFAULT_AI_REQUEST_TIMEOUT_MS = parseTimeoutMs(process.env.AI_REQUEST_TIMEOUT_MS, 30000);
const DEFAULT_AI_EMBEDDING_TIMEOUT_MS = parseTimeoutMs(
  process.env.AI_EMBEDDING_TIMEOUT_MS,
  DEFAULT_AI_REQUEST_TIMEOUT_MS,
);

export function resolveProviderOrder() {
  const configured = PROVIDER_ORDER.filter(isProviderConfigured);
  if (configured.length === 0) {
    throw new Error("No AI providers are configured.");
  }

  const defaultProvider = normalizeProvider(process.env.AI_PROVIDER_DEFAULT ?? "openrouter");

  if (defaultProvider && configured.includes(defaultProvider)) {
    return [defaultProvider, ...configured.filter((p) => p !== defaultProvider)];
  }

  return configured;
}

export async function generateTextWithFallback(
  options: AiGenerateOptions,
): Promise<AiGenerateResult> {
  const totalTimeoutMs = resolveTimeoutMs(options.timeoutMs, DEFAULT_AI_REQUEST_TIMEOUT_MS);
  const deadline = Date.now() + totalTimeoutMs;
  const providers = resolveProviderOrder();
  const allowFallback = providers.length >= 2;
  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      const timeoutMs = remainingTimeoutMs(deadline);
      if (timeoutMs <= 0) {
        throw new Error(`AI request timed out after ${totalTimeoutMs}ms.`);
      }
      return await generateWithProvider(provider, {
        ...options,
        timeoutMs,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("AI request failed");
      if (!allowFallback) {
        break;
      }
    }
  }

  throw lastError ?? new Error("AI request failed.");
}

export async function generateEmbeddingsWithFallback(options: {
  inputs: string[];
  timeoutMs?: number;
}) {
  const totalTimeoutMs = resolveTimeoutMs(options.timeoutMs, DEFAULT_AI_EMBEDDING_TIMEOUT_MS);
  const deadline = Date.now() + totalTimeoutMs;
  const providers = resolveProviderOrder().filter(isEmbeddingConfigured);
  if (providers.length === 0) {
    throw new Error("No embedding providers are configured.");
  }
  const allowFallback = providers.length >= 2;
  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      const timeoutMs = remainingTimeoutMs(deadline);
      if (timeoutMs <= 0) {
        throw new Error(`Embedding request timed out after ${totalTimeoutMs}ms.`);
      }
      return await embedWithProvider(provider, options.inputs, timeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Embedding request failed");
      if (!allowFallback) {
        break;
      }
    }
  }

  throw lastError ?? new Error("Embedding request failed.");
}

function normalizeProvider(value: string): AiProvider | null {
  if (value === "openrouter" || value === "openai" || value === "gemini") {
    return value;
  }
  return null;
}

function isProviderConfigured(provider: AiProvider) {
  if (provider === "openrouter") {
    return Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL);
  }

  if (provider === "openai") {
    return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
  }

  if (provider === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
  }

  return false;
}

function isEmbeddingConfigured(provider: AiProvider) {
  if (provider === "openrouter") {
    return Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_EMBEDDING_MODEL);
  }

  if (provider === "openai") {
    return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_EMBEDDING_MODEL);
  }

  if (provider === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_EMBEDDING_MODEL);
  }

  return false;
}

async function generateWithProvider(
  provider: AiProvider,
  options: AiGenerateOptions,
): Promise<AiGenerateResult> {
  const timeoutMs = resolveTimeoutMs(options.timeoutMs, DEFAULT_AI_REQUEST_TIMEOUT_MS);
  if (provider === "openrouter") {
    return callOpenRouter(options, timeoutMs);
  }
  if (provider === "openai") {
    return callOpenAI(options, timeoutMs);
  }
  return callGemini(options, timeoutMs);
}

async function embedWithProvider(
  provider: AiProvider,
  inputs: string[],
  timeoutMs: number,
): Promise<AiEmbeddingResult> {
  if (provider === "openrouter") {
    return callOpenRouterEmbeddings(inputs, timeoutMs);
  }
  if (provider === "openai") {
    return callOpenAIEmbeddings(inputs, timeoutMs);
  }
  return callGeminiEmbeddings(inputs, timeoutMs);
}

async function callOpenRouter(
  options: AiGenerateOptions,
  timeoutMs: number,
): Promise<AiGenerateResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) {
    throw new Error("OpenRouter is not configured.");
  }

  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const referer = process.env.OPENROUTER_SITE_URL;
  const appTitle = process.env.OPENROUTER_APP_NAME;
  const start = Date.now();

  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(referer ? { "HTTP-Referer": referer } : {}),
        ...(appTitle ? { "X-Title": appTitle } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1200,
        response_format: { type: "json_object" },
        ...(options.sessionId ? { session_id: options.sessionId } : {}),
        ...(options.transforms && options.transforms.length > 0
          ? { transforms: options.transforms }
          : {}),
      }),
    },
    timeoutMs,
    "OpenRouter generation request",
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "OpenRouter request failed.");
  }

  return {
    provider: "openrouter",
    model,
    content: data?.choices?.[0]?.message?.content ?? "",
    usage: normalizeUsage(data?.usage),
    latencyMs: Date.now() - start,
  };
}

async function callOpenAI(options: AiGenerateOptions, timeoutMs: number): Promise<AiGenerateResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) {
    throw new Error("OpenAI is not configured.");
  }

  const start = Date.now();
  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1200,
        response_format: { type: "json_object" },
      }),
    },
    timeoutMs,
    "OpenAI generation request",
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "OpenAI request failed.");
  }

  return {
    provider: "openai",
    model,
    content: data?.choices?.[0]?.message?.content ?? "",
    usage: normalizeUsage(data?.usage),
    latencyMs: Date.now() - start,
  };
}

async function callGemini(options: AiGenerateOptions, timeoutMs: number): Promise<AiGenerateResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) {
    throw new Error("Gemini is not configured.");
  }

  const start = Date.now();
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: options.system }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: options.user }],
          },
        ],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens ?? 1200,
        },
      }),
    },
    timeoutMs,
    "Gemini generation request",
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Gemini request failed.");
  }

  const content =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("") ?? "";

  return {
    provider: "gemini",
    model,
    content,
    usage: normalizeGeminiUsage(data?.usageMetadata),
    latencyMs: Date.now() - start,
  };
}

async function callOpenAIEmbeddings(
  inputs: string[],
  timeoutMs: number,
): Promise<AiEmbeddingResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EMBEDDING_MODEL;
  if (!apiKey || !model) {
    throw new Error("OpenAI embeddings are not configured.");
  }

  const start = Date.now();
  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: inputs,
      }),
    },
    timeoutMs,
    "OpenAI embeddings request",
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "OpenAI embeddings request failed.");
  }

  const embeddings = (data?.data ?? []).map((item: { embedding: number[] }) => item.embedding);
  return {
    provider: "openai",
    model,
    embeddings,
    usage: normalizeUsage(data?.usage),
    latencyMs: Date.now() - start,
  };
}

async function callOpenRouterEmbeddings(
  inputs: string[],
  timeoutMs: number,
): Promise<AiEmbeddingResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_EMBEDDING_MODEL;
  if (!apiKey || !model) {
    throw new Error("OpenRouter embeddings are not configured.");
  }

  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const referer = process.env.OPENROUTER_SITE_URL;
  const appTitle = process.env.OPENROUTER_APP_NAME;
  const start = Date.now();

  const response = await fetchWithTimeout(
    `${baseUrl}/embeddings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(referer ? { "HTTP-Referer": referer } : {}),
        ...(appTitle ? { "X-Title": appTitle } : {}),
      },
      body: JSON.stringify({
        model,
        input: inputs,
      }),
    },
    timeoutMs,
    "OpenRouter embeddings request",
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "OpenRouter embeddings request failed.");
  }

  const embeddings = (data?.data ?? []).map((item: { embedding: number[] }) => item.embedding);
  return {
    provider: "openrouter",
    model,
    embeddings,
    usage: normalizeUsage(data?.usage),
    latencyMs: Date.now() - start,
  };
}

async function callGeminiEmbeddings(
  inputs: string[],
  timeoutMs: number,
): Promise<AiEmbeddingResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_EMBEDDING_MODEL;
  if (!apiKey || !model) {
    throw new Error("Gemini embeddings are not configured.");
  }

  const start = Date.now();
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: inputs.map((input) => ({
          content: { parts: [{ text: input }] },
        })),
      }),
    },
    timeoutMs,
    "Gemini embeddings request",
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Gemini embeddings request failed.");
  }

  const embeddings = (data?.embeddings ?? []).map((item: { values: number[] }) => item.values);
  return {
    provider: "gemini",
    model,
    embeddings,
    usage: normalizeGeminiUsage(data?.usageMetadata),
    latencyMs: Date.now() - start,
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

function normalizeGeminiUsage(usage?: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}) {
  if (!usage) {
    return undefined;
  }
  return {
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  };
}

function parseTimeoutMs(value: string | undefined, fallbackMs: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  return Math.floor(parsed);
}

function resolveTimeoutMs(candidate: number | undefined, fallbackMs: number) {
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) {
    return fallbackMs;
  }
  return Math.floor(candidate);
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

function remainingTimeoutMs(deadlineMs: number) {
  return Math.floor(deadlineMs - Date.now());
}
