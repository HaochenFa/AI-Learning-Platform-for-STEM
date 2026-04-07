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

function makeRequest(ip?: string, method = "POST") {
  return new Request("https://example.com/guest/enter", {
    method,
    headers: ip
      ? {
          "x-forwarded-for": ip,
        }
      : undefined,
  });
}

describe("POST /guest/enter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a guest session when sandbox provisioning succeeds", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: true,
      redirectTo: "/classes/class-1",
    });
    const { POST } = await loadRoute();

    const response = await POST(makeRequest());

    expect(startGuestSessionMock).toHaveBeenCalledTimes(1);
    expect(startGuestSessionMock).toHaveBeenCalledWith();
    expect(response.headers.get("location")).toBe("https://example.com/classes/class-1");
  });

  it("redirects to the new-session capacity warning when creation quota is exhausted", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      code: "too-many-new-sessions",
      error: "too-many-new-sessions",
    });
    const { POST } = await loadRoute();

    const response = await POST(makeRequest("203.0.113.12"));

    expect(response.headers.get("location")).toBe(
      "https://example.com/?error=too-many-new-sessions",
    );
  });

  it("redirects to the active-session capacity warning when the global slot cap is exhausted", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      code: "too-many-active-sessions",
      error: "too-many-active-sessions",
    });
    const { POST } = await loadRoute();

    const response = await POST(makeRequest("203.0.113.12"));

    expect(response.headers.get("location")).toBe(
      "https://example.com/?error=too-many-active-sessions",
    );
  });

  it("redirects to guest unavailable when provisioning returns a non-quota error", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      code: "guest-auth-unavailable",
      error: "Anonymous auth disabled",
    });
    const { POST } = await loadRoute();

    const response = await POST(makeRequest("203.0.113.12"));

    expect(response.headers.get("location")).toBe("https://example.com/?error=guest-unavailable");
  });

  it("redirects to guest unavailable when sandbox provisioning fails", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: "Guest mode is unavailable.",
    });
    const { POST } = await loadRoute();

    const response = await POST(makeRequest("203.0.113.13"));

    expect(response.headers.get("location")).toBe("https://example.com/?error=guest-unavailable");
  });

  it("redirects to guest session check failed when verification cannot complete", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      code: "guest-session-check-failed",
      error: "We couldn't verify your guest session right now. Please try again.",
    });
    const { POST } = await loadRoute();

    const response = await POST(makeRequest("203.0.113.14"));

    expect(response.headers.get("location")).toBe(
      "https://example.com/?error=guest-session-check-failed",
    );
  });

  it("creates a guest session without relying on request IP headers", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: true,
      redirectTo: "/classes/class-1",
    });
    const { POST } = await loadRoute();

    const response = await POST(makeRequest(undefined));

    expect(startGuestSessionMock).toHaveBeenCalledWith();
    expect(response.headers.get("location")).toBe("https://example.com/classes/class-1");
  });
});

describe("GET /guest/enter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects home without creating a guest session", async () => {
    const { GET } = await loadRoute();

    const response = await GET(makeRequest("203.0.113.10", "GET"));

    expect(startGuestSessionMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://example.com/");
  });
});
