import { renderToStaticMarkup } from "react-dom/server";
import RegisterPage from "@/app/(auth)/register/page";

describe("RegisterPage", () => {
  it("renders the registration form", () => {
    const html = renderToStaticMarkup(<RegisterPage />);

    expect(html).toContain("Create an account");
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).toContain("Create account");
  });

  it("shows error message when provided", () => {
    const html = renderToStaticMarkup(
      <RegisterPage searchParams={{ error: "Email already used" }} />
    );

    expect(html).toContain("Email already used");
  });
});
