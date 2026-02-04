import { renderToStaticMarkup } from "react-dom/server";
import LoginPage from "@/app/(auth)/login/page";

describe("LoginPage", () => {
  it("renders the login form", () => {
    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain("Welcome back");
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).toContain("Sign in");
  });

  it("shows verify notice when verify=1", () => {
    const html = renderToStaticMarkup(
      <LoginPage searchParams={{ verify: "1" }} />
    );

    expect(html).toContain("Check your email to verify your account");
  });

  it("shows error message when provided", () => {
    const html = renderToStaticMarkup(
      <LoginPage searchParams={{ error: "Invalid login" }} />
    );

    expect(html).toContain("Invalid login");
  });
});
