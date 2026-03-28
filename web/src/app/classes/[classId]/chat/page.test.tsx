import { describe, expect, it, vi } from "vitest";
import ClassChatCompatibilityPage from "@/app/classes/[classId]/chat/page";

const supabaseAuth = {
  getSession: vi.fn(),
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
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(async () => resolveResult());
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    single: () => Promise<unknown>;
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

describe("ClassChatCompatibilityPage", () => {
  it("redirects student members to class chat-focused view", async () => {
    supabaseAuth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: "student-1", email_confirmed_at: "2026-01-01T00:00:00.000Z" } } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: {
            id: "class-1",
            owner_id: "teacher-1",
          },
          error: null,
        });
      }
      if (table === "profiles") {
        return makeBuilder({ data: { id: "student-1", account_type: "student", display_name: "Student" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: { role: "student" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () =>
        ClassChatCompatibilityPage({
          params: Promise.resolve({ classId: "class-1" }),
        }),
      "/classes/class-1?view=chat",
    );
  });

  it("redirects teachers to class monitor anchor", async () => {
    supabaseAuth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: "teacher-1", email_confirmed_at: "2026-01-01T00:00:00.000Z" } } } });
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({
          data: {
            id: "class-1",
            owner_id: "teacher-1",
          },
          error: null,
        });
      }
      if (table === "profiles") {
        return makeBuilder({ data: { id: "teacher-1", account_type: "teacher", display_name: "Teacher" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    await expectRedirect(
      () =>
        ClassChatCompatibilityPage({
          params: Promise.resolve({ classId: "class-1" }),
        }),
      "/classes/class-1#teacher-chat-monitor",
    );
  });
});
