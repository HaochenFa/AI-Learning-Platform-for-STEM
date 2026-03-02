import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AssignmentChatPage from "@/app/classes/[classId]/assignments/[assignmentId]/chat/page";

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
  builder.limit = vi.fn(() => builder);
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
    limit: () => typeof builder;
    single: () => Promise<unknown>;
    maybeSingle: () => Promise<unknown>;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

describe("AssignmentChatPage", () => {
  it("renders assignment chat workspace", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "student-1" } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", title: "Calculus", owner_id: "teacher-1" },
          error: null,
        });
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
            title: "Week 2 Chat",
            type: "chat",
            config: { instructions: "Use formal definitions." },
          },
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await AssignmentChatPage({
        params: Promise.resolve({ classId: "class-1", assignmentId: "assignment-1" }),
      }),
    );

    expect(html).toContain("Week 2 Chat");
    expect(html).toContain("Assignment Instructions");
    expect(html).toContain("Submit Assignment");
  });

  it("renders read-only preview for teachers when using as=student", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: { id: "teacher-1" } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: { id: "class-1", title: "Calculus", owner_id: "teacher-1" },
          error: null,
        });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      if (table === "assignment_recipients") {
        return makeBuilder({ data: null, error: null });
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
            title: "Week 2 Chat",
            type: "chat",
            config: { instructions: "Use formal definitions." },
          },
          error: null,
        });
      }
      if (table === "submissions") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await AssignmentChatPage({
        params: Promise.resolve({ classId: "class-1", assignmentId: "assignment-1" }),
        searchParams: Promise.resolve({ as: "student" }),
      }),
    );

    expect(html).toContain("Preview mode");
    expect(html).toContain("read-only");
  });
});
