import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const maybeSingleMock = vi.fn();
const updateMock = vi.fn().mockReturnThis();
const eqMock = vi.fn().mockReturnThis();
const signOutMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: getUserMock,
      signOut: signOutMock,
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: eqMock,
      maybeSingle: maybeSingleMock,
      update: updateMock,
    })),
  })),
}));

import { middleware } from "../../../middleware";

function makeRequest(pathname: string) {
  return {
    url: `https://example.com${pathname}`,
    nextUrl: {
      pathname,
      clone() {
        const url = new URL(`https://example.com${pathname}`);
        return {
          pathname: url.pathname,
          searchParams: url.searchParams,
        };
      },
    },
    cookies: {
      getAll: () => [],
    },
  } as never;
}

describe("middleware guest session handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";

    eqMock.mockReturnThis();
    updateMock.mockReturnThis();
    signOutMock.mockResolvedValue({ error: null });
  });

  it("redirects to a distinct guest session check error when sandbox lookup fails", async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "guest-user-1",
          is_anonymous: true,
          app_metadata: { provider: "anonymous" },
        },
      },
    });
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "db unavailable" },
    });

    const response = await middleware(makeRequest("/classes/class-1"));

    expect(signOutMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://example.com/?error=guest-session-check-failed",
    );
  });
});
