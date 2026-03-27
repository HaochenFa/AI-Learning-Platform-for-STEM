/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PasswordInput } from "@/components/ui/password-input";

describe("PasswordInput", () => {
  it("renders masked by default", () => {
    render(
      <div>
        <label htmlFor="password">Password</label>
        <PasswordInput id="password" name="password" />
      </div>,
    );

    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("toggles visibility without losing the typed value", async () => {
    const user = userEvent.setup();

    render(
      <div>
        <label htmlFor="password">Password</label>
        <PasswordInput id="password" name="password" />
      </div>,
    );

    const input = screen.getByLabelText("Password");
    await user.type(input, "Classroom123");

    expect(input).toHaveValue("Classroom123");

    await user.click(screen.getByRole("button", { name: "Show password" }));

    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Password")).toHaveValue("Classroom123");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Hide password" }));

    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Password")).toHaveValue("Classroom123");
  });
});
