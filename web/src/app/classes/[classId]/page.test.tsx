import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ClassOverviewPage from "@/app/classes/[classId]/page";
import { requireGuestOrVerifiedUser } from "@/lib/auth/session";
import { getClassTeachingBrief } from "@/lib/actions/teaching-brief";

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

vi.mock("@/app/classes/[classId]/MaterialUploadForm", () => ({
  default: () => "<div>MaterialUploadForm</div>",
}));

vi.mock("@/app/components/AuthHeader", () => ({
  default: () => "<div>AuthHeader</div>",
}));

vi.mock("@/app/classes/[classId]/StudentClassExperience", () => ({
  default: () => <div>StudentClassExperience</div>,
}));

vi.mock("@/app/classes/[classId]/_components/MaterialProcessingAutoRefresh", () => ({
  default: () => null,
}));

vi.mock("@/app/classes/[classId]/_components/MaterialActionsMenu", () => ({
  MaterialActionsMenu: () => null,
}));

vi.mock("@/app/classes/[classId]/chat/TeacherChatMonitorPanel", () => ({
  default: () => <div>TeacherChatMonitorPanel</div>,
}));

vi.mock("@/components/ui/transient-feedback-alert", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("@/lib/perf", () => ({
  startServerTimer: () => ({ end: vi.fn() }),
}));

vi.mock("@/app/classes/actions", () => ({
  uploadMaterialMutation: vi.fn(),
}));

vi.mock("@/lib/actions/teaching-brief", () => ({
  getClassTeachingBrief: vi.fn(),
}));

vi.mock(
  "@/app/classes/[classId]/_components/AdaptiveTeachingBriefWidget",
  () => ({
    AdaptiveTeachingBriefWidget: ({ state }: { state: { status: string; isRefreshing: boolean } }) => (
      <div>
        AdaptiveTeachingBriefWidget:{state.status}:{state.isRefreshing ? "refreshing" : "idle"}
      </div>
    ),
  }),
);

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.single = vi.fn(async () => resolveResult());
  builder.maybeSingle = vi.fn(async () => resolveResult());
  builder.in = vi.fn(() => builder);
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
    in: () => typeof builder;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

function installTeacherSupabaseMocks() {
  supabaseFromMock.mockImplementation((table: string) => {
    if (table === "classes") {
      return makeBuilder({
        data: {
          id: "11111111-1111-1111-1111-111111111111",
          title: "Physics 101",
          description: "Intro physics",
          subject: "Physics",
          level: "Grade 11",
          join_code: "ABC123",
          owner_id: "teacher-1",
        },
        error: null,
      });
    }

    if (table === "enrollments") {
      return makeBuilder({
        data: { role: "teacher" },
        error: null,
      });
    }

    if (table === "blueprints") {
      return makeBuilder({
        data: { id: "bp-1", version: 1 },
        error: null,
      });
    }

    if (table === "materials") {
      return makeBuilder({
        data: [],
        error: null,
      });
    }

    if (table === "assignments") {
      return makeBuilder({
        data: [],
        error: null,
      });
    }

    if (table === "activities") {
      return makeBuilder({
        data: [],
        error: null,
      });
    }

    if (table === "assignment_recipients") {
      return makeBuilder({
        data: [],
        error: null,
      });
    }

    if (table === "submissions") {
      return makeBuilder({
        data: [],
        error: null,
      });
    }

    return makeBuilder({ data: null, error: null });
  });
}

describe("ClassOverviewPage teaching brief integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireGuestOrVerifiedUser).mockResolvedValue({
      supabase: { from: supabaseFromMock },
      user: { id: "teacher-1", email: "teacher@example.com" },
      profile: { id: "teacher-1", account_type: "teacher" },
      accountType: "teacher",
      isEmailVerified: true,
    } as never);
    installTeacherSupabaseMocks();
    vi.mocked(getClassTeachingBrief).mockResolvedValue({
      status: "ready",
      generatedAt: "2026-03-24T09:42:00Z",
      isStale: false,
      isRefreshing: false,
      hasEvidence: true,
      error: null,
      payload: {
        summary: "Keep modeling free-body diagrams.",
        strongestAction: "Start with one misconception check.",
        attentionItems: [],
        misconceptions: [],
        studentsToWatch: [],
        nextStep: "Open with a warm-up.",
        recommendedActivity: null,
        evidenceBasis: "Recent activity signals.",
      },
    });
  });

  it("renders the teaching brief widget for teacher view", async () => {
    const html = renderToStaticMarkup(
      await ClassOverviewPage({
        params: Promise.resolve({ classId: "11111111-1111-1111-1111-111111111111" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain("AdaptiveTeachingBriefWidget:ready:idle");
    expect(getClassTeachingBrief).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });

  it("does not render the teaching brief widget for student preview view", async () => {
    const html = renderToStaticMarkup(
      await ClassOverviewPage({
        params: Promise.resolve({ classId: "11111111-1111-1111-1111-111111111111" }),
        searchParams: Promise.resolve({ as: "student" }),
      }),
    );

    expect(html).not.toContain("AdaptiveTeachingBriefWidget");
    expect(getClassTeachingBrief).not.toHaveBeenCalled();
  });

  it("renders stale payload immediately with subtle refreshing metadata", async () => {
    vi.mocked(getClassTeachingBrief).mockResolvedValue({
      status: "generating",
      generatedAt: "2026-03-23T09:42:00Z",
      isStale: true,
      isRefreshing: true,
      hasEvidence: true,
      error: null,
      payload: {
        summary: "Old brief stays visible.",
        strongestAction: "Reinforce vocabulary.",
        attentionItems: [],
        misconceptions: [],
        studentsToWatch: [],
        nextStep: "Use a quick starter.",
        recommendedActivity: null,
        evidenceBasis: "Yesterday's evidence.",
      },
    });

    const html = renderToStaticMarkup(
      await ClassOverviewPage({
        params: Promise.resolve({ classId: "11111111-1111-1111-1111-111111111111" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain("AdaptiveTeachingBriefWidget:generating:refreshing");
  });
});
