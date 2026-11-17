import { describe, expect, it } from "vitest";
import { firstName, formatTimestamp, greeting } from "./format";

describe("firstName", () => {
  it("is the first word of the display name", () => {
    expect(firstName({ displayName: "  Alice  Example ", username: "alice_92" })).toBe("Alice");
  });

  it("falls back to the username when there is no display name", () => {
    expect(firstName({ displayName: "   ", username: "alice_92" })).toBe("alice_92");
  });
});

describe("greeting", () => {
  it.each([
    [4, "evening"],
    [5, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [17, "afternoon"],
    [18, "evening"],
    [23, "evening"],
  ])("at %i:59 is good %s", (hour, part) => {
    expect(greeting("Alice", new Date(2026, 10, 17, hour, 59))).toBe(`Good ${part}, Alice`);
  });
});

describe("formatTimestamp", () => {
  it("gives the time, then the date, in this device's time zone", () => {
    const local = new Date(2026, 10, 16, 9, 41);

    expect(formatTimestamp(local.toISOString())).toBe("9:41 AM · Nov 16, 2026");
  });
});
