import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RegisterPage from "@/app/(auth)/register/page";

describe("RegisterPage", () => {
  it("renders the registration form", async () => {
    const html = renderToStaticMarkup(await RegisterPage({}));

    expect(html).toContain("Create an account");
    expect(html).toContain("Account type");
    expect(html).toContain("Choose the role that matches");
    expect(html).toContain("Teacher");
    expect(html).toContain("Student");
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

  it("shows the confirmation resend state after sign up", async () => {
    const html = renderToStaticMarkup(
      await RegisterPage({
        searchParams: Promise.resolve({
          account_type: "teacher",
          email: "teacher@example.com",
          resend: "confirmation",
          resend_started_at: "1710000000000",
          verify: "1",
        }),
      }),
    );

    // success alert remains
    expect(html).toContain("Check your email to verify your account");

    // resend button replaces the registration button
    expect(html).toContain("Resend confirmation email");
    expect(html).not.toContain("Create account");

    // locked email is displayed
    expect(html).toContain("teacher@example.com");

    // full registration form is gone
    expect(html).not.toContain("Account type");

    // extra resend card is gone
    expect(html).not.toContain("If the email address or role is wrong");
  });
});
