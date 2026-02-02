import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateJoinCode(length = 6) {
  let code = "";

  for (let i = 0; i < length; i += 1) {
    const index = crypto.randomInt(0, ALPHABET.length);
    code += ALPHABET[index];
  }

  return code;
}
