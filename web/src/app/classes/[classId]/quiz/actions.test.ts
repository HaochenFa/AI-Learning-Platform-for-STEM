import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateQuizDraft,
  saveQuizDraft,
  submitQuizAttempt,
} from "@/app/classes/[classId]/quiz/actions";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

const {
  requireAuthenticatedUser,
  getClassAccess,
  requirePublishedBlueprintId,
  loadStudentAssignmentContext,
  listStudentSubmissions,
  isDueDateLocked,
  getBestScorePercent,
  markRecipientStatus,
  loadPublishedBlueprintContext,
  retrieveMaterialContext,
  buildQuizGenerationPrompt,
  parseQuizGenerationResponse,
  generateTextWithFallback,
} = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getClassAccess: vi.fn(),
  requirePublishedBlueprintId: vi.fn(),
  loadStudentAssignmentContext: vi.fn(),
  listStudentSubmissions: vi.fn(),
  isDueDateLocked: vi.fn(),
  getBestScorePercent: vi.fn(),
  markRecipientStatus: vi.fn(),
  loadPublishedBlueprintContext: vi.fn(),
  retrieveMaterialContext: vi.fn(),
  buildQuizGenerationPrompt: vi.fn(),
  parseQuizGenerationResponse: vi.fn(),
  generateTextWithFallback: vi.fn(),
}));

vi.mock("@/lib/activities/access", () => ({
  requireAuthenticatedUser,
  getClassAccess,
}));

vi.mock("@/lib/activities/assignments", () => ({
  requirePublishedBlueprintId,
  loadStudentAssignmentContext,
  createWholeClassAssignment: vi.fn(),
}));

vi.mock("@/lib/activities/submissions", () => ({
  listStudentSubmissions,
  isDueDateLocked,
  getBestScorePercent,
  markRecipientStatus,
}));

vi.mock("@/lib/chat/context", () => ({
  loadPublishedBlueprintContext,
}));

vi.mock("@/lib/materials/retrieval", () => ({
  retrieveMaterialContext,
}));

vi.mock("@/lib/quiz/generation", () => ({
  buildQuizGenerationPrompt,
  parseQuizGenerationResponse,
}));

vi.mock("@/lib/ai/providers", () => ({
  generateTextWithFallback,
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.upsert = vi.fn(() => builder);
  builder.single = vi.fn(async () => resolveResult());
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    order: () => typeof builder;
    gte: () => typeof builder;
    insert: () => typeof builder;
    update: () => typeof builder;
    delete: () => typeof builder;
    upsert: () => typeof builder;
    single: () => Promise<unknown>;
    maybeSingle: () => Promise<unknown>;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

async function expectRedirect(action: () => Promise<void> | void, path: string) {
  try {
    await Promise.resolve().then(action);
    throw new Error("Expected redirect");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) {
      expect(String((error as { digest?: string }).digest)).toContain(`;${path};`);
      return;
    }
    throw error;
  }
}

describe("quiz actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClassAccess.mockResolvedValue({
      found: true,
      isTeacher: true,
      isMember: true,
      classTitle: "Calculus",
    });
    isDueDateLocked.mockReturnValue(false);
    getBestScorePercent.mockImplementation((_: unknown, fallback: number) => fallback);
  });

  it("saves draft questions via upsert and trims stale rows", async () => {
    const supabaseFromMock = vi.fn();
    requireAuthenticatedUser.mockResolvedValue({
      supabase: { from: supabaseFromMock },
      user: { id: "teacher-1" },
    });

    const activitySelectBuilder = makeBuilder({
      data: { id: "activity-1", class_id: "class-1", type: "quiz", status: "draft", config: {} },
      error: null,
    });
    const activityUpdateBuilder = makeBuilder({ error: null });
    const questionsUpsertBuilder = makeBuilder({ error: null });
    const questionsTrimBuilder = makeBuilder({ error: null });

    let activitiesCalls = 0;
    let questionsCalls = 0;
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "activities") {
        activitiesCalls += 1;
        return activitiesCalls === 1 ? activitySelectBuilder : activityUpdateBuilder;
      }
      if (table === "quiz_questions") {
        questionsCalls += 1;
        return questionsCalls === 1 ? questionsUpsertBuilder : questionsTrimBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set(
      "quiz_payload",
      JSON.stringify({
        title: "Quiz 1",
        instructions: "Answer carefully.",
        questions: [
          {
            question: "1 + 1",
            choices: ["1", "2", "3", "4"],
            answer: "2",
            explanation: "Basic addition.",
          },
        ],
      }),
    );

    await expectRedirect(
      () => saveQuizDraft("class-1", "activity-1", formData),
      "/classes/class-1/activities/quiz/activity-1/edit?saved=1",
    );

    expect(questionsUpsertBuilder.upsert).toHaveBeenCalled();
    expect(questionsTrimBuilder.gte).toHaveBeenCalledWith("order_index", 1);
  });

  it("records in-progress status when attempts remain after a submission", async () => {
    const supabaseFromMock = vi.fn();
    requireAuthenticatedUser.mockResolvedValue({
      supabase: { from: supabaseFromMock },
      user: { id: "student-1" },
    });
    getClassAccess.mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
    });
    loadStudentAssignmentContext.mockResolvedValue({
      assignment: { due_at: null },
      activity: {
        id: "activity-1",
        title: "Quiz 1",
        type: "quiz",
        status: "published",
        config: { attemptLimit: 2 },
      },
      recipient: { assignment_id: "assignment-1", status: "assigned" },
    });
    listStudentSubmissions.mockResolvedValue([]);

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "quiz_questions") {
        return makeBuilder({
          data: [
            {
              id: "q1",
              question: "1 + 1",
              choices: ["1", "2", "3", "4"],
              answer: "2",
              explanation: "Basic addition.",
              order_index: 0,
            },
          ],
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({ error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("answers", JSON.stringify([{ questionId: "q1", selectedChoice: "2" }]));

    await expectRedirect(
      () => submitQuizAttempt("class-1", "assignment-1", formData),
      "/classes/class-1/assignments/assignment-1/quiz?submitted=1&best=100",
    );

    expect(markRecipientStatus).toHaveBeenCalledWith({
      supabase: expect.any(Object),
      assignmentId: "assignment-1",
      studentId: "student-1",
      status: "in_progress",
    });
  });

  it("handles duplicate-attempt insert conflicts gracefully", async () => {
    const supabaseFromMock = vi.fn();
    requireAuthenticatedUser.mockResolvedValue({
      supabase: { from: supabaseFromMock },
      user: { id: "student-1" },
    });
    getClassAccess.mockResolvedValue({
      found: true,
      isTeacher: false,
      isMember: true,
      classTitle: "Calculus",
    });
    loadStudentAssignmentContext.mockResolvedValue({
      assignment: { due_at: null },
      activity: {
        id: "activity-1",
        title: "Quiz 1",
        type: "quiz",
        status: "published",
        config: { attemptLimit: 2 },
      },
      recipient: { assignment_id: "assignment-1", status: "assigned" },
    });
    listStudentSubmissions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ score: 100 }, { score: 90 }]);

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "quiz_questions") {
        return makeBuilder({
          data: [
            {
              id: "q1",
              question: "1 + 1",
              choices: ["1", "2", "3", "4"],
              answer: "2",
              explanation: "Basic addition.",
              order_index: 0,
            },
          ],
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({ error: { code: "23505", message: "duplicate key value" } });
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("answers", JSON.stringify([{ questionId: "q1", selectedChoice: "2" }]));

    await expectRedirect(
      () => submitQuizAttempt("class-1", "assignment-1", formData),
      "/classes/class-1/assignments/assignment-1/quiz?error=No%20attempts%20remaining%20for%20this%20quiz.",
    );
  });

  it("rolls back draft activity when generated questions fail to insert", async () => {
    const supabaseFromMock = vi.fn();
    requireAuthenticatedUser.mockResolvedValue({
      supabase: { from: supabaseFromMock },
      user: { id: "teacher-1" },
    });
    getClassAccess.mockResolvedValue({
      found: true,
      isTeacher: true,
      isMember: true,
      classTitle: "Calculus",
    });
    requirePublishedBlueprintId.mockResolvedValue("bp-1");
    loadPublishedBlueprintContext.mockResolvedValue({
      blueprintContext: "Limits and derivatives",
    });
    retrieveMaterialContext.mockResolvedValue("Material context");
    buildQuizGenerationPrompt.mockReturnValue({ system: "system", user: "user" });
    generateTextWithFallback.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      content: "{}",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 12,
    });
    parseQuizGenerationResponse.mockReturnValue({
      questions: [
        {
          question: "1 + 1",
          choices: ["1", "2", "3", "4"],
          answer: "2",
          explanation: "Basic addition.",
        },
      ],
    });

    const activityInsertBuilder = makeBuilder({ data: { id: "activity-1" }, error: null });
    const activityCleanupBuilder = makeBuilder({ error: null });
    const failedQuestionInsertBuilder = makeBuilder({ error: { message: "insert failed" } });
    const aiRequestsBuilder = makeBuilder({ error: null });

    let activitiesCalls = 0;
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "activities") {
        activitiesCalls += 1;
        return activitiesCalls === 1 ? activityInsertBuilder : activityCleanupBuilder;
      }
      if (table === "quiz_questions") {
        return failedQuestionInsertBuilder;
      }
      if (table === "ai_requests") {
        return aiRequestsBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    const formData = new FormData();
    formData.set("title", "Generated Quiz");
    formData.set("instructions", "Use only class notes.");
    formData.set("question_count", "1");

    await expectRedirect(
      () => generateQuizDraft("class-1", formData),
      "/classes/class-1/activities/quiz/new?error=insert%20failed",
    );

    expect(activityCleanupBuilder.delete).toHaveBeenCalled();
    expect(activityCleanupBuilder.eq).toHaveBeenCalledWith("id", "activity-1");
  });
});
