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
  accessToken?: string | null;
  sandboxId?: string | null;
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

export type TeachingBriefStatus = "empty" | "ready" | "generating" | "no_data" | "error";

export type TeachingBriefPayload = {
  summary: string;
  strongestAction: string;
  attentionItems: string[];
  misconceptions: Array<{
    topicId: string | null;
    topicTitle: string;
    description: string;
  }>;
  studentsToWatch: Array<{
    studentId: string;
    displayName: string;
    reason: string;
  }>;
  nextStep: string;
  recommendedActivity: {
    type: string;
    reason: string;
  } | null;
  evidenceBasis: string;
};

export type TeachingBriefActionResult = {
  status: TeachingBriefStatus;
  generatedAt: string | null;
  isStale: boolean;
  isRefreshing: boolean;
  hasEvidence: boolean;
  payload: TeachingBriefPayload | null;
  error: string | null;
};

type TeachingBriefAttentionItem =
  | string
  | {
      topic?: string;
      title?: string;
      detail?: string;
      description?: string;
    };

type TeachingBriefMisconception = {
  topic_id?: string | null;
  topic_title?: string;
  topic?: string;
  title?: string;
  description?: string;
};

type TeachingBriefStudentToWatch = {
  student_id?: string;
  display_name?: string;
  reason?: string;
};

type TeachingBriefRecommendedActivity = {
  type?: string;
  reason?: string;
};

function normalizeBriefText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAttentionItem(item: TeachingBriefAttentionItem): string {
  if (typeof item === "string") {
    return normalizeBriefText(item);
  }

  const topic = normalizeBriefText(item.topic ?? item.title);
  const detail = normalizeBriefText(item.detail ?? item.description);

  if (topic && detail) return `${topic}: ${detail}`;
  return topic || detail;
}

function normalizeRecommendedActivity(
  activity: TeachingBriefRecommendedActivity | null | undefined,
): TeachingBriefPayload["recommendedActivity"] {
  const type = normalizeBriefText(activity?.type);
  if (!type) {
    return null;
  }

  return {
    type,
    reason: normalizeBriefText(activity?.reason),
  };
}

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
      sandbox_id: options.sandboxId ?? null,
      timeout_ms: options.timeoutMs,
      provider_order: options.providerOrder,
      default_provider: options.defaultProvider,
    },
    headers: options.accessToken
      ? {
          Authorization: `Bearer ${options.accessToken}`,
        }
      : undefined,
  });

  return {
    provider: payload.provider,
    model: payload.model,
    embeddings: payload.embeddings,
    usage: normalizeUsage(payload.usage),
    latencyMs: payload.latency_ms,
  };
}

export async function requestClassTeachingBrief(input: {
  classId: string;
  userId: string;
  forceRefresh: boolean;
  accessToken?: string | null;
  sandboxId?: string | null;
}): Promise<TeachingBriefActionResult> {
  const payload = await postToPythonBackend<{
    status: TeachingBriefStatus;
    generated_at: string | null;
    is_stale: boolean;
    has_evidence: boolean;
    payload?: {
      summary?: string;
      strongest_action?: string;
      attention_items?: TeachingBriefAttentionItem[];
      misconceptions?: TeachingBriefMisconception[];
      students_to_watch?: TeachingBriefStudentToWatch[];
      next_step?: string;
      recommended_activity?: TeachingBriefRecommendedActivity | null;
      evidence_basis?: string;
    } | null;
    error_message?: string | null;
  }>({
    path: "/v1/analytics/class-teaching-brief",
    timeoutMs: 30_000,
    body: {
      user_id: input.userId,
      class_id: input.classId,
      sandbox_id: input.sandboxId ?? null,
      force_refresh: input.forceRefresh,
    },
    headers: input.accessToken
      ? {
          Authorization: `Bearer ${input.accessToken}`,
        }
      : undefined,
  });

  return {
    status: payload.status,
    generatedAt: payload.generated_at ?? null,
    isStale: payload.is_stale,
    isRefreshing: payload.status === "generating",
    hasEvidence: payload.has_evidence,
    payload: payload.payload
      ? {
          summary: normalizeBriefText(payload.payload.summary),
          strongestAction: normalizeBriefText(payload.payload.strongest_action),
          attentionItems: (payload.payload.attention_items ?? []).map(
            normalizeAttentionItem,
          ).filter((item): item is string => item.length > 0),
          misconceptions: (payload.payload.misconceptions ?? []).map((item) => ({
            topicId: normalizeBriefText(item.topic_id) || null,
            topicTitle: normalizeBriefText(item.topic_title ?? item.topic ?? item.title),
            description: normalizeBriefText(item.description),
          })).filter((item) => item.topicTitle.length > 0 || item.description.length > 0),
          studentsToWatch: (payload.payload.students_to_watch ?? []).map((student) => ({
            studentId: normalizeBriefText(student.student_id),
            displayName: normalizeBriefText(student.display_name) || normalizeBriefText(student.student_id) || "Unknown",
            reason: normalizeBriefText(student.reason),
          })).filter((student) => student.studentId.length > 0 || student.reason.length > 0),
          nextStep: normalizeBriefText(payload.payload.next_step),
          recommendedActivity: normalizeRecommendedActivity(payload.payload.recommended_activity),
          evidenceBasis: normalizeBriefText(payload.payload.evidence_basis),
        }
      : null,
    error: payload.error_message ?? null,
  };
}


async function postToPythonBackend<T>(input: {
  path: string;
  timeoutMs: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
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
        ...(input.headers ?? {}),
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
