import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveClassChatSession,
  createClassChatSession,
  listClassChatMessages,
  listClassChatParticipants,
  listClassChatSessions,
  renameClassChatSession,
  sendClassChatMessage,
} from "@/app/classes/[classId]/chat/workspace-actions";

const {
  requireAuthenticatedUser,
  getClassAccess,
  listWorkspaceParticipantsViaPython,
  listWorkspaceSessionsViaPython,
  createWorkspaceSessionViaPython,
  renameWorkspaceSessionViaPython,
  archiveWorkspaceSessionViaPython,
  listWorkspaceMessagesViaPython,
  sendWorkspaceMessageViaPython,
} = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getClassAccess: vi.fn(),
  listWorkspaceParticipantsViaPython: vi.fn(),
  listWorkspaceSessionsViaPython: vi.fn(),
  createWorkspaceSessionViaPython: vi.fn(),
  renameWorkspaceSessionViaPython: vi.fn(),
  archiveWorkspaceSessionViaPython: vi.fn(),
  listWorkspaceMessagesViaPython: vi.fn(),
  sendWorkspaceMessageViaPython: vi.fn(),
}));

vi.mock("@/lib/activities/access", () => ({
  requireAuthenticatedUser,
  getClassAccess,
}));

vi.mock("@/lib/chat/python-workspace", () => ({
  listWorkspaceParticipantsViaPython,
  listWorkspaceSessionsViaPython,
  createWorkspaceSessionViaPython,
  renameWorkspaceSessionViaPython,
  archiveWorkspaceSessionViaPython,
  listWorkspaceMessagesViaPython,
  sendWorkspaceMessageViaPython,
}));

function makeAuthUser(userId: string, isTeacher = false) {
  vi.mocked(requireAuthenticatedUser).mockResolvedValue({
    supabase: { from: vi.fn() },
    user: { id: userId },
    profile: { id: userId, account_type: isTeacher ? "teacher" : "student" },
    isEmailVerified: true,
    authError: null,
    accessToken: "session-token",
  } as never);
  vi.mocked(getClassAccess).mockResolvedValue({
    found: true,
    isTeacher,
    isMember: true,
    classTitle: "Calculus",
    classOwnerId: "teacher-1",
  });
}

describe("workspace chat actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes session listing through python workspace", async () => {
    vi.mocked(listWorkspaceSessionsViaPython).mockResolvedValue({
      sessions: [
        {
          id: "session-python-1",
          classId: "class-1",
          ownerUserId: "student-1",
          title: "Python session",
          isPinned: false,
          archivedAt: null,
          lastMessageAt: "2026-02-10T12:00:00.000Z",
          createdAt: "2026-02-10T12:00:00.000Z",
          updatedAt: "2026-02-10T12:00:00.000Z",
        },
      ],
    });
    makeAuthUser("student-1");

    const result = await listClassChatSessions("class-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sessions[0]?.id).toBe("session-python-1");
    }
    expect(listWorkspaceSessionsViaPython).toHaveBeenCalledWith({
      classId: "class-1",
      userId: "student-1",
      accessToken: "session-token",
      ownerUserId: undefined,
    });
  });

  it("creates, renames, and archives sessions through python workspace", async () => {
    vi.mocked(listWorkspaceSessionsViaPython).mockResolvedValue({ sessions: [] });
    vi.mocked(createWorkspaceSessionViaPython).mockResolvedValue({
      session: {
        id: "session-python-1",
        classId: "class-1",
        ownerUserId: "student-1",
        title: "New chat",
        isPinned: false,
        archivedAt: null,
        lastMessageAt: "2026-02-10T12:00:00.000Z",
        createdAt: "2026-02-10T12:00:00.000Z",
        updatedAt: "2026-02-10T12:00:00.000Z",
      },
    });
    vi.mocked(renameWorkspaceSessionViaPython).mockResolvedValue({
      session: {
        id: "session-python-1",
        classId: "class-1",
        ownerUserId: "student-1",
        title: "Renamed session",
        isPinned: false,
        archivedAt: null,
        lastMessageAt: "2026-02-10T12:00:00.000Z",
        createdAt: "2026-02-10T12:00:00.000Z",
        updatedAt: "2026-02-10T12:01:00.000Z",
      },
    });
    vi.mocked(archiveWorkspaceSessionViaPython).mockResolvedValue({
      sessionId: "session-python-1",
    });
    makeAuthUser("student-1");

    const createResult = await createClassChatSession("class-1", "  New chat  ");
    expect(createResult.ok).toBe(true);
    expect(createWorkspaceSessionViaPython).toHaveBeenCalledWith({
      classId: "class-1",
      userId: "student-1",
      accessToken: "session-token",
      title: "  New chat  ",
    });

    const renameResult = await renameClassChatSession("class-1", "session-python-1", " Renamed session ");
    expect(renameResult.ok).toBe(true);
    expect(renameWorkspaceSessionViaPython).toHaveBeenCalledWith({
      classId: "class-1",
      userId: "student-1",
      accessToken: "session-token",
      sessionId: "session-python-1",
      title: "Renamed session",
    });

    const archiveResult = await archiveClassChatSession("class-1", "session-python-1");
    expect(archiveResult).toEqual({
      ok: true,
      data: { sessionId: "session-python-1" },
    });
    expect(archiveWorkspaceSessionViaPython).toHaveBeenCalledWith({
      classId: "class-1",
      userId: "student-1",
      accessToken: "session-token",
      sessionId: "session-python-1",
    });
  });

  it("does not fall back to local insert when python session creation fails", async () => {
    vi.mocked(createWorkspaceSessionViaPython).mockRejectedValue(
      Object.assign(new Error("Python workspace request timed out after 45000ms."), {
        code: "timeout",
      }),
    );
    const supabaseFromMock = vi.fn();
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: { from: supabaseFromMock },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
      accessToken: "session-token",
    } as never);
    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    const result = await createClassChatSession("class-1", "New chat");

    expect(result).toEqual({
      ok: false,
      error: "Python workspace request timed out after 45000ms.",
    });
    expect(createWorkspaceSessionViaPython).toHaveBeenCalledTimes(1);
    expect(supabaseFromMock).not.toHaveBeenCalled();
  });

  it("routes message sending through python workspace", async () => {
    vi.mocked(sendWorkspaceMessageViaPython).mockResolvedValue({
      response: {
        safety: "ok",
        answer: "Start by writing the epsilon-delta definition.",
        citations: [{ sourceLabel: "Blueprint Context", rationale: "Formal objective for limits." }],
      },
      userMessage: {
        id: "u1",
        sessionId: "session-1",
        classId: "class-1",
        authorUserId: "student-1",
        authorKind: "student",
        content: "How do I start this proof?",
        citations: [],
        safety: null,
        provider: null,
        model: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs: null,
        createdAt: "2026-02-10T12:03:00.000Z",
      },
      assistantMessage: {
        id: "a1",
        sessionId: "session-1",
        classId: "class-1",
        authorUserId: null,
        authorKind: "assistant",
        content: "Start by writing the epsilon-delta definition.",
        citations: [{ sourceLabel: "Blueprint Context", snippet: "Formal objective for limits." }],
        safety: "ok",
        provider: "openrouter",
        model: "model-a",
        promptTokens: 11,
        completionTokens: 22,
        totalTokens: 33,
        latencyMs: 444,
        createdAt: "2026-02-10T12:03:00.000Z",
      },
      contextMeta: {
        compacted: false,
        compactedAt: null,
        reason: null,
      },
    });
    makeAuthUser("student-1");

    const formData = new FormData();
    formData.set("message", "How do I start this proof?");
    const result = await sendClassChatMessage("class-1", "session-1", formData);

    expect(result.ok).toBe(true);
    expect(sendWorkspaceMessageViaPython).toHaveBeenCalledWith({
      classId: "class-1",
      userId: "student-1",
      accessToken: "session-token",
      sessionId: "session-1",
      message: "How do I start this proof?",
    });
  });

  it("returns mapped python workspace error when sending fails", async () => {
    vi.mocked(sendWorkspaceMessageViaPython).mockRejectedValue(
      Object.assign(new Error("Cannot send"), { code: "send_session_owner_mismatch" }),
    );
    makeAuthUser("student-1");

    const formData = new FormData();
    formData.set("message", "How do I start this proof?");
    const result = await sendClassChatMessage("class-1", "session-1", formData);
    expect(result).toEqual({
      ok: false,
      error: "You can only send messages in your own chat sessions.",
    });
  });

  it("returns mapped python workspace error when listing messages fails", async () => {
    vi.mocked(listWorkspaceMessagesViaPython).mockRejectedValue(
      Object.assign(new Error("Owner mismatch"), { code: "session_owner_mismatch" }),
    );
    makeAuthUser("teacher-1", true);

    const result = await listClassChatMessages("class-1", "session-1", "student-2");
    expect(result).toEqual({
      ok: false,
      error: "Chat session does not belong to the selected user.",
    });
  });

  it("routes participant listing through python workspace", async () => {
    vi.mocked(listWorkspaceParticipantsViaPython).mockResolvedValue({
      participants: [
        { userId: "student-1", displayName: "Alex" },
        { userId: "student-2", displayName: "Sam" },
      ],
    });
    makeAuthUser("teacher-1", true);

    const result = await listClassChatParticipants("class-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.participants).toEqual([
        { userId: "student-1", displayName: "Alex" },
        { userId: "student-2", displayName: "Sam" },
      ]);
    }
    expect(listWorkspaceParticipantsViaPython).toHaveBeenCalledWith({
      classId: "class-1",
      userId: "teacher-1",
      accessToken: "session-token",
    });
  });

  it("returns mapped python workspace error when participant listing fails", async () => {
    vi.mocked(listWorkspaceParticipantsViaPython).mockRejectedValue(
      Object.assign(new Error("Access denied"), { code: "teacher_access_required" }),
    );
    makeAuthUser("student-1");

    const result = await listClassChatParticipants("class-1");
    expect(result).toEqual({
      ok: false,
      error: "Teacher access is required to monitor student chats.",
    });
  });

  it("returns access denied when user is not authenticated", async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: { from: vi.fn() },
      user: null,
      profile: null,
      isEmailVerified: false,
      authError: null,
      accessToken: null,
    } as never);

    const result = await listClassChatSessions("class-1");
    expect(result).toEqual({ ok: false, error: "Please sign in to use class chat." });
  });

  it("returns error when user is not a class member", async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: { from: vi.fn() },
      user: { id: "outsider" },
      profile: { id: "outsider", account_type: "student" },
      isEmailVerified: true,
      authError: null,
      accessToken: "token",
    } as never);
    vi.mocked(getClassAccess).mockResolvedValue({
      found: false,
      isTeacher: false,
      isMember: false,
      classTitle: "",
      classOwnerId: "",
    });

    const result = await listClassChatSessions("class-1");
    expect(result).toEqual({ ok: false, error: "Class access required." });
  });
});
