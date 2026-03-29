/**
 * @vitest-environment jsdom
 */

import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react"; // eslint-disable-line @typescript-eslint/no-unused-vars
import { OtpInput } from "@/components/ui/otp-input";

beforeAll(() => {
  // input-otp uses ResizeObserver internally; polyfill for jsdom test environment
  if (typeof global.ResizeObserver === "undefined") {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("OtpInput", () => {
  it("renders 6 slot containers", () => {
    const { container } = render(<OtpInput name="otp" />);
    const slots = container.querySelectorAll("[data-slot='otp-slot']");
    expect(slots.length).toBe(6);
  });

  it("passes the name prop to the underlying input", () => {
    render(<OtpInput name="verification_code" />);
    const input = document.querySelector("input[name='verification_code']");
    expect(input).not.toBeNull();
  });

  it("applies the disabled state", () => {
    render(<OtpInput name="otp" disabled />);
    const input = document.querySelector("input[data-input-otp]") as HTMLInputElement;
    expect(input?.disabled).toBe(true);
  });
});
