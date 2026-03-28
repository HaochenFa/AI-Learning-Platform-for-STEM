import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import NewChatAssignmentPage from "@/app/classes/[classId]/activities/chat/new/page";
import { requireGuestOrVerifiedUser } from "@/lib/auth/session";

const supabaseFromMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireGuestOrVerifiedUser: vi.fn(),
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
    maybeSingle: () => Promise<unknown>;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

describe("NewChatAssignmentPage", () => {
  it("renders assignment creation fields", async () => {
    vi.mocked(requireGuestOrVerifiedUser).mockResolvedValueOnce({
      supabase: { from: supabaseFromMock },
      user: { id: "teacher-1", email: "teacher@example.com" },
      profile: { id: "teacher-1", account_type: "teacher" },
      accountType: "teacher",
      isEmailVerified: true,
    } as never);
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
      return makeBuilder({ count: 12, data: null, error: null });
    });

    const html = renderToStaticMarkup(
      await NewChatAssignmentPage({
        params: Promise.resolve({ classId: "class-1" }),
      }),
    );

    expect(html).toContain("Create Chat Assignment");
    expect(html).toContain("Assignment Title");
    expect(html).toContain("Instructions");
    expect(html).toContain("Create and Assign");
  });
});
