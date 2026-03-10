import "server-only";

import type {
  ClassChatMessage,
  ClassChatMessagesPageInfo,
  ClassChatParticipant,
  ClassChatSession,
  ChatModelResponse,
} from "@/lib/chat/types";

type PythonWorkspaceEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
    code?: string;
  };
};

type PythonWorkspaceError = Error & {
  code?: string;
};

const DEFAULT_MATERIAL_TIMEOUT_MS = 15000;
const DEFAULT_CHAT_TIMEOUT_MS = 45000;

export async function listWorkspaceParticipantsViaPython(input: {
  classId: string;
  userId: string;
  accessToken: string;
}) {
  const payload = await postWorkspace<{
    participants?: Array<{
      user_id?: string;
      display_name?: string;
    }>;
  }>("/v1/chat/workspace/participants", {
    class_id: input.classId,
    user_id: input.userId,
  }, input.accessToken);

  const participants: ClassChatParticipant[] = (payload.participants ?? [])
    .filter((item) => typeof item.user_id === "string" && item.user_id.trim().length > 0)
    .map((item, index) => ({
      userId: item.user_id as string,
      displayName: item.display_name?.trim() || `Student ${index + 1}`,
    }));

  return { participants };
}

export async function listWorkspaceSessionsViaPython(input: {
  classId: string;
  userId: string;
  accessToken: string;
  ownerUserId?: string;
}) {
  const payload = await postWorkspace<{
    sessions?: WorkspaceSessionRow[];
  }>("/v1/chat/workspace/sessions/list", {
    class_id: input.classId,
    user_id: input.userId,
    owner_user_id: input.ownerUserId ?? null,
  }, input.accessToken);

  return {
    sessions: (payload.sessions ?? []).map(normalizeSessionRow),
  };
}

export async function createWorkspaceSessionViaPython(input: {
  classId: string;
  userId: string;
  accessToken: string;
  title?: string;
}) {
  const payload = await postWorkspace<{
    session?: WorkspaceSessionRow;
  }>("/v1/chat/workspace/sessions/create", {
    class_id: input.classId,
    user_id: input.userId,
    title: input.title ?? null,
  }, input.accessToken);

  if (!payload.session) {
    throw new Error("Python workspace create session response is invalid.");
  }

  return {
    session: normalizeSessionRow(payload.session),
  };
}

export async function renameWorkspaceSessionViaPython(input: {
  classId: string;
  userId: string;
  accessToken: string;
  sessionId: string;
  title: string;
}) {
  const payload = await postWorkspace<{
    session?: WorkspaceSessionRow;
  }>("/v1/chat/workspace/sessions/rename", {
    class_id: input.classId,
    user_id: input.userId,
    session_id: input.sessionId,
    title: input.title,
  }, input.accessToken);

  if (!payload.session) {
    throw new Error("Python workspace rename session response is invalid.");
  }

  return {
    session: normalizeSessionRow(payload.session),
  };
}

export async function archiveWorkspaceSessionViaPython(input: {
  classId: string;
  userId: string;
  accessToken: string;
  sessionId: string;
}) {
  const payload = await postWorkspace<{
    session_id?: string;
  }>("/v1/chat/workspace/sessions/archive", {
    class_id: input.classId,
    user_id: input.userId,
    session_id: input.sessionId,
  }, input.accessToken);

  if (!payload.session_id) {
    throw new Error("Python workspace archive session response is invalid.");
  }

  return {
    sessionId: payload.session_id,
  };
}

export async function listWorkspaceMessagesViaPython(input: {
  classId: string;
  userId: string;
  accessToken: string;
  sessionId: string;
  ownerUserId?: string;
  beforeCursor?: string | null;
  limit?: number;
}) {
  const payload = await postWorkspace<{
    session?: WorkspaceSessionRow;
    messages?: WorkspaceMessageRow[];
    page_info?: {
      has_more?: boolean;
      next_cursor?: string | null;
    };
  }>("/v1/chat/workspace/messages/list", {
    class_id: input.classId,
    user_id: input.userId,
    session_id: input.sessionId,
    owner_user_id: input.ownerUserId ?? null,
    before_cursor: input.beforeCursor ?? null,
    limit: input.limit ?? null,
  }, input.accessToken);

  if (!payload.session) {
    throw new Error("Python workspace messages response is invalid.");
  }

  const pageInfo: ClassChatMessagesPageInfo = {
    hasMore: Boolean(payload.page_info?.has_more),
    nextCursor: payload.page_info?.next_cursor ?? null,
  };

  return {
    session: normalizeSessionRow(payload.session),
    messages: (payload.messages ?? []).map(normalizeMessageRow),
    pageInfo,
  };
}

export async function sendWorkspaceMessageViaPython(input: {
  classId: string;
  userId: string;
  accessToken: string;
  sessionId: string;
  message: string;
}) {
  const timeoutMs = resolvePythonBackendChatTimeoutMs();
  const payload = await postWorkspace<{
    response?: WorkspaceModelResponse;
    user_message?: WorkspaceMessageRow;
    assistant_message?: WorkspaceMessageRow;
    context_meta?: {
      compacted?: boolean;
      compacted_at?: string | null;
      reason?: string | null;
    };
  }>("/v1/chat/workspace/messages/send", {
    class_id: input.classId,
    user_id: input.userId,
    session_id: input.sessionId,
    message: input.message,
    timeout_ms: timeoutMs,
  }, input.accessToken, { timeoutMs });

  if (!payload.response || !payload.user_message || !payload.assistant_message) {
    throw new Error("Python workspace send response is invalid.");
  }

  return {
    response: normalizeModelResponse(payload.response),
    userMessage: normalizeMessageRow(payload.user_message),
    assistantMessage: normalizeMessageRow(payload.assistant_message),
    contextMeta: {
      compacted: Boolean(payload.context_meta?.compacted),
      compactedAt: payload.context_meta?.compacted_at ?? null,
      reason: payload.context_meta?.reason ?? null,
    },
  };
}

function resolveTimeoutMs(rawValue: string | undefined, fallbackMs: number) {
  const parsed = Number(rawValue ?? String(fallbackMs));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  return Math.floor(parsed);
}

function resolvePythonBackendMaterialTimeoutMs() {
  return resolveTimeoutMs(
    process.env.PYTHON_BACKEND_MATERIAL_TIMEOUT_MS,
    DEFAULT_MATERIAL_TIMEOUT_MS,
  );
}

function resolvePythonBackendChatTimeoutMs() {
  return resolveTimeoutMs(
    process.env.PYTHON_BACKEND_CHAT_TIMEOUT_MS ?? process.env.AI_REQUEST_TIMEOUT_MS,
    DEFAULT_CHAT_TIMEOUT_MS,
  );
}

async function postWorkspace<T>(
  path: string,
  body: Record<string, unknown>,
  accessToken: string,
  options: { timeoutMs?: number } = {},
) {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("PYTHON_BACKEND_URL is not configured.");
  }
  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();
  const timeoutMs = options.timeoutMs ?? resolvePythonBackendMaterialTimeoutMs();
  let didTimeout = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = (await safeJson(response)) as PythonWorkspaceEnvelope<T> | null;
    if (!response.ok || !payload?.ok || !payload.data) {
      const error = new Error(
        payload?.error?.message ?? `Python workspace request failed with status ${response.status}.`,
      ) as PythonWorkspaceError;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload.data;
  } catch (error) {
    if (didTimeout || (error instanceof Error && error.name === "AbortError")) {
      const timeoutError = new Error(
        `Python workspace request timed out after ${timeoutMs}ms.`,
      ) as PythonWorkspaceError;
      timeoutError.code = "timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

type WorkspaceSessionRow = {
  id: string;
  class_id: string;
  owner_user_id: string;
  title: string;
  is_pinned: boolean;
  archived_at: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
};

type WorkspaceMessageRow = {
  id: string;
  session_id: string;
  class_id: string;
  author_user_id: string | null;
  author_kind: "student" | "teacher" | "assistant";
  content: string;
  citations: unknown;
  safety: "ok" | "refusal" | null;
  provider: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
};

type WorkspaceModelResponse = {
  answer?: string;
  safety?: "ok" | "refusal";
  confidence?: "low" | "medium" | "high";
  citations?: Array<{
    sourceLabel?: string;
    source_label?: string;
    rationale?: string;
    snippet?: string;
  }>;
};

function normalizeSessionRow(row: WorkspaceSessionRow): ClassChatSession {
  return {
    id: row.id,
    classId: row.class_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    isPinned: row.is_pinned,
    archivedAt: row.archived_at,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeModelResponse(raw: WorkspaceModelResponse): ChatModelResponse {
  return {
    answer: raw.answer?.trim() || "",
    safety: raw.safety === "refusal" ? "refusal" : "ok",
    confidence: raw.confidence,
    citations: (raw.citations ?? [])
      .map((citation) => {
        const sourceLabel =
          (typeof citation.sourceLabel === "string" ? citation.sourceLabel : undefined) ??
          (typeof citation.source_label === "string" ? citation.source_label : undefined) ??
          "";
        const rationale =
          (typeof citation.rationale === "string" ? citation.rationale : undefined) ??
          (typeof citation.snippet === "string" ? citation.snippet : undefined) ??
          "";
        return {
          sourceLabel: sourceLabel.trim(),
          rationale: rationale.trim(),
        };
      })
      .filter((citation) => citation.sourceLabel.length > 0 && citation.rationale.length > 0),
  };
}

function normalizeMessageRow(row: WorkspaceMessageRow): ClassChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    classId: row.class_id,
    authorUserId: row.author_user_id,
    authorKind: row.author_kind,
    content: row.content,
    citations: normalizeCitations(row.citations),
    safety: row.safety,
    provider: row.provider,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}

function normalizeCitations(raw: unknown): { sourceLabel: string; snippet?: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is { sourceLabel?: unknown; source_label?: unknown; snippet?: unknown } =>
      Boolean(item) && typeof item === "object",
    )
    .map((item) => {
      const sourceLabel =
        (typeof item.sourceLabel === "string" ? item.sourceLabel : undefined) ??
        (typeof item.source_label === "string" ? item.source_label : undefined) ??
        "";
      const snippet = typeof item.snippet === "string" ? item.snippet : undefined;
      return {
        sourceLabel: sourceLabel.trim(),
        snippet: snippet?.trim() || undefined,
      };
    })
    .filter((item) => item.sourceLabel.length > 0);
}
