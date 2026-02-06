import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import QuizAssignmentPage from "@/app/classes/[classId]/assignments/[assignmentId]/quiz/page";

const supabaseAuth = {
  getUser: vi.fn(),
};
const supabaseFromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: supabaseAuth,
    from: supabaseFromMock,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.single = vi.fn(async () => resolveResult());
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    order: () => typeof builder;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

describe("QuizAssignmentPage", () => {
  it("does not include answer data before reveal conditions are met", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "student-1" } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", title: "Calculus", owner_id: "teacher-1" },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: { role: "student" }, error: null });
      }
      if (table === "assignment_recipients") {
        return makeBuilder({ data: { assignment_id: "assignment-1", status: "assigned" }, error: null });
      }
      if (table === "assignments") {
        return makeBuilder({
          data: { id: "assignment-1", class_id: "class-1", activity_id: "activity-1", due_at: null },
          error: null,
        });
      }
      if (table === "activities") {
        return makeBuilder({
          data: {
            id: "activity-1",
            title: "Quiz 1",
            type: "quiz",
            status: "published",
            config: { attemptLimit: 2 },
          },
          error: null,
        });
      }
      if (table === "quiz_questions") {
        return makeBuilder({
          data: [
            {
              id: "q1",
              question: "1 + 1",
              choices: ["1", "2", "3", "4"],
              answer: "2",
              explanation: "Basic addition",
              order_index: 0,
            },
          ],
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({ data: [], error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await QuizAssignmentPage({
        params: Promise.resolve({ classId: "class-1", assignmentId: "assignment-1" }),
      }),
    );

    expect(html).toContain("Quiz Assignment");
    expect(html).toContain("Submit Attempt");
    expect(html).not.toContain("Basic addition");
    expect(html).not.toContain("Correct answer:");
  });

  it("reveals answers after the student reaches attempt limit", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "student-1" } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", title: "Calculus", owner_id: "teacher-1" },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: { role: "student" }, error: null });
      }
      if (table === "assignment_recipients") {
        return makeBuilder({ data: { assignment_id: "assignment-1", status: "assigned" }, error: null });
      }
      if (table === "assignments") {
        return makeBuilder({
          data: { id: "assignment-1", class_id: "class-1", activity_id: "activity-1", due_at: null },
          error: null,
        });
      }
      if (table === "activities") {
        return makeBuilder({
          data: {
            id: "activity-1",
            title: "Quiz 1",
            type: "quiz",
            status: "published",
            config: { attemptLimit: 2 },
          },
          error: null,
        });
      }
      if (table === "quiz_questions") {
        return makeBuilder({
          data: [
            {
              id: "q1",
              question: "1 + 1",
              choices: ["1", "2", "3", "4"],
              answer: "2",
              explanation: "Basic addition",
              order_index: 0,
            },
          ],
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({
          data: [
            { id: "s1", score: 50, content: { answers: [] }, submitted_at: "2026-01-01T00:00:00.000Z" },
            { id: "s2", score: 100, content: { answers: [] }, submitted_at: "2026-01-01T00:01:00.000Z" },
          ],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await QuizAssignmentPage({
        params: Promise.resolve({ classId: "class-1", assignmentId: "assignment-1" }),
      }),
    );

    expect(html).toContain("Correct answer:");
    expect(html).toContain("Basic addition");
  });
});
