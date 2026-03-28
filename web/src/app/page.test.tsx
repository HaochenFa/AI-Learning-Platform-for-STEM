import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "@/app/page";

const { getAuthContextMock } = vi.hoisted(() => ({
  getAuthContextMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthContext: getAuthContextMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_GUEST_MODE_ENABLED = "true";
    getAuthContextMock.mockResolvedValue({
      user: null,
      profile: null,
      isEmailVerified: false,
    });
  });

  it("renders the guest entry CTA when guest mode is enabled", async () => {
    const html = renderToStaticMarkup(await HomePage({}));

    expect(html).toContain("Continue as guest");
    expect(html).toContain("Create account");
  });

  it("shows an inline alert when guest mode is unavailable", async () => {
    const html = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({ error: "guest-unavailable" }),
      }),
    );

    expect(html).toContain("Guest mode is temporarily unavailable");
    expect(html).toContain("We couldn&#x27;t open the guest classroom right now.");
  });

  it("shows a warning when the guest session cannot be verified", async () => {
    const html = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({ error: "guest-session-check-failed" }),
      }),
    );

    expect(html).toContain("Guest session could not be verified");
    expect(html).toContain("Please start a new guest session.");
  });
});
