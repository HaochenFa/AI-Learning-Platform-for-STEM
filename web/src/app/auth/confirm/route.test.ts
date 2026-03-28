import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const supabaseAuth = {
  verifyOtp: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: supabaseAuth,
  }),
}));

describe("/auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects verified email links to login success state", async () => {
    supabaseAuth.verifyOtp.mockResolvedValueOnce({ error: null });

    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest("http://localhost/auth/confirm?token_hash=abc123&type=email"),
    );

    expect(response.headers.get("location")).toBe("http://localhost/login?confirmed=1");
    expect(supabaseAuth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "abc123",
      type: "email",
    });
  });

  it("redirects verified recovery links to the password reset screen", async () => {
    supabaseAuth.verifyOtp.mockResolvedValueOnce({ error: null });

    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest("http://localhost/auth/confirm?token_hash=reset123&type=recovery"),
    );

    expect(response.headers.get("location")).toBe("http://localhost/reset-password?recovery=1");
  });

  it("returns users to forgot password when the recovery link is invalid", async () => {
    supabaseAuth.verifyOtp.mockResolvedValueOnce({ error: { message: "OTP expired" } });

    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest("http://localhost/auth/confirm?token_hash=bad&type=recovery"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/forgot-password?error=Your%20password%20reset%20link%20is%20invalid%20or%20has%20expired.%20Request%20a%20new%20reset%20email.&resend=reset",
    );
  });

  it("returns users to register when the confirmation link is invalid", async () => {
    supabaseAuth.verifyOtp.mockResolvedValueOnce({ error: { message: "OTP expired" } });

    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest("http://localhost/auth/confirm?token_hash=bad&type=email"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/register?error=Invalid%20or%20expired%20link.%20Request%20a%20new%20email%20and%20try%20again.&resend=confirmation",
    );
  });

  it("forwards the email to register when a confirmation link with email param is invalid", async () => {
    supabaseAuth.verifyOtp.mockResolvedValueOnce({ error: { message: "OTP expired" } });

    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/auth/confirm?token_hash=bad&type=email&email=user%40example.com",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/register?email=user%40example.com&error=Invalid%20or%20expired%20link.%20Request%20a%20new%20email%20and%20try%20again.&resend=confirmation",
    );
  });
});
