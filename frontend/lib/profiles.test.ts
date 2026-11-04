import { describe, expect, it } from "vitest";
import { api, json } from "@/test/api";
import { myProfile } from "@/test/fixtures";
import { getTwoFactorStatus } from "./profiles";

describe("getTwoFactorStatus", () => {
  it("keeps the two-factor fields and leaves the rest of the private profile behind", async () => {
    api.on("GET", "/users/me", json(200, myProfile({ two_factor_enabled: true, recovery_codes_left: 7 })));

    await expect(getTwoFactorStatus()).resolves.toEqual({ enabled: true, recoveryCodesLeft: 7 });
  });

  it.each([
    ["no two-factor flag", myProfile({ two_factor_enabled: undefined })],
    ["a count that isn't a whole number", myProfile({ recovery_codes_left: 1.5 })],
    ["a negative count", myProfile({ recovery_codes_left: -1 })],
  ])("refuses a profile with %s", async (_, body) => {
    api.on("GET", "/users/me", json(200, body));

    await expect(getTwoFactorStatus()).rejects.toMatchObject({ kind: "server" });
  });
});
