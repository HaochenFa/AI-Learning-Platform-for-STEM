import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";

describe("ResetPasswordPage", () => {
  it("renders both password reveal toggles", async () => {
    const html = renderToStaticMarkup(await ResetPasswordPage({}));

    expect(html).toContain("Choose a new password");
    expect(html).toContain("Save new password");
    expect((html.match(/Show password/g) ?? []).length).toBe(2);
  });

  it("shows the recovery confirmation notice when recovery=1", async () => {
    const html = renderToStaticMarkup(
      await ResetPasswordPage({ searchParams: Promise.resolve({ recovery: "1" }) }),
    );

    expect(html).toContain("Your reset link is confirmed");
  });
});
