import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startGuestSessionMock, getGuestEntryIpMock } = vi.hoisted(() => ({
  startGuestSessionMock: vi.fn(),
  getGuestEntryIpMock: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
  startGuestSession: startGuestSessionMock,
}));

vi.mock("@/lib/guest/entry-rate-limit", () => ({
  getGuestEntryIp: getGuestEntryIpMock,
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function makeRequest(ip = "203.0.113.10") {
  return new Request("https://example.com/guest/enter", {
    headers: {
      "x-forwarded-for": ip,
    },
  });
}

describe("GET /guest/enter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T00:00:00.000Z"));
    getGuestEntryIpMock.mockReturnValue("203.0.113.10");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a guest session when sandbox provisioning succeeds", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: true,
      redirectTo: "/classes/class-1",
    });
    const { GET } = await loadRoute();

    const response = await GET(makeRequest());

    expect(startGuestSessionMock).toHaveBeenCalledTimes(1);
    expect(startGuestSessionMock).toHaveBeenCalledWith({
      ipAddress: "203.0.113.10",
    });
    expect(response.headers.get("location")).toBe("https://example.com/classes/class-1");
  });

  it("blocks when the hourly IP limit is exceeded", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      code: "too-many-guest-sessions",
      error: "too-many-guest-sessions",
    });
    const { GET } = await loadRoute();

    const response = await GET(makeRequest("203.0.113.12"));

    expect(startGuestSessionMock).toHaveBeenCalledWith({
      ipAddress: "203.0.113.10",
    });
    expect(response.headers.get("location")).toBe(
      "https://example.com/?error=too-many-guest-sessions",
    );
  });

  it("redirects to guest unavailable when provisioning returns a non-rate-limit error", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      code: "guest-auth-unavailable",
      error: "Anonymous auth disabled",
    });
    const { GET } = await loadRoute();

    const response = await GET(makeRequest("203.0.113.12"));

    expect(startGuestSessionMock).toHaveBeenCalledWith({
      ipAddress: "203.0.113.10",
    });
    expect(response.headers.get("location")).toBe("https://example.com/?error=guest-unavailable");
  });

  it("redirects to guest unavailable when sandbox provisioning fails", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: "Guest mode is unavailable.",
    });
    const { GET } = await loadRoute();

    const response = await GET(makeRequest("203.0.113.13"));

    expect(response.headers.get("location")).toBe("https://example.com/?error=guest-unavailable");
  });

  it("redirects to guest session check failed when verification cannot complete", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      code: "guest-session-check-failed",
      error: "We couldn't verify your guest session right now. Please try again.",
    });
    const { GET } = await loadRoute();

    const response = await GET(makeRequest("203.0.113.14"));

    expect(response.headers.get("location")).toBe(
      "https://example.com/?error=guest-session-check-failed",
    );
  });
});
