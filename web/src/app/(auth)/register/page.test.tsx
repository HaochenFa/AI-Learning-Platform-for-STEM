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

  it("shows only the sign-up form when the resend state has no email", async () => {
    const html = renderToStaticMarkup(
      await RegisterPage({
        searchParams: Promise.resolve({
          resend: "confirmation",
          error: "Invalid or expired link. Request a new email and try again.",
        }),
      }),
    );

    // sign-up form is visible so the user can re-register
    expect(html).toContain("Create account");
    expect(html).toContain("Account type");

    // resend panel is absent — there is no email address to resend to
    expect(html).not.toContain("Resend confirmation email");
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

    // resend button is present
    expect(html).toContain("Resend confirmation email");

    // email is pre-filled
    expect(html).toContain("teacher@example.com");

    // full registration form remains so the user can correct typos or role
    expect(html).toContain("Create account");
    expect(html).toContain("Account type");

    // correction guidance is shown (email only — role cannot be corrected via re-signup)
    expect(html).toContain("If your email address is wrong");
  });
});
