import { beforeEach, describe, expect, it, vi } from "vitest";

describe("/api/materials/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PYTHON_BACKEND_URL;
    delete process.env.PYTHON_BACKEND_API_KEY;
  });

  it("returns 500 when python backend URL is missing", async () => {
    const { POST } = await import("@/app/api/materials/process/route");

    const response = await POST(
      new Request("http://localhost/api/materials/process", { method: "POST" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe("PYTHON_BACKEND_URL is not configured.");
  });

  it("accepts GET requests and proxies to python backend", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            processed: 3,
            succeeded: 2,
            failed: 1,
            retried: 0,
            errors: ["one failed"],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { GET } = await import("@/app/api/materials/process/route");
    const response = await GET(new Request("http://localhost/api/materials/process", { method: "GET" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.processed).toBe(3);
    expect(payload.failures).toEqual(["one failed"]);
    expect(payload.succeeded).toBe(2);
  });

  it("forwards python backend errors", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error: { message: "python failed" } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { POST } = await import("@/app/api/materials/process/route");
    const response = await POST(new Request("http://localhost/api/materials/process", { method: "POST" }));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toBe("python failed");
  });
});
