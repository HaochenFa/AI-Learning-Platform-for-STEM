import { describe, expect, it } from "vitest";
import { assertGuestSafeSignedUrl, isGuestSafeStoragePath } from "./storage";

describe("isGuestSafeStoragePath", () => {
  it("allows sandbox-scoped guest storage paths", () => {
    expect(
      isGuestSafeStoragePath("classes/class-1/sandboxes/sandbox-1/notes.pdf", "sandbox-1"),
    ).toBe(true);
  });

  it("allows guest seed assets", () => {
    expect(isGuestSafeStoragePath("guest-seed/materials/intro.pdf", "sandbox-1")).toBe(true);
  });

  it("rejects paths from a different sandbox", () => {
    expect(
      isGuestSafeStoragePath("classes/class-1/sandboxes/sandbox-2/notes.pdf", "sandbox-1"),
    ).toBe(false);
  });

  it("rejects traversal-like segments", () => {
    expect(
      isGuestSafeStoragePath(
        "classes/class-1/sandboxes/sandbox-1/../sandbox-2/notes.pdf",
        "sandbox-1",
      ),
    ).toBe(false);
  });
});

describe("assertGuestSafeSignedUrl", () => {
  it("throws for unsafe guest storage paths", () => {
    expect(() =>
      assertGuestSafeSignedUrl("classes/class-1/sandboxes/sandbox-2/notes.pdf", "sandbox-1"),
    ).toThrow("not accessible in guest mode");
  });
});
