import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LoginPage from "@/app/(auth)/login/page";

describe("LoginPage", () => {
  it("renders the login form", async () => {
    const html = renderToStaticMarkup(await LoginPage({}));

    expect(html).toContain("Welcome back");
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).toContain("Sign in");
  });

  it("shows verify notice when verify=1", async () => {
    const html = renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({ verify: "1" }) }),
    );

    expect(html).toContain("Check your email to verify your account");
  });

  it("shows confirmation success when confirmed=1", async () => {
    const html = renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({ confirmed: "1" }) }),
    );

    expect(html).toContain("Your email has been verified");
  });

  it("shows password reset success when reset=1", async () => {
    const html = renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({ reset: "1" }) }),
    );

    expect(html).toContain("Your password has been reset");
  });

  it("shows error message when provided", async () => {
    const html = renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ error: "Invalid login" }),
      }),
    );

    expect(html).toContain("Invalid login");
  });
});
