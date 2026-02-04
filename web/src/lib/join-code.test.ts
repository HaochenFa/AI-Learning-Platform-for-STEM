import { describe, expect, it } from "vitest";
import { generateJoinCode } from "@/lib/join-code";

const ALPHABET_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;

describe("generateJoinCode", () => {
  it("generates a 6-character code by default", () => {
    const code = generateJoinCode();
    expect(code).toHaveLength(6);
  });

  it("generates codes with the allowed alphabet", () => {
    const code = generateJoinCode(12);
    expect(code).toHaveLength(12);
    expect(ALPHABET_REGEX.test(code)).toBe(true);
  });
});
