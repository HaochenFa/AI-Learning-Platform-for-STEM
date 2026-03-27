"use server";

import { getClassAccess, requireAuthenticatedUser } from "@/lib/activities/access";
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
  ChatModelResponse,
  ClassChatMessage,
  ClassChatMessagesPageInfo,
  ClassChatParticipant,
  ClassChatSession,
} from "@/lib/chat/types";
import { parseChatMessage } from "@/lib/chat/validation";

type ActionResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

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

async function resolveAccess(classId: string) {
  const { supabase, user, accessToken, authError, sandboxId } = await requireAuthenticatedUser();

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
    sandboxId,
    role,
  };
}

export async function listClassChatParticipants(
  classId: string,
): Promise<ActionResult<{ participants: ClassChatParticipant[] }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) return access;

  try {
    const data = await listWorkspaceParticipantsViaPython({
      classId,
      userId: access.user.id,
      accessToken: access.accessToken ?? "",
      sandboxId: access.sandboxId,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toFriendlyPythonWorkspaceError(error) };
  }
}

export async function listClassChatSessions(
  classId: string,
  ownerUserId?: string,
): Promise<ActionResult<{ sessions: ClassChatSession[] }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) return access;

  try {
    const data = await listWorkspaceSessionsViaPython({
      classId,
      userId: access.user.id,
      accessToken: access.accessToken ?? "",
      sandboxId: access.sandboxId,
      ownerUserId,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toFriendlyPythonWorkspaceError(error) };
  }
}

export async function createClassChatSession(
  classId: string,
  title?: string,
): Promise<ActionResult<{ session: ClassChatSession }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) return access;

  try {
    const data = await createWorkspaceSessionViaPython({
      classId,
      userId: access.user.id,
      accessToken: access.accessToken ?? "",
      sandboxId: access.sandboxId,
      title,
    });
    return { ok: true, data };
  } catch (error) {
    // Creating a session is mutating and non-idempotent — never fall back on failure.
    return { ok: false, error: toFriendlyPythonWorkspaceError(error) };
  }
}

export async function renameClassChatSession(
  classId: string,
  sessionId: string,
  title: string,
): Promise<ActionResult<{ session: ClassChatSession }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) return access;

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return { ok: false, error: "Session title is required." };
  }

  try {
    const data = await renameWorkspaceSessionViaPython({
      classId,
      userId: access.user.id,
      accessToken: access.accessToken ?? "",
      sandboxId: access.sandboxId,
      sessionId,
      title: normalizedTitle,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toFriendlyPythonWorkspaceError(error) };
  }
}

export async function archiveClassChatSession(
  classId: string,
  sessionId: string,
): Promise<ActionResult<{ sessionId: string }>> {
  const access = await resolveAccess(classId);
  if (!access.ok) return access;

  try {
    const data = await archiveWorkspaceSessionViaPython({
      classId,
      userId: access.user.id,
      accessToken: access.accessToken ?? "",
      sandboxId: access.sandboxId,
      sessionId,
    });
    return { ok: true, data };
  } catch (error) {
    // Archiving is mutating and non-idempotent — never fall back on failure.
    return { ok: false, error: toFriendlyPythonWorkspaceError(error) };
  }
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
  if (!access.ok) return access;

  try {
    const data = await listWorkspaceMessagesViaPython({
      classId,
      userId: access.user.id,
      accessToken: access.accessToken ?? "",
      sandboxId: access.sandboxId,
      sessionId,
      ownerUserId,
      beforeCursor: options?.beforeCursor,
      limit: options?.limit,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toFriendlyPythonWorkspaceError(error) };
  }
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
  if (!access.ok) return access;

  let message: string;
  try {
    message = parseChatMessage(formData.get("message"));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Message is invalid.",
    };
  }

  try {
    const data = await sendWorkspaceMessageViaPython({
      classId,
      userId: access.user.id,
      accessToken: access.accessToken ?? "",
      sessionId,
      message,
      sandboxId: access.sandboxId,
    });
    return { ok: true, data };
  } catch (error) {
    // Sending is mutating — never fall back after an uncertain failure.
    return { ok: false, error: toFriendlyPythonWorkspaceError(error) };
  }
}
