import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RegisterPage from "@/app/(auth)/register/page";

describe("RegisterPage", () => {
  it("renders the registration form", async () => {
    const html = renderToStaticMarkup(await RegisterPage({}));

    expect(html).toContain("Create an account");
    expect(html).toContain("Account type");
    expect(html).toContain("Account type can");
    expect(html).toContain("Teacher");
    expect(html).toContain("Student");
    expect(html).toContain("Teacher accounts create classes");
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).toContain("Show password");
    expect(html).toContain("Create account");
    expect(html).not.toContain("Email-only authentication");
    expect(html).not.toContain("Separate teacher and student roles");
  });

  it("shows error message when provided", async () => {
    const html = renderToStaticMarkup(
      await RegisterPage({
        searchParams: Promise.resolve({ error: "Email already used" }),
      }),
    );

    expect(html).toContain("Email already used");
  });
});
