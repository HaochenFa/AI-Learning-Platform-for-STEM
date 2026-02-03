/// <reference types="node" />
import "server-only";

export type AiProvider = "openrouter" | "openai" | "gemini";

export type AiGenerateOptions = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
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

const PROVIDER_ORDER: AiProvider[] = ["openrouter", "openai", "gemini"];

export function resolveProviderOrder() {
  const configured = PROVIDER_ORDER.filter(isProviderConfigured);
  if (configured.length === 0) {
    throw new Error("No AI providers are configured.");
  }

  const defaultProvider = normalizeProvider(
    process.env.AI_PROVIDER_DEFAULT ?? "openrouter"
  );

  if (defaultProvider && configured.includes(defaultProvider)) {
    return [defaultProvider, ...configured.filter((p) => p !== defaultProvider)];
  }

  return configured;
}

export async function generateTextWithFallback(
  options: AiGenerateOptions
): Promise<AiGenerateResult> {
  const providers = resolveProviderOrder();
  const allowFallback = providers.length >= 2;
  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      return await generateWithProvider(provider, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("AI request failed");
      if (!allowFallback) {
        break;
      }
    }
  }

  throw lastError ?? new Error("AI request failed.");
}

function normalizeProvider(value: string): AiProvider | null {
  if (value === "openrouter" || value === "openai" || value === "gemini") {
    return value;
  }
  return null;
}

function isProviderConfigured(provider: AiProvider) {
  if (provider === "openrouter") {
    return Boolean(
      process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL
    );
  }

  if (provider === "openai") {
    return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
  }

  if (provider === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
  }

  return false;
}

async function generateWithProvider(
  provider: AiProvider,
  options: AiGenerateOptions
): Promise<AiGenerateResult> {
  if (provider === "openrouter") {
    return callOpenRouter(options);
  }
  if (provider === "openai") {
    return callOpenAI(options);
  }
  return callGemini(options);
}

async function callOpenRouter(
  options: AiGenerateOptions
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

  const response = await fetch(`${baseUrl}/chat/completions`, {
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
    }),
  });

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

async function callOpenAI(options: AiGenerateOptions): Promise<AiGenerateResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) {
    throw new Error("OpenAI is not configured.");
  }

  const start = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
  });

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

async function callGemini(options: AiGenerateOptions): Promise<AiGenerateResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) {
    throw new Error("Gemini is not configured.");
  }

  const start = Date.now();
  const response = await fetch(
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
    }
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
