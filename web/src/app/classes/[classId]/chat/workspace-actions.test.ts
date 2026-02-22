import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listClassChatMessages,
  listClassChatParticipants,
  listClassChatSessions,
  sendClassChatMessage,
} from "@/app/classes/[classId]/chat/workspace-actions";

const { requireAuthenticatedUser, getClassAccess, generateGroundedChatResponse, createAdminSupabaseClient } =
  vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getClassAccess: vi.fn(),
  generateGroundedChatResponse: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/activities/access", () => ({
  requireAuthenticatedUser,
  getClassAccess,
}));

vi.mock("@/lib/chat/generate", () => ({
  generateGroundedChatResponse,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient,
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.lte = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.single = vi.fn(async () => resolveResult());
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    or: () => typeof builder;
    lte: () => typeof builder;
    is: () => typeof builder;
    order: () => typeof builder;
    limit: () => typeof builder;
    in: () => typeof builder;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
    insert: () => typeof builder;
    update: () => typeof builder;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

describe("workspace chat actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists persistent sessions for the signed-in member", async () => {
    const supabaseFromMock = vi.fn((table: string) => {
      if (table === "class_chat_sessions") {
        return makeBuilder({
          data: [
            {
              id: "session-1",
              class_id: "class-1",
              owner_user_id: "student-1",
              title: "Limits review",
              is_pinned: false,
              archived_at: null,
              last_message_at: "2026-02-10T12:00:00.000Z",
              created_at: "2026-02-09T12:00:00.000Z",
              updated_at: "2026-02-10T12:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
    } as never);

    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    const result = await listClassChatSessions("class-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sessions).toHaveLength(1);
      expect(result.data.sessions[0]?.title).toBe("Limits review");
    }
  });

  it("lists student chat monitor participants for teachers", async () => {
    const supabaseFromMock = vi.fn((table: string) => {
      if (table === "enrollments") {
        return makeBuilder({
          data: [{ user_id: "student-1" }, { user_id: "student-2" }],
          error: null,
        });
      }

      if (table === "profiles") {
        return makeBuilder({
          data: [
            { id: "student-1", display_name: "Alex" },
            { id: "student-2", display_name: "Sam" },
          ],
          error: null,
        });
      }

      return makeBuilder({ data: null, error: null });
    });

    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "teacher-1" },
      profile: { id: "teacher-1", account_type: "teacher" },
      isEmailVerified: true,
      authError: null,
    } as never);

    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: true,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    const result = await listClassChatParticipants("class-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.participants).toEqual([
        { userId: "student-1", displayName: "Alex" },
        { userId: "student-2", displayName: "Sam" },
      ]);
    }
  });

  it("sends a persistent class chat message and appends assistant reply", async () => {
    let messagesCall = 0;
    const assistantInsertBuilder = makeBuilder({ error: null });
    const updateBuilder = makeBuilder({ error: null });

    const supabaseFromMock = vi.fn((table: string) => {
      if (table === "class_chat_sessions") {
        const builder = messagesCall === 0
          ? makeBuilder({
              data: {
                id: "session-1",
                class_id: "class-1",
                owner_user_id: "student-1",
                title: "Limits review",
                is_pinned: false,
                archived_at: null,
                last_message_at: "2026-02-10T12:00:00.000Z",
                created_at: "2026-02-09T12:00:00.000Z",
                updated_at: "2026-02-10T12:00:00.000Z",
              },
              error: null,
            })
          : updateBuilder;
        messagesCall += 1;
        return builder;
      }

      if (table === "class_chat_messages") {
        return makeBuilder({ data: [], error: null });
      }

      if (table === "class_chat_session_compactions") {
        return makeBuilder({ data: null, error: null });
      }

      return makeBuilder({ data: null, error: null });
    });

    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
    } as never);

    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "class_chat_messages") {
          return assistantInsertBuilder;
        }
        return makeBuilder({ data: null, error: null });
      }),
    } as never);

    vi.mocked(generateGroundedChatResponse).mockResolvedValue({
      safety: "ok",
      answer: "Start by writing the epsilon-delta definition.",
      citations: [{ sourceLabel: "Blueprint Context", rationale: "Formal objective for limits." }],
    });

    const formData = new FormData();
    formData.set("message", "How do I start this proof?");

    const result = await sendClassChatMessage("class-1", "session-1", formData);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.response.answer).toContain("epsilon-delta");
      expect(result.data.assistantMessage.citations[0]?.sourceLabel).toBe("Blueprint Context");
      expect(result.data.contextMeta.compacted).toBe(false);
    }

    expect(vi.mocked(generateGroundedChatResponse)).toHaveBeenCalled();
    expect(assistantInsertBuilder.insert).toHaveBeenCalled();
  });

  it("returns a safe error when grounded response generation throws", async () => {
    const supabaseFromMock = vi.fn((table: string) => {
      if (table === "class_chat_sessions") {
        return makeBuilder({
          data: {
            id: "session-1",
            class_id: "class-1",
            owner_user_id: "student-1",
            title: "Limits review",
            is_pinned: false,
            archived_at: null,
            last_message_at: "2026-02-10T12:00:00.000Z",
            created_at: "2026-02-09T12:00:00.000Z",
            updated_at: "2026-02-10T12:00:00.000Z",
          },
          error: null,
        });
      }

      if (table === "class_chat_messages") {
        return makeBuilder({ data: [], error: null });
      }

      if (table === "class_chat_session_compactions") {
        return makeBuilder({ data: null, error: null });
      }

      return makeBuilder({ data: null, error: null });
    });

    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
    } as never);

    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    vi.mocked(generateGroundedChatResponse).mockRejectedValue(new Error("Blueprint context missing"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const formData = new FormData();
    formData.set("message", "Can you help me with limits?");

    const result = await sendClassChatMessage("class-1", "session-1", formData);

    expect(result).toEqual({
      ok: false,
      error: "Sorry, I couldn't generate a response right now. Please try again.",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to generate always-on class chat response",
      expect.objectContaining({
        classId: "class-1",
        sessionId: "session-1",
        userId: "student-1",
        error: "Blueprint context missing",
      }),
    );

    errorSpy.mockRestore();
  });

  it("lists latest chat messages first page and returns pagination cursor", async () => {
    const supabaseFromMock = vi.fn((table: string) => {
      if (table === "class_chat_sessions") {
        return makeBuilder({
          data: {
            id: "session-1",
            class_id: "class-1",
            owner_user_id: "student-1",
            title: "Limits review",
            is_pinned: false,
            archived_at: null,
            last_message_at: "2026-02-10T12:00:00.000Z",
            created_at: "2026-02-09T12:00:00.000Z",
            updated_at: "2026-02-10T12:00:00.000Z",
          },
          error: null,
        });
      }
      if (table === "class_chat_messages") {
        return makeBuilder({
          data: [
            {
              id: "m3",
              session_id: "session-1",
              class_id: "class-1",
              author_user_id: null,
              author_kind: "assistant",
              content: "Third",
              citations: [],
              safety: "ok",
              provider: null,
              model: null,
              prompt_tokens: null,
              completion_tokens: null,
              total_tokens: null,
              latency_ms: null,
              created_at: "2026-02-10T12:03:00.000Z",
            },
            {
              id: "m2",
              session_id: "session-1",
              class_id: "class-1",
              author_user_id: "student-1",
              author_kind: "student",
              content: "Second",
              citations: [],
              safety: null,
              provider: null,
              model: null,
              prompt_tokens: null,
              completion_tokens: null,
              total_tokens: null,
              latency_ms: null,
              created_at: "2026-02-10T12:02:00.000Z",
            },
            {
              id: "m1",
              session_id: "session-1",
              class_id: "class-1",
              author_user_id: "student-1",
              author_kind: "student",
              content: "First",
              citations: [],
              safety: null,
              provider: null,
              model: null,
              prompt_tokens: null,
              completion_tokens: null,
              total_tokens: null,
              latency_ms: null,
              created_at: "2026-02-10T12:01:00.000Z",
            },
          ],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
    } as never);

    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    const result = await listClassChatMessages("class-1", "session-1", undefined, { limit: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.messages).toHaveLength(2);
      expect(result.data.messages[0]?.id).toBe("m2");
      expect(result.data.messages[1]?.id).toBe("m3");
      expect(result.data.pageInfo.hasMore).toBe(true);
      expect(result.data.pageInfo.nextCursor).toBe("2026-02-10T12:02:00.000Z|m2");
    }
  });

  it("uses strict DB cursor predicate and pageSize+1 for older-message pagination", async () => {
    const messagesBuilder = makeBuilder({
      data: [
        {
          id: "m2",
          session_id: "session-1",
          class_id: "class-1",
          author_user_id: null,
          author_kind: "assistant",
          content: "Older same timestamp",
          citations: [],
          safety: "ok",
          provider: null,
          model: null,
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
          latency_ms: null,
          created_at: "2026-02-10T12:03:00.000Z",
        },
        {
          id: "m1",
          session_id: "session-1",
          class_id: "class-1",
          author_user_id: "student-1",
          author_kind: "student",
          content: "Older",
          citations: [],
          safety: null,
          provider: null,
          model: null,
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
          latency_ms: null,
          created_at: "2026-02-10T12:02:00.000Z",
        },
        {
          id: "m0",
          session_id: "session-1",
          class_id: "class-1",
          author_user_id: "student-1",
          author_kind: "student",
          content: "Oldest",
          citations: [],
          safety: null,
          provider: null,
          model: null,
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
          latency_ms: null,
          created_at: "2026-02-10T12:01:00.000Z",
        },
      ],
      error: null,
    });

    const supabaseFromMock = vi.fn((table: string) => {
      if (table === "class_chat_sessions") {
        return makeBuilder({
          data: {
            id: "session-1",
            class_id: "class-1",
            owner_user_id: "student-1",
            title: "Limits review",
            is_pinned: false,
            archived_at: null,
            last_message_at: "2026-02-10T12:00:00.000Z",
            created_at: "2026-02-09T12:00:00.000Z",
            updated_at: "2026-02-10T12:00:00.000Z",
          },
          error: null,
        });
      }
      if (table === "class_chat_messages") {
        return messagesBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      supabase: {
        from: supabaseFromMock,
      },
      user: { id: "student-1" },
      profile: { id: "student-1", account_type: "student" },
      isEmailVerified: true,
      authError: null,
    } as never);

    vi.mocked(getClassAccess).mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
      classOwnerId: "teacher-1",
    });

    const cursor = "2026-02-10T12:03:00.000Z|m3";
    const result = await listClassChatMessages("class-1", "session-1", undefined, {
      limit: 2,
      beforeCursor: cursor,
    });

    expect(messagesBuilder.or).toHaveBeenCalledWith(
      "created_at.lt.2026-02-10T12:03:00.000Z,and(created_at.eq.2026-02-10T12:03:00.000Z,id.lt.m3)",
    );
    expect(messagesBuilder.limit).toHaveBeenCalledWith(3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.messages).toHaveLength(2);
      expect(result.data.messages[0]?.id).toBe("m1");
      expect(result.data.messages[1]?.id).toBe("m2");
      expect(result.data.pageInfo.hasMore).toBe(true);
      expect(result.data.pageInfo.nextCursor).toBe("2026-02-10T12:02:00.000Z|m1");
    }
  });
});
