"use server";

import { getClassAccess, requireAuthenticatedUser } from "@/lib/activities/access";
import { resolvePythonBackendEnabled, resolvePythonBackendStrict } from "@/lib/ai/python-migration";
import { generateGroundedChatResponse } from "@/lib/chat/generate";
import {
  archiveWorkspaceSessionViaPython,
  createWorkspaceSessionViaPython,
  listWorkspaceMessagesViaPython,
  listWorkspaceParticipantsViaPython,
  listWorkspaceSessionsViaPython,
  renameWorkspaceSessionViaPython,
  sendWorkspaceMessageViaPython,
} from "@/lib/chat/python-workspace";
import type {
  ChatCompactionSummary,
  ChatModelResponse,
  ChatTurn,
  ClassChatMessage,
  ClassChatMessagesPageInfo,
  ClassChatParticipant,
  ClassChatSession,
} from "@/lib/chat/types";
import { MAX_CHAT_TURNS, parseChatMessage } from "@/lib/chat/validation";
import {
  buildCompactionDecision,
  buildCompactionMemoryText,
  buildCompactionResult,
  CHAT_COMPACTION_TRIGGER_TURNS,
  CHAT_CONTEXT_RECENT_TURNS,
  compareMessageChronology,
  parseCompactionSummary,
  sortMessagesChronologically,
} from "@/lib/chat/compaction";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type ActionResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

type SessionRow = {
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

type MessageRow = {
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

type SessionCompactionRow = {
  session_id: string;
  class_id: string;
  owner_user_id: string;
  summary_text: string;
  summary_json: unknown;
  compacted_through_created_at: string | null;
  compacted_through_message_id: string | null;
  compacted_turn_count: number | null;
  last_compacted_at: string | null;
  created_at: string;
  updated_at: string;
};

function parsePositiveIntegerEnv(envValue: string | undefined, fallback: number) {
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
}

const CHAT_HISTORY_PAGE_SIZE = parsePositiveIntegerEnv(process.env.CHAT_HISTORY_PAGE_SIZE, 120);
const CHAT_CONTEXT_FETCH_LIMIT = Math.max(CHAT_COMPACTION_TRIGGER_TURNS * 3, CHAT_CONTEXT_RECENT_TURNS * 3, 180);

function shouldUsePythonChatWorkspaceBackend() {
  return resolvePythonBackendEnabled(
    process.env.PYTHON_BACKEND_CHAT_WORKSPACE_ENABLED ??
      process.env.PYTHON_BACKEND_CHAT_ENABLED ??
      process.env.PYTHON_BACKEND_ENABLED,
  );
}

function isPythonBackendStrict() {
  return resolvePythonBackendStrict();
}

function toFriendlyPythonWorkspaceError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Unable to load class chat workspace right now. Please try again.";
  }

  const code = (error as { code?: unknown }).code;
  if (code === "class_access_required") {
    return "Class access required.";
  }
  if (code === "teacher_access_required") {
    return "Teacher access is required to monitor student chats.";
  }
  if (code === "owner_user_not_enrolled") {
    return "Selected user is not enrolled in this class.";
  }
  if (code === "session_not_found") {
    return "Chat session not found.";
  }
  if (code === "session_owner_mismatch") {
    return "Chat session does not belong to the selected user.";
  }
  if (code === "send_session_owner_mismatch") {
    return "You can only send messages in your own chat sessions.";
  }
  if (code === "response_generation_failed") {
    return "Sorry, I couldn't generate a response right now. Please try again.";
  }

  return error.message || "Unable to load class chat workspace right now. Please try again.";
}

function normalizeSession(row: SessionRow): ClassChatSession {
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

function normalizeCitations(raw: unknown): { sourceLabel: string; snippet?: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item): item is { sourceLabel: string; snippet?: string } => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const sourceLabel = (item as { sourceLabel?: unknown }).sourceLabel;
      const snippet = (item as { snippet?: unknown }).snippet;
      return (
        typeof sourceLabel === "string" &&
        sourceLabel.trim().length > 0 &&
        (typeof snippet === "undefined" || typeof snippet === "string")
      );
    })
    .map((item) => ({
      sourceLabel: item.sourceLabel.trim(),
      snippet: item.snippet?.trim() || undefined,
    }));
}

function normalizeMessage(row: MessageRow): ClassChatMessage {
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

function normalizeMessagesChronological(rows: MessageRow[]) {
  const normalized = rows.map((row) => normalizeMessage(row));
  return normalized.sort(compareMessageChronology);
}

function encodeMessageCursor(message: ClassChatMessage) {
  return `${message.createdAt}|${message.id}`;
}

function decodeMessageCursor(cursor: string | null | undefined) {
  if (!cursor) {
    return null;
  }
  const splitIndex = cursor.lastIndexOf("|");
  if (splitIndex <= 0 || splitIndex >= cursor.length - 1) {
    return null;
  }
  const createdAt = cursor.slice(0, splitIndex);
  const id = cursor.slice(splitIndex + 1);
  if (!createdAt || !id) {
    return null;
  }
  return { createdAt, id };
}

function buildBeforeCursorPredicate(cursor: { createdAt: string; id: string }) {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

function normalizeCompactionSummary(row: SessionCompactionRow | null | undefined): ChatCompactionSummary | null {
  if (!row) {
    return null;
  }
  const parsed = parseCompactionSummary(row.summary_json);
  if (!parsed) {
    return null;
  }
  return {
    ...parsed,
    compactedThrough: {
      createdAt: row.compacted_through_created_at ?? parsed.compactedThrough.createdAt,
      messageId: row.compacted_through_message_id ?? parsed.compactedThrough.messageId,
      turnCount: row.compacted_turn_count ?? parsed.compactedThrough.turnCount,
    },
  };
}

async function resolveAccess(classId: string) {
  const { supabase, user, accessToken, authError } = await requireAuthenticatedUser();

  if (!user) {
    return {
      ok: false as const,
      error: "Please sign in to use class chat.",
    };
  }
  if (authError) {
    return {
      ok: false as const,
      error: authError,
    };
  }

  const role = await getClassAccess(supabase, classId, user.id);
  if (!role.found || !role.isMember) {
    return {
      ok: false as const,
      error: "Class access required.",
    };
  }

  return {
    ok: true as const,
    supabase,
    user,
    accessToken,
    role,
  };
}

async function resolveOwnerUserId(input: {
  classId: string;
  requestedOwnerUserId?: string;
  currentUserId: string;
  isTeacher: boolean;
  supabase: Awaited<ReturnType<typeof requireAuthenticatedUser>>["supabase"];
}) {
  const requestedOwnerUserId = input.requestedOwnerUserId?.trim();
  if (!requestedOwnerUserId || requestedOwnerUserId === input.currentUserId) {
    return { ok: true as const, ownerUserId: input.currentUserId };
  }

  if (!input.isTeacher) {
    return {
      ok: false as const,
      error: "Teacher access is required to view another student's chat.",
    };
  }

  const { data: enrollment, error } = await input.supabase
    .from("enrollments")
    .select("user_id")
    .eq("class_id", input.classId)
    .eq("user_id", requestedOwnerUserId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, error: error.message };
  }

  if (!enrollment) {
    return {
      ok: false as const,
      error: "Selected user is not enrolled in this class.",
    };
  }

  return { ok: true as const, ownerUserId: requestedOwnerUserId };
}

async function getSessionWithAccess(input: {
  classId: string;
  sessionId: string;
  supabase: Awaited<ReturnType<typeof requireAuthenticatedUser>>["supabase"];
}) {
  const { data: session, error } = await input.supabase
    .from("class_chat_sessions")
    .select("id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at")
    .eq("class_id", input.classId)
    .eq("id", input.sessionId)
    .maybeSingle<SessionRow>();

  if (error) {
    return { ok: false as const, error: error.message };
  }

  if (!session) {
    return { ok: false as const, error: "Chat session not found." };
  }

  return { ok: true as const, session: normalizeSession(session) };
}

export async function listClassChatParticipants(
  classId: string,
): Promise<ActionResult<{ participants: ClassChatParticipant[] }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  if (shouldUsePythonChatWorkspaceBackend()) {
    try {
      const data = await listWorkspaceParticipantsViaPython({
        classId,
        userId: access.user.id,
        accessToken: access.accessToken ?? "",
      });
      return {
        ok: true,
        data,
      };
    } catch (error) {
      if (isPythonBackendStrict()) {
        return {
          ok: false,
          error: toFriendlyPythonWorkspaceError(error),
        };
      }
    }
  }

  if (!access.role.isTeacher) {
    return {
      ok: false,
      error: "Teacher access is required to monitor student chats.",
    };
  }

  const { data: enrollments, error: enrollmentsError } = await access.supabase
    .from("enrollments")
    .select("user_id")
    .eq("class_id", classId)
    .eq("role", "student")
    .order("joined_at", { ascending: true });

  if (enrollmentsError) {
    return {
      ok: false,
      error: enrollmentsError.message,
    };
  }

  const userIds = (enrollments ?? []).map((item) => item.user_id);
  if (userIds.length === 0) {
    return {
      ok: true,
      data: {
        participants: [],
      },
    };
  }

  const { data: profiles, error: profilesError } = await access.supabase
    .from("profiles")
    .select("id,display_name")
    .in("id", userIds);

  if (profilesError) {
    return {
      ok: false,
      error: profilesError.message,
    };
  }

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.display_name?.trim() || ""]),
  );

  const participants = userIds.map((userId, index) => {
    const displayName = profileById.get(userId);
    return {
      userId,
      displayName: displayName || `Student ${index + 1}`,
    } satisfies ClassChatParticipant;
  });

  return {
    ok: true,
    data: {
      participants,
    },
  };
}

export async function listClassChatSessions(
  classId: string,
  ownerUserId?: string,
): Promise<ActionResult<{ sessions: ClassChatSession[] }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  if (shouldUsePythonChatWorkspaceBackend()) {
    try {
      const data = await listWorkspaceSessionsViaPython({
        classId,
        userId: access.user.id,
        accessToken: access.accessToken ?? "",
        ownerUserId,
      });
      return {
        ok: true,
        data,
      };
    } catch (error) {
      if (isPythonBackendStrict()) {
        return {
          ok: false,
          error: toFriendlyPythonWorkspaceError(error),
        };
      }
    }
  }

  const owner = await resolveOwnerUserId({
    classId,
    requestedOwnerUserId: ownerUserId,
    currentUserId: access.user.id,
    isTeacher: access.role.isTeacher,
    supabase: access.supabase,
  });

  if (!owner.ok) {
    return owner;
  }

  const { data: sessions, error } = await access.supabase
    .from("class_chat_sessions")
    .select("id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at")
    .eq("class_id", classId)
    .eq("owner_user_id", owner.ownerUserId)
    .is("archived_at", null)
    .order("is_pinned", { ascending: false })
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  return {
    ok: true,
    data: {
      sessions: (sessions ?? []).map((session) => normalizeSession(session as SessionRow)),
    },
  };
}

export async function createClassChatSession(
  classId: string,
  title?: string,
): Promise<ActionResult<{ session: ClassChatSession }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  if (shouldUsePythonChatWorkspaceBackend()) {
    try {
      const data = await createWorkspaceSessionViaPython({
        classId,
        userId: access.user.id,
        accessToken: access.accessToken ?? "",
        title,
      });
      return {
        ok: true,
        data,
      };
    } catch (error) {
      if (isPythonBackendStrict()) {
        return {
          ok: false,
          error: toFriendlyPythonWorkspaceError(error),
        };
      }
    }
  }

  const normalizedTitle = title?.trim() || "New chat";
  const safeTitle = normalizedTitle.slice(0, 120);

  const { data: session, error } = await access.supabase
    .from("class_chat_sessions")
    .insert({
      class_id: classId,
      owner_user_id: access.user.id,
      title: safeTitle,
      last_message_at: new Date().toISOString(),
    })
    .select("id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at")
    .single<SessionRow>();

  if (error || !session) {
    return {
      ok: false,
      error: error?.message ?? "Failed to create chat session.",
    };
  }

  return {
    ok: true,
    data: {
      session: normalizeSession(session),
    },
  };
}

export async function renameClassChatSession(
  classId: string,
  sessionId: string,
  title: string,
): Promise<ActionResult<{ session: ClassChatSession }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return {
      ok: false,
      error: "Session title is required.",
    };
  }

  if (shouldUsePythonChatWorkspaceBackend()) {
    try {
      const data = await renameWorkspaceSessionViaPython({
        classId,
        userId: access.user.id,
        accessToken: access.accessToken ?? "",
        sessionId,
        title: normalizedTitle,
      });
      return {
        ok: true,
        data,
      };
    } catch (error) {
      if (isPythonBackendStrict()) {
        return {
          ok: false,
          error: toFriendlyPythonWorkspaceError(error),
        };
      }
    }
  }

  const { data: session, error } = await access.supabase
    .from("class_chat_sessions")
    .update({
      title: normalizedTitle.slice(0, 120),
    })
    .eq("class_id", classId)
    .eq("id", sessionId)
    .eq("owner_user_id", access.user.id)
    .is("archived_at", null)
    .select("id,class_id,owner_user_id,title,is_pinned,archived_at,last_message_at,created_at,updated_at")
    .single<SessionRow>();

  if (error || !session) {
    return {
      ok: false,
      error: error?.message ?? "Unable to rename chat session.",
    };
  }

  return {
    ok: true,
    data: {
      session: normalizeSession(session),
    },
  };
}

export async function archiveClassChatSession(
  classId: string,
  sessionId: string,
): Promise<ActionResult<{ sessionId: string }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  if (shouldUsePythonChatWorkspaceBackend()) {
    try {
      const data = await archiveWorkspaceSessionViaPython({
        classId,
        userId: access.user.id,
        accessToken: access.accessToken ?? "",
        sessionId,
      });
      return {
        ok: true,
        data,
      };
    } catch (error) {
      if (isPythonBackendStrict()) {
        return {
          ok: false,
          error: toFriendlyPythonWorkspaceError(error),
        };
      }
    }
  }

  const { error } = await access.supabase
    .from("class_chat_sessions")
    .update({
      archived_at: new Date().toISOString(),
    })
    .eq("class_id", classId)
    .eq("id", sessionId)
    .eq("owner_user_id", access.user.id)
    .is("archived_at", null);

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  return {
    ok: true,
    data: {
      sessionId,
    },
  };
}

export async function listClassChatMessages(
  classId: string,
  sessionId: string,
  ownerUserId?: string,
  options?: {
    beforeCursor?: string | null;
    limit?: number;
  },
): Promise<
  ActionResult<{
    session: ClassChatSession;
    messages: ClassChatMessage[];
    pageInfo: ClassChatMessagesPageInfo;
  }>
> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  if (shouldUsePythonChatWorkspaceBackend()) {
    try {
      const data = await listWorkspaceMessagesViaPython({
        classId,
        userId: access.user.id,
        accessToken: access.accessToken ?? "",
        sessionId,
        ownerUserId,
        beforeCursor: options?.beforeCursor,
        limit: options?.limit,
      });
      return {
        ok: true,
        data,
      };
    } catch (error) {
      if (isPythonBackendStrict()) {
        return {
          ok: false,
          error: toFriendlyPythonWorkspaceError(error),
        };
      }
    }
  }

  const owner = await resolveOwnerUserId({
    classId,
    requestedOwnerUserId: ownerUserId,
    currentUserId: access.user.id,
    isTeacher: access.role.isTeacher,
    supabase: access.supabase,
  });
  if (!owner.ok) {
    return owner;
  }

  const sessionResult = await getSessionWithAccess({
    classId,
    sessionId,
    supabase: access.supabase,
  });
  if (!sessionResult.ok) {
    return sessionResult;
  }

  if (sessionResult.session.ownerUserId !== owner.ownerUserId) {
    return {
      ok: false,
      error: "Chat session does not belong to the selected user.",
    };
  }

  const requestedLimit =
    typeof options?.limit === "number" && Number.isFinite(options.limit) ? options.limit : CHAT_HISTORY_PAGE_SIZE;
  const pageSize = Math.max(1, Math.min(200, Math.floor(requestedLimit)));
  const beforeCursor = decodeMessageCursor(options?.beforeCursor);
  const queryLimit = pageSize + 1;

  const query = access.supabase
    .from("class_chat_messages")
    .select(
      "id,session_id,class_id,author_user_id,author_kind,content,citations,safety,provider,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,created_at",
    )
    .eq("class_id", classId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(queryLimit);

  if (beforeCursor) {
    query.or(buildBeforeCursorPredicate(beforeCursor));
  }

  const { data: rows, error } = await query;

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const descendingMessages = normalizeMessagesChronological((rows ?? []) as MessageRow[]).reverse();
  const pageSlice = descendingMessages.slice(0, pageSize);
  const hasMore = descendingMessages.length > pageSize;
  const oldestInPage = pageSlice[pageSlice.length - 1];

  return {
    ok: true,
    data: {
      session: sessionResult.session,
      messages: pageSlice.reverse(),
      pageInfo: {
        hasMore,
        nextCursor: hasMore && oldestInPage ? encodeMessageCursor(oldestInPage) : null,
      },
    },
  };
}

function messagesToTranscript(messages: ClassChatMessage[], maxTurns = MAX_CHAT_TURNS): ChatTurn[] {
  const chronological = sortMessagesChronologically(messages);
  return chronological.slice(-maxTurns).map((message) => ({
      role: message.authorKind === "assistant" ? "assistant" : "student",
      message: message.content,
      createdAt: message.createdAt,
      citations: message.authorKind === "assistant" ? message.citations : undefined,
    }));
}

export async function sendClassChatMessage(
  classId: string,
  sessionId: string,
  formData: FormData,
): Promise<
  ActionResult<{
    response: ChatModelResponse;
    userMessage: ClassChatMessage;
    assistantMessage: ClassChatMessage;
    contextMeta: {
      compacted: boolean;
      compactedAt: string | null;
      reason: string | null;
    };
  }>
> {
  const access = await resolveAccess(classId);
  if (!access.ok) {
    return access;
  }

  let message: string;
  try {
    message = parseChatMessage(formData.get("message"));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Message is invalid.",
    };
  }

  if (shouldUsePythonChatWorkspaceBackend()) {
    try {
      const data = await sendWorkspaceMessageViaPython({
        classId,
        userId: access.user.id,
        accessToken: access.accessToken ?? "",
        sessionId,
        message,
      });
      return {
        ok: true,
        data,
      };
    } catch (error) {
      if (isPythonBackendStrict()) {
        return {
          ok: false,
          error: toFriendlyPythonWorkspaceError(error),
        };
      }
    }
  }

  const sessionResult = await getSessionWithAccess({
    classId,
    sessionId,
    supabase: access.supabase,
  });

  if (!sessionResult.ok) {
    return sessionResult;
  }

  if (sessionResult.session.ownerUserId !== access.user.id) {
    return {
      ok: false,
      error: "You can only send messages in your own chat sessions.",
    };
  }

  const { data: contextRows, error: contextError } = await access.supabase
    .from("class_chat_messages")
    .select(
      "id,session_id,class_id,author_user_id,author_kind,content,citations,safety,provider,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,created_at",
    )
    .eq("class_id", classId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CHAT_CONTEXT_FETCH_LIMIT);

  if (contextError) {
    return {
      ok: false,
      error: contextError.message,
    };
  }

  const chronologicalMessages = normalizeMessagesChronological((contextRows ?? []) as MessageRow[]);

  const { data: compactionRow, error: compactionError } = await access.supabase
    .from("class_chat_session_compactions")
    .select(
      "session_id,class_id,owner_user_id,summary_text,summary_json,compacted_through_created_at,compacted_through_message_id,compacted_turn_count,last_compacted_at,created_at,updated_at",
    )
    .eq("session_id", sessionId)
    .eq("class_id", classId)
    .eq("owner_user_id", access.user.id)
    .maybeSingle<SessionCompactionRow>();

  if (compactionError) {
    return {
      ok: false,
      error: compactionError.message,
    };
  }

  const existingCompaction = normalizeCompactionSummary(compactionRow ?? null);
  const compactionDecision = buildCompactionDecision({
    messages: chronologicalMessages,
    existingSummary: existingCompaction,
    pendingUserMessage: message,
  });

  let effectiveCompaction = existingCompaction;
  let contextCompacted = false;
  let compactionReason: string | null = null;
  let compactedAt: string | null = null;

  if (compactionDecision.shouldCompact) {
    const compactionResult = buildCompactionResult({
      messages: chronologicalMessages,
      existingSummary: existingCompaction,
      latestUserMessage: message,
    });

    if (compactionResult) {
      effectiveCompaction = compactionResult.summary;
      contextCompacted = true;
      compactionReason = compactionDecision.reason;
      compactedAt = compactionResult.summary.generatedAt;
      const summaryPayload = {
        session_id: sessionId,
        class_id: classId,
        owner_user_id: access.user.id,
        summary_text: compactionResult.summaryText,
        summary_json: compactionResult.summary,
        compacted_through_created_at: compactionResult.summary.compactedThrough.createdAt,
        compacted_through_message_id: compactionResult.summary.compactedThrough.messageId,
        compacted_turn_count: compactionResult.summary.compactedThrough.turnCount,
        last_compacted_at: compactionResult.summary.generatedAt,
      };

      try {
        if (compactionRow) {
          const { error: updateCompactionError } = await access.supabase
            .from("class_chat_session_compactions")
            .update(summaryPayload)
            .eq("session_id", sessionId)
            .eq("class_id", classId)
            .eq("owner_user_id", access.user.id);

          if (updateCompactionError) {
            console.error("Failed to update class chat compaction summary", {
              classId,
              sessionId,
              userId: access.user.id,
              error: updateCompactionError.message,
            });
          }
        } else {
          const { error: insertCompactionError } = await access.supabase
            .from("class_chat_session_compactions")
            .insert(summaryPayload);

          if (insertCompactionError) {
            console.error("Failed to insert class chat compaction summary", {
              classId,
              sessionId,
              userId: access.user.id,
              error: insertCompactionError.message,
            });
          }
        }
      } catch (error) {
        console.error("Unexpected error while persisting class chat compaction summary", {
          classId,
          sessionId,
          userId: access.user.id,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }

  const transcript = messagesToTranscript(chronologicalMessages, CHAT_CONTEXT_RECENT_TURNS);
  const compactedMemoryContext = buildCompactionMemoryText(effectiveCompaction);

  let response: ChatModelResponse;
  try {
    response = await generateGroundedChatResponse({
      classId,
      classTitle: access.role.classTitle,
      userId: access.user.id,
      userMessage: message,
      transcript,
      compactedMemoryContext,
      sessionId: `class-chat-${sessionId}`,
      purpose: access.role.isTeacher ? "teacher_chat_always_on_v1" : "student_chat_always_on_v1",
    });
  } catch (error) {
    console.error("Failed to generate always-on class chat response", {
      classId,
      sessionId,
      userId: access.user.id,
      error: error instanceof Error ? error.message : error,
    });
    return {
      ok: false,
      error: "Sorry, I couldn't generate a response right now. Please try again.",
    };
  }

  const now = new Date().toISOString();
  const authorKind = access.role.isTeacher ? "teacher" : "student";
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();

  const userRow: MessageRow = {
    id: userMessageId,
    session_id: sessionId,
    class_id: classId,
    author_user_id: access.user.id,
    author_kind: authorKind,
    content: message,
    citations: [],
    safety: null,
    provider: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    latency_ms: null,
    created_at: now,
  };

  const assistantRow: MessageRow = {
    id: assistantMessageId,
    session_id: sessionId,
    class_id: classId,
    author_user_id: null,
    author_kind: "assistant",
    content: response.answer,
    citations: response.citations.map((citation) => ({
      sourceLabel: citation.sourceLabel,
      snippet: citation.rationale,
    })),
    safety: response.safety,
    provider: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    latency_ms: null,
    created_at: now,
  };

  try {
    const adminSupabase = createAdminSupabaseClient();
    const { error: insertError } = await adminSupabase.from("class_chat_messages").insert([
      {
        id: userRow.id,
        session_id: userRow.session_id,
        class_id: userRow.class_id,
        author_user_id: userRow.author_user_id,
        author_kind: userRow.author_kind,
        content: userRow.content,
        citations: userRow.citations,
        safety: userRow.safety,
        provider: userRow.provider,
        model: userRow.model,
        prompt_tokens: userRow.prompt_tokens,
        completion_tokens: userRow.completion_tokens,
        total_tokens: userRow.total_tokens,
        latency_ms: userRow.latency_ms,
        created_at: userRow.created_at,
      },
      {
        id: assistantRow.id,
        session_id: assistantRow.session_id,
        class_id: assistantRow.class_id,
        author_user_id: assistantRow.author_user_id,
        author_kind: assistantRow.author_kind,
        content: assistantRow.content,
        citations: assistantRow.citations,
        safety: assistantRow.safety,
        provider: assistantRow.provider,
        model: assistantRow.model,
        prompt_tokens: assistantRow.prompt_tokens,
        completion_tokens: assistantRow.completion_tokens,
        total_tokens: assistantRow.total_tokens,
        latency_ms: assistantRow.latency_ms,
        created_at: assistantRow.created_at,
      },
    ]);

    if (insertError) {
      return {
        ok: false,
        error: insertError.message,
      };
    }
  } catch (error) {
    console.error("Failed to persist assistant class chat message", {
      classId,
      sessionId,
      userId: access.user.id,
      error: error instanceof Error ? error.message : error,
    });
    return {
      ok: false,
      error: "Failed to save assistant response.",
    };
  }

  const { error: sessionUpdateError } = await access.supabase
    .from("class_chat_sessions")
    .update({
      last_message_at: now,
    })
    .eq("id", sessionId)
    .eq("class_id", classId)
    .eq("owner_user_id", access.user.id);

  if (sessionUpdateError) {
    return {
      ok: false,
      error: sessionUpdateError.message,
    };
  }

  return {
    ok: true,
    data: {
      response,
      userMessage: normalizeMessage(userRow),
      assistantMessage: normalizeMessage(assistantRow),
      contextMeta: {
        compacted: contextCompacted,
        compactedAt,
        reason: compactionReason,
      },
    },
  };
}
