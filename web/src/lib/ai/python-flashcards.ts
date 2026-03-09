import "server-only";

export type PythonFlashcardsCard = {
  front: string;
  back: string;
};

export type PythonFlashcardsGenerateRequest = {
  classTitle: string;
  cardCount: number;
  instructions: string;
  blueprintContext: string;
  materialContext: string;
  timeoutMs?: number;
};

export type PythonFlashcardsGenerateResult = {
  payload: {
    cards: PythonFlashcardsCard[];
  };
  provider: "openrouter" | "openai" | "gemini";
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
};

export async function generateFlashcardsViaPythonBackend(
  input: PythonFlashcardsGenerateRequest,
): Promise<PythonFlashcardsGenerateResult> {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("PYTHON_BACKEND_URL is not configured.");
  }

  const timeoutMs = resolveTimeoutMs(input.timeoutMs);
  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/+$/, "")}/v1/flashcards/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        class_title: input.classTitle,
        card_count: input.cardCount,
        instructions: input.instructions,
        blueprint_context: input.blueprintContext,
        material_context: input.materialContext,
        timeout_ms: timeoutMs,
      }),
    },
    timeoutMs,
    "Python backend flashcards request",
  );

  const payload = (await safeJson(response)) as {
    ok?: boolean;
    data?: {
      payload?: {
        cards?: PythonFlashcardsCard[];
      };
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
      payload?.error?.message ?? `Python backend flashcards request failed with ${response.status}.`,
    );
  }

  if (!payload.data.payload || !Array.isArray(payload.data.payload.cards)) {
    throw new Error("Python backend flashcards payload is invalid.");
  }
  if (!payload.data.provider || !payload.data.model) {
    throw new Error("Python backend flashcards metadata is invalid.");
  }

  return {
    payload: {
      cards: payload.data.payload.cards,
    },
    provider: payload.data.provider,
    model: payload.data.model,
    usage: normalizeUsage(payload.data.usage),
    latencyMs: payload.data.latency_ms ?? timeoutMs,
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
