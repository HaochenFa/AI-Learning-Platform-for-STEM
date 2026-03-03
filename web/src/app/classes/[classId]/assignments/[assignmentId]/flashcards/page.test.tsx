import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FlashcardsAssignmentPage from "@/app/classes/[classId]/assignments/[assignmentId]/flashcards/page";

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
  builder.in = vi.fn(() => builder);
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
    in: () => typeof builder;
    order: () => typeof builder;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

describe("FlashcardsAssignmentPage", () => {
  it("renders flashcards assignment workspace", async () => {
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
        return makeBuilder({
          data: { assignment_id: "assignment-1", status: "assigned" },
          error: null,
        });
      }
      if (table === "assignments") {
        return makeBuilder({
          data: {
            id: "assignment-1",
            class_id: "class-1",
            activity_id: "activity-1",
            due_at: null,
          },
          error: null,
        });
      }
      if (table === "activities") {
        return makeBuilder({
          data: {
            id: "activity-1",
            title: "Flashcards 1",
            type: "flashcards",
            status: "published",
            config: { attemptLimit: 1 },
          },
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({ data: [], error: null });
      }
      if (table === "feedback") {
        return makeBuilder({ data: [], error: null });
      }
      if (table === "flashcards") {
        return makeBuilder({
          data: [
            { id: "card-1", front: "Derivative of x^2", back: "2x", order_index: 0 },
            { id: "card-2", front: "Integral of 2x", back: "x^2 + C", order_index: 1 },
          ],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await FlashcardsAssignmentPage({
        params: Promise.resolve({ classId: "class-1", assignmentId: "assignment-1" }),
      }),
    );

    expect(html).toContain("Flashcards 1");
    expect(html).toContain("Submit Session");
    expect(html).not.toContain("Teacher feedback");
  });

  it("renders teacher feedback when a reviewed flashcards submission exists", async () => {
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
        return makeBuilder({
          data: { assignment_id: "assignment-1", status: "reviewed" },
          error: null,
        });
      }
      if (table === "assignments") {
        return makeBuilder({
          data: {
            id: "assignment-1",
            class_id: "class-1",
            activity_id: "activity-1",
            due_at: null,
          },
          error: null,
        });
      }
      if (table === "activities") {
        return makeBuilder({
          data: {
            id: "activity-1",
            title: "Flashcards 1",
            type: "flashcards",
            status: "published",
            config: { attemptLimit: 1 },
          },
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({
          data: [
            {
              id: "session-1",
              content: { knownCount: 5, reviewCount: 2 },
              score: 71,
              submitted_at: "2026-01-01T00:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (table === "feedback") {
        return makeBuilder({
          data: [
            {
              submission_id: "session-1",
              content: {
                comment: "Great retention progress.",
                highlights: ["Strong recall", "Review chain rule cards"],
              },
              created_at: "2026-01-01T00:07:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (table === "flashcards") {
        return makeBuilder({
          data: [{ id: "card-1", front: "Derivative of x^2", back: "2x", order_index: 0 }],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await FlashcardsAssignmentPage({
        params: Promise.resolve({ classId: "class-1", assignmentId: "assignment-1" }),
      }),
    );

    expect(html).toContain("Teacher feedback");
    expect(html).toContain("Great retention progress.");
    expect(html).toContain("Review chain rule cards");
    expect(html).toContain("Score: 71%");
  });

  it("shows score-only review context when submissions exist without written feedback", async () => {
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
        return makeBuilder({
          data: { assignment_id: "assignment-1", status: "submitted" },
          error: null,
        });
      }
      if (table === "assignments") {
        return makeBuilder({
          data: {
            id: "assignment-1",
            class_id: "class-1",
            activity_id: "activity-1",
            due_at: null,
          },
          error: null,
        });
      }
      if (table === "activities") {
        return makeBuilder({
          data: {
            id: "activity-1",
            title: "Flashcards 1",
            type: "flashcards",
            status: "published",
            config: { attemptLimit: 1 },
          },
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({
          data: [
            {
              id: "session-1",
              content: { knownCount: 5, reviewCount: 2 },
              score: 71,
              submitted_at: "2026-01-01T00:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (table === "feedback") {
        return makeBuilder({ data: [], error: null });
      }
      if (table === "flashcards") {
        return makeBuilder({
          data: [{ id: "card-1", front: "Derivative of x^2", back: "2x", order_index: 0 }],
          error: null,
        });
      }
      return makeBuilder({ data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await FlashcardsAssignmentPage({
        params: Promise.resolve({ classId: "class-1", assignmentId: "assignment-1" }),
      }),
    );

    expect(html).toContain("Flashcards 1");
    expect(html).toContain("Teacher feedback");
    expect(html).toContain("Your teacher has reviewed this submission.");
    expect(html).toContain("Score: 71%");
  });
});
