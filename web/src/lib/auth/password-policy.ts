export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_RULE = "letters_digits";
export const PASSWORD_POLICY_PATTERN = "^(?=.*[A-Za-z])(?=.*\\d).{8,}$";
export const PASSWORD_POLICY_TITLE =
  "Use at least 8 characters and include at least one letter and one number.";
export const PASSWORD_POLICY_HINT = "At least 8 characters and include letters and numbers.";
export const PASSWORD_POLICY_ERROR_MESSAGE =
  "Password must be at least 8 characters and include letters and numbers.";

export function validatePasswordPolicy(password: string): { ok: true } | { ok: false; message: string } {
  const hasMinLength = password.length >= PASSWORD_MIN_LENGTH;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);

  if (!hasMinLength || !hasLetter || !hasDigit) {
    return {
      ok: false,
      message: PASSWORD_POLICY_ERROR_MESSAGE,
    };
  }

  return { ok: true };
}
