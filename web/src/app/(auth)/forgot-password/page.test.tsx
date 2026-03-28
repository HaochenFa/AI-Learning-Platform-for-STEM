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
});
