/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthResendForm from "@/components/auth/AuthResendForm";

describe("AuthResendForm", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the resend button disabled until the cooldown finishes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T00:00:00Z"));

    render(
      <AuthResendForm
        action={vi.fn()}
        authReturnTo="/register"
        defaultEmail="teacher@example.com"
        pendingLabel="Resending confirmation email..."
        resendStartedAt={String(Date.now())}
        submitLabel="Resend confirmation email"
        timerReadyCopy="You can request a new email now."
        timerWaitingCopy={(seconds) => `You can resend another email in ${seconds} seconds.`}
      />,
    );

    const button = screen.getByRole("button", { name: "Resend confirmation email" });
    expect(button).toBeDisabled();
    expect(screen.getByText("You can resend another email in 60 seconds.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(button).toBeEnabled();
    expect(screen.getByText("You can request a new email now.")).toBeInTheDocument();
  });

  it("submits the edited email address when resend is available", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => undefined);

    render(
      <AuthResendForm
        action={action}
        authReturnTo="/forgot-password"
        defaultEmail="student@example.com"
        pendingLabel="Resending reset email..."
        submitLabel="Resend reset email"
        timerReadyCopy="You can request a new email now."
        timerWaitingCopy={(seconds) => `You can resend another email in ${seconds} seconds.`}
      />,
    );

    const emailInput = screen.getByLabelText("Email");
    await user.clear(emailInput);
    await user.type(emailInput, "updated@example.com");
    await user.click(screen.getByRole("button", { name: "Resend reset email" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0][0] as FormData;

    expect(formData.get("email")).toBe("updated@example.com");
    expect(formData.get("auth_return_to")).toBe("/forgot-password");
  });

  it("locks the email for confirmation resend while still submitting it", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => undefined);

    render(
      <AuthResendForm
        action={action}
        authReturnTo="/register?account_type=teacher"
        defaultEmail="teacher@example.com"
        emailMode="locked"
        pendingLabel="Resending confirmation email..."
        submitLabel="Resend confirmation email"
        timerReadyCopy="You can request a new email now."
        timerWaitingCopy={(seconds) => `You can resend another email in ${seconds} seconds.`}
      />,
    );

    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    expect(screen.getByText("teacher@example.com")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resend confirmation email" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0][0] as FormData;

    expect(formData.get("email")).toBe("teacher@example.com");
    expect(formData.get("auth_return_to")).toBe("/register?account_type=teacher");
  });
});
