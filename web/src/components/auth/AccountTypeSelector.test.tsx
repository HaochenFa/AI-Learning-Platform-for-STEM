/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import AccountTypeSelector from "@/components/auth/AccountTypeSelector";

describe("AccountTypeSelector", () => {
  it("shows the default teacher selection clearly", () => {
    render(<AccountTypeSelector defaultValue="teacher" />);

    expect(screen.getByLabelText("Teacher")).toBeChecked();
    expect(
      screen.getByText("Teacher accounts create classes, curate AI outputs, and assign learning work."),
    ).toBeInTheDocument();
  });

  it("updates the helper copy when the student role is selected", async () => {
    const user = userEvent.setup();

    render(<AccountTypeSelector defaultValue="teacher" />);

    await user.click(screen.getByLabelText("Student"));

    expect(screen.getByLabelText("Student")).toBeChecked();
    expect(
      screen.getByText("Student accounts join teacher-led classes and work through assigned activities."),
    ).toBeInTheDocument();
  });
});
