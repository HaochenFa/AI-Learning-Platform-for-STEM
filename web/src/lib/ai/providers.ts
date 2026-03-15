/// <reference types="node" />
import "server-only";
import {
  generateEmbeddingsViaPythonBackend,
  generateTextViaPythonBackend,
} from "@/lib/ai/python-backend";

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
  return await generateTextViaPythonBackend({
    ...options,
    timeoutMs: totalTimeoutMs,
    providerOrder: tryResolveProviderOrder(),
    defaultProvider: normalizeProvider(process.env.AI_PROVIDER_DEFAULT ?? "openrouter") ?? undefined,
  });
}

export async function generateEmbeddingsWithFallback(options: {
  inputs: string[];
  timeoutMs?: number;
}) {
  const totalTimeoutMs = resolveTimeoutMs(options.timeoutMs, DEFAULT_AI_EMBEDDING_TIMEOUT_MS);
  return await generateEmbeddingsViaPythonBackend({
    ...options,
    timeoutMs: totalTimeoutMs,
    providerOrder: tryResolveProviderOrder(),
    defaultProvider: normalizeProvider(process.env.AI_PROVIDER_DEFAULT ?? "openrouter") ?? undefined,
  });
}

function normalizeProvider(value: string): AiProvider | null {
  if (value === "openrouter" || value === "openai" || value === "gemini") {
    return value;
  }
  return null;
}

function tryResolveProviderOrder() {
  try {
    return resolveProviderOrder();
  } catch {
    return undefined;
  }
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
