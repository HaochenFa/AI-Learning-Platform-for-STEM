import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";

describe("ForgotPasswordPage", () => {
  it("renders the reset request form without signup-only filler copy", async () => {
    const html = renderToStaticMarkup(await ForgotPasswordPage({}));

    expect(html).toContain("Reset your password");
    expect(html).toContain("Send reset link");
    expect(html).not.toContain("Email-only authentication");
    expect(html).not.toContain("Separate teacher and student roles");
  });

  it("shows the password reset resend state after the first send", async () => {
    const html = renderToStaticMarkup(
      await ForgotPasswordPage({
        searchParams: Promise.resolve({
          email: "student@example.com",
          resend: "reset",
          resend_started_at: "1710000000000",
          sent: "1",
        }),
      }),
    );

    expect(html).toContain("If an account exists for that email");
    expect(html).toContain("Resend reset email");
    expect(html).not.toContain("Send reset link");
  });
});
