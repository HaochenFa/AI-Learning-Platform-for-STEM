import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryClassData } from "@/lib/actions/insights";
import { requireGuestOrVerifiedUser } from "@/lib/auth/session";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  requireGuestOrVerifiedUser: vi.fn(),
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

describe("queryClassData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    process.env.PYTHON_BACKEND_API_KEY = "backend-key";

    vi.mocked(requireGuestOrVerifiedUser).mockResolvedValue({
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

  it("forwards the actor bearer token to the data query backend route", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            spec: {
              type: "chart",
              chartType: "bar",
              title: "Scores",
              data: [{ label: "Week 1", value: 92 }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await queryClassData(
      "11111111-1111-1111-1111-111111111111",
      "Show topic performance",
    );

    expect(result).toEqual({
      ok: true,
      spec: {
        type: "chart",
        chartType: "bar",
        title: "Scores",
        data: [{ label: "Week 1", value: 92 }],
      },
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer session-token",
        "x-api-key": "backend-key",
      }),
    );
  });
});
