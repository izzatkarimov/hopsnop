import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isUsername,
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
