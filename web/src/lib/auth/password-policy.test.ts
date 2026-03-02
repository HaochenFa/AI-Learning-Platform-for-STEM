import { describe, expect, it } from "vitest";
import {
  PASSWORD_POLICY_ERROR_MESSAGE,
  validatePasswordPolicy,
} from "@/lib/auth/password-policy";

describe("password policy", () => {
  it("accepts passwords with at least 8 chars including letters and digits", () => {
    expect(validatePasswordPolicy("Abcdef12")).toEqual({ ok: true });
    expect(validatePasswordPolicy("abc12345")).toEqual({ ok: true });
    expect(validatePasswordPolicy("A1!aaaaa")).toEqual({ ok: true });
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(validatePasswordPolicy("Abc1234")).toEqual({
      ok: false,
      message: PASSWORD_POLICY_ERROR_MESSAGE,
    });
  });

  it("rejects passwords without letters", () => {
    expect(validatePasswordPolicy("12345678")).toEqual({
      ok: false,
      message: PASSWORD_POLICY_ERROR_MESSAGE,
    });
  });

  it("rejects passwords without digits", () => {
    expect(validatePasswordPolicy("abcdefgh")).toEqual({
      ok: false,
      message: PASSWORD_POLICY_ERROR_MESSAGE,
    });
  });
});
