import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestClassTeachingBrief } from "@/lib/ai/python-backend";

describe("requestClassTeachingBrief", () => {
  const originalBackendUrl = process.env.PYTHON_BACKEND_URL;
  const originalBackendApiKey = process.env.PYTHON_BACKEND_API_KEY;

  beforeEach(() => {
    process.env.PYTHON_BACKEND_URL = "http://python-backend.test";
    process.env.PYTHON_BACKEND_API_KEY = "test-api-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env.PYTHON_BACKEND_URL = originalBackendUrl;
    process.env.PYTHON_BACKEND_API_KEY = originalBackendApiKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes mixed teaching-brief payload shapes into render-safe UI data", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            status: "ready",
            generated_at: "2026-03-27T09:42:00Z",
            is_stale: false,
            has_evidence: true,
            payload: {
              summary: " Students still need another pass on force pairs. ",
              strongest_action: " Re-model the interaction pair. ",
              attention_items: [
                {
                  topic: "Newton's Third Law",
                  detail: "Students still swap action and reaction.",
                },
                "Net force language",
              ],
              misconceptions: [
                {
                  topic: "Newton's Third Law",
                  description: "They think bigger objects push harder.",
                },
              ],
              students_to_watch: [
                {
                  student_id: "student-1",
                  reason: "Low completion this week.",
                },
              ],
              next_step: " Start with a hinge question. ",
              recommended_activity: {
                type: "quiz",
                topic: "Newton's Third Law",
                reason: "Check whether the misconception is shrinking.",
              },
              evidence_basis: " Recent quiz attempts and class chat transcripts. ",
            },
            error_message: null,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await requestClassTeachingBrief({
      classId: "11111111-1111-1111-1111-111111111111",
      userId: "teacher-1",
      forceRefresh: false,
      accessToken: "session-token",
    });

    expect(result).toEqual({
      status: "ready",
      generatedAt: "2026-03-27T09:42:00Z",
      isStale: false,
      isRefreshing: false,
      hasEvidence: true,
      payload: {
        summary: "Students still need another pass on force pairs.",
        strongestAction: "Re-model the interaction pair.",
        attentionItems: [
          "Newton's Third Law: Students still swap action and reaction.",
          "Net force language",
        ],
        misconceptions: [
          {
            topicId: null,
            topicTitle: "Newton's Third Law",
            description: "They think bigger objects push harder.",
          },
        ],
        studentsToWatch: [
          {
            studentId: "student-1",
            displayName: "student-1",
            reason: "Low completion this week.",
          },
        ],
        nextStep: "Start with a hinge question.",
        recommendedActivity: {
          type: "quiz",
          reason: "Check whether the misconception is shrinking.",
        },
        evidenceBasis: "Recent quiz attempts and class chat transcripts.",
      },
      error: null,
    });
  });

  it("preserves students-to-watch entries that have only a display name", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            status: "ready",
            generated_at: "2026-03-27T09:42:00Z",
            is_stale: false,
            has_evidence: true,
            payload: {
              summary: "Brief",
              strongest_action: "Action",
              attention_items: [],
              misconceptions: [],
              students_to_watch: [{ display_name: "Jordan K." }],
              next_step: "Next step",
              recommended_activity: { type: "quiz", reason: "Reason" },
              evidence_basis: "Evidence",
            },
            error_message: null,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await requestClassTeachingBrief({
      classId: "11111111-1111-1111-1111-111111111111",
      userId: "teacher-1",
      forceRefresh: false,
      accessToken: "session-token",
    });

    expect(result.payload?.studentsToWatch).toEqual([
      { studentId: "", displayName: "Jordan K.", reason: "" },
    ]);
  });

  it("preserves non-empty recommended activity labels from the backend", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            status: "ready",
            generated_at: null,
            is_stale: false,
            has_evidence: true,
            payload: {
              summary: "Brief summary",
              strongest_action: "Take one action",
              attention_items: [],
              misconceptions: [],
              students_to_watch: [],
              next_step: "Next step",
              recommended_activity: {
                type: "Quiz",
                reason: "Reuse the backend label as-is in the badge.",
              },
              evidence_basis: "Recent work",
            },
            error_message: null,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await requestClassTeachingBrief({
      classId: "11111111-1111-1111-1111-111111111111",
      userId: "teacher-1",
      forceRefresh: false,
    });

    expect(result.payload?.recommendedActivity).toEqual({
      type: "Quiz",
      reason: "Reuse the backend label as-is in the badge.",
    });
  });
});
