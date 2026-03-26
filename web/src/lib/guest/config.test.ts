import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function loadConfig(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return await import("./config");
}

describe("isGuestModeEnabled", () => {
  it("accepts common truthy env values", async () => {
    for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
      const { isGuestModeEnabled } = await loadConfig({
        NEXT_PUBLIC_GUEST_MODE_ENABLED: value,
      });
      expect(isGuestModeEnabled()).toBe(true);
    }
  });

  it("rejects falsy and unknown env values", async () => {
    for (const value of [undefined, "0", "false", "off", "maybe"]) {
      const { isGuestModeEnabled } = await loadConfig({
        NEXT_PUBLIC_GUEST_MODE_ENABLED: value,
      });
      expect(isGuestModeEnabled()).toBe(false);
    }
  });
});
