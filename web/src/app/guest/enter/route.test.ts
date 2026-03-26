import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startGuestSessionMock } = vi.hoisted(() => ({
  startGuestSessionMock: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
  startGuestSession: startGuestSessionMock,
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a guest session when the IP is below the hourly limit", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: true,
      redirectTo: "/classes/class-1",
    });
    const { GET } = await loadRoute();

    const response = await GET(makeRequest());

    expect(startGuestSessionMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://example.com/classes/class-1");
  });

  it("allows the fencepost request at limit minus one", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: true,
      redirectTo: "/classes/class-1",
    });
    const { GET } = await loadRoute();

    for (let index = 0; index < 5; index += 1) {
      const response = await GET(makeRequest("203.0.113.11"));
      expect(response.headers.get("location")).toBe("https://example.com/classes/class-1");
    }
  });

  it("blocks when the hourly IP limit is exceeded", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: true,
      redirectTo: "/classes/class-1",
    });
    const { GET } = await loadRoute();

    for (let index = 0; index < 5; index += 1) {
      await GET(makeRequest("203.0.113.12"));
    }

    const response = await GET(makeRequest("203.0.113.12"));

    expect(startGuestSessionMock).toHaveBeenCalledTimes(5);
    expect(response.headers.get("location")).toBe(
      "https://example.com/?error=too-many-guest-sessions",
    );
  });

  it("redirects to guest unavailable when sandbox provisioning fails", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      error: "Guest mode is unavailable.",
    });
    const { GET } = await loadRoute();

    const response = await GET(makeRequest("203.0.113.13"));

    expect(response.headers.get("location")).toBe("https://example.com/?error=guest-unavailable");
  });
});
