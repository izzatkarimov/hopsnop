import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  TWO_FACTOR_CODE_MAX_LENGTH,
  isUsername,
  validateAppCode,
  validateAppOrRecoveryCode,
  validateNewPassword,
} from "./auth-validation";

describe("validateNewPassword", () => {
  it("follows the backend's policy: 12 to 128 characters and nothing else", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it("asks for a password when there is none", () => {
    expect(validateNewPassword("")).toBe("Choose a password.");
  });

  it("refuses one character too few, and accepts the minimum", () => {
    expect(validateNewPassword("a".repeat(11))).toBe("Use at least 12 characters.");
    expect(validateNewPassword("a".repeat(12))).toBeNull();
  });

  it("accepts the maximum, and refuses one character more", () => {
    expect(validateNewPassword("a".repeat(128))).toBeNull();
    expect(validateNewPassword("a".repeat(129))).toBe("Use at most 128 characters.");
  });

  it("asks for no particular kinds of characters", () => {
    expect(validateNewPassword("correct horse battery staple")).toBeNull();
    expect(validateNewPassword("123456789012")).toBeNull();
  });

  it("counts characters as the backend does, so an emoji is one", () => {
    // Each of these is two UTF-16 code units, but one character.
    expect(validateNewPassword("😀".repeat(12))).toBeNull();
    expect(validateNewPassword("😀".repeat(11))).toBe("Use at least 12 characters.");
  });

  it("takes the password exactly as typed: spaces count and are not trimmed", () => {
    expect(validateNewPassword(" ".repeat(12))).toBeNull();
    expect(validateNewPassword(`  ${"a".repeat(9)} `)).toBeNull();
    expect(validateNewPassword(` ${"a".repeat(9)} `)).toBe("Use at least 12 characters.");
  });
});

describe("isUsername", () => {
  it.each(["abc", "alice_92", "A".repeat(30), "___"])("accepts %s", (value) => {
    expect(isUsername(value)).toBe(true);
  });

  it.each(["ab", "a".repeat(31), "alice smith", "alice-92", "@alice", " alice", "élodie", ""])(
    "refuses %j",
    (value) => {
      expect(isUsername(value)).toBe(false);
    },
  );
});

describe("validateAppCode", () => {
  it.each(["123456", "123 456", "000000", "12-34-56"])("accepts %j, tidied as the backend tidies it", (value) => {
    expect(validateAppCode(value)).toBeNull();
  });

  it.each(["", "   ", "--"])("asks for a code when given %j", (value) => {
    expect(validateAppCode(value)).toBe("Enter the code from your authenticator app.");
  });

  it.each(["12345", "1234567", "12345a", "ABCD-EFGH-JKMN-PQRS", "１２３４５６"])("refuses %j", (value) => {
    expect(validateAppCode(value)).toBe("Enter the 6 digits your authenticator app shows.");
  });
});

describe("validateAppOrRecoveryCode", () => {
  it.each(["123456", "ABCD-EFGH-JKMN-PQRS", "abcd efgh jkmn pqrs", "abcdefghjkmnpqrs"])("accepts %j", (value) => {
    expect(validateAppOrRecoveryCode(value)).toBeNull();
  });

  it("asks for a code when there is none", () => {
    expect(validateAppOrRecoveryCode(" ")).toBe(
      "Enter a code from your authenticator app or a recovery code.",
    );
  });

  it.each(["12345", "ABCD-EFGH-JKMN-PQR", "ABCD-EFGH-JKMN-PQRS-T", "ABCD_EFGH_JKMN_PQRS"])("refuses %j", (value) => {
    expect(validateAppOrRecoveryCode(value)).toBe(
      "Enter the 6 digits from your app, or a recovery code like ABCD-EFGH-JKMN-PQRS.",
    );
  });

  it("refuses what the backend would refuse for its length, spaces included", () => {
    expect(TWO_FACTOR_CODE_MAX_LENGTH).toBe(32);
    const padded = "ABCD-EFGH-JKMN-PQRS".padEnd(32, " ");
    expect(validateAppOrRecoveryCode(padded)).toBeNull();
    expect(validateAppOrRecoveryCode(`${padded} `)).not.toBeNull();
  });
});
