import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getClassTeachingBrief,
  refreshClassTeachingBrief,
  type TeachingBriefActionResult,
} from "@/lib/actions/teaching-brief";
import { requireVerifiedUser } from "@/lib/auth/session";
import { requestClassTeachingBrief } from "@/lib/ai/python-backend";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  requireVerifiedUser: vi.fn(),
}));

vi.mock("@/lib/ai/python-backend", () => ({
  requestClassTeachingBrief: vi.fn(),
}));

const supabaseFromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    from: supabaseFromMock,
  }),
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => resolveResult());
  return builder as {
    select: () => typeof builder;
    eq: () => typeof builder;
    maybeSingle: () => Promise<unknown>;
  };
}

describe("teaching brief actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireVerifiedUser).mockResolvedValue({
      user: { id: "teacher-1" },
      accessToken: "session-token",
    } as never);

    supabaseFromMock.mockImplementation(() =>
      makeBuilder({
        data: { role: "teacher" },
        error: null,
      }),
    );
  });

  it("returns a typed teaching brief payload for a valid teacher fetch", async () => {
    vi.mocked(requestClassTeachingBrief).mockResolvedValue({
      status: "ready",
      generatedAt: "2026-03-23T09:42:00Z",
      isStale: false,
      isRefreshing: false,
      hasEvidence: true,
      error: null,
      payload: {
        summary: "Students are steady on recall questions but still miss force-pair reasoning.",
        strongestAction: "Model one free-body-diagram example before class practice.",
        attentionItems: ["Force pairs", "Net force explanations"],
        misconceptions: [
          {
            topicId: "topic-1",
            topicTitle: "Newton's Third Law",
            description: "Students often think the larger object exerts the larger force.",
          },
        ],
        studentsToWatch: [
          {
            studentId: "student-1",
            displayName: "Alex P.",
            reason: "Low completion and weak apply-level performance.",
          },
        ],
        nextStep: "Open class with a two-minute misconception check.",
        recommendedActivity: {
          type: "quiz",
          reason: "A short retrieval check can surface whether the misconception is shrinking.",
        },
        evidenceBasis: "Based on recent assignment scores and class chat participation.",
      },
    } satisfies TeachingBriefActionResult);

    const result = await getClassTeachingBrief("11111111-1111-1111-1111-111111111111");

    expect(result).toEqual({
      status: "ready",
      generatedAt: "2026-03-23T09:42:00Z",
      isStale: false,
      isRefreshing: false,
      hasEvidence: true,
      error: null,
      payload: expect.objectContaining({
        summary: expect.any(String),
        strongestAction: expect.any(String),
        attentionItems: expect.any(Array),
      }),
    });
    expect(requestClassTeachingBrief).toHaveBeenCalledWith({
      classId: "11111111-1111-1111-1111-111111111111",
      userId: "teacher-1",
      forceRefresh: false,
      accessToken: "session-token",
    });
  });

  it("rejects an invalid class id", async () => {
    const result = await getClassTeachingBrief("not-a-uuid");

    expect(result).toEqual({
      status: "error",
      generatedAt: null,
      isStale: false,
      isRefreshing: false,
      hasEvidence: false,
      payload: null,
      error: "Invalid class.",
    });
    expect(requestClassTeachingBrief).not.toHaveBeenCalled();
  });

  it("returns a friendly timeout error when the backend times out", async () => {
    vi.mocked(requestClassTeachingBrief).mockRejectedValue(
      new Error("Python backend request (/v1/analytics/class-teaching-brief) timed out after 30000ms."),
    );

    const result = await getClassTeachingBrief("11111111-1111-1111-1111-111111111111");

    expect(result).toEqual({
      status: "error",
      generatedAt: null,
      isStale: false,
      isRefreshing: false,
      hasEvidence: false,
      payload: null,
      error: "Teaching brief request timed out. Please try again.",
    });
  });

  it("denies unauthorized teacher fetches", async () => {
    supabaseFromMock.mockImplementation(() =>
      makeBuilder({
        data: { role: "student" },
        error: null,
      }),
    );

    const result = await getClassTeachingBrief("11111111-1111-1111-1111-111111111111");

    expect(result).toEqual({
      status: "error",
      generatedAt: null,
      isStale: false,
      isRefreshing: false,
      hasEvidence: false,
      payload: null,
      error: "Unauthorized.",
    });
    expect(requestClassTeachingBrief).not.toHaveBeenCalled();
  });

  it("denies unauthorized teacher refreshes", async () => {
    supabaseFromMock.mockImplementation(() =>
      makeBuilder({
        data: { role: "student" },
        error: null,
      }),
    );

    const result = await refreshClassTeachingBrief("11111111-1111-1111-1111-111111111111");

    expect(result).toEqual({
      status: "error",
      generatedAt: null,
      isStale: false,
      isRefreshing: false,
      hasEvidence: false,
      payload: null,
      error: "Unauthorized.",
    });
    expect(requestClassTeachingBrief).not.toHaveBeenCalled();
  });

  it("passes forceRefresh=true when explicitly refreshing the brief", async () => {
    vi.mocked(requestClassTeachingBrief).mockResolvedValue({
      status: "generating",
      generatedAt: "2026-03-22T09:42:00Z",
      isStale: true,
      isRefreshing: true,
      hasEvidence: true,
      error: null,
      payload: {
        summary: "Keep stale content visible.",
        strongestAction: "Reinforce momentum vocabulary.",
        attentionItems: [],
        misconceptions: [],
        studentsToWatch: [],
        nextStep: "Start with a warm-up sort.",
        recommendedActivity: null,
        evidenceBasis: "Based on yesterday's quiz results.",
      },
    } satisfies TeachingBriefActionResult);

    const result = await refreshClassTeachingBrief("11111111-1111-1111-1111-111111111111");

    expect(result.status).toBe("generating");
    expect(requestClassTeachingBrief).toHaveBeenCalledWith({
      classId: "11111111-1111-1111-1111-111111111111",
      userId: "teacher-1",
      forceRefresh: true,
      accessToken: "session-token",
    });
  });
});
