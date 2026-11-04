import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { api, json } from "@/test/api";
import { myProfile } from "@/test/fixtures";
import { renderSignedIn } from "@/test/render";
import { SecuritySettings } from "./security-settings";

function session(id: string, isCurrent: boolean) {
  return {
    id,
    created_at: "2026-10-12T08:00:00.000000Z",
    last_used_at: "2026-10-19T09:30:00.000000Z",
    expires_at: "2026-11-18T09:00:00.000000Z",
    is_current: isCurrent,
  };
}

const current = session("22222222-2222-4222-8222-222222222222", true);
const other = session("33333333-3333-4333-8333-333333333333", false);

describe("SecuritySettings", () => {
  it("loads the sessions again after a password change, as the backend has ended the others", async () => {
    api.on("GET", "/auth/sessions", json(200, [current, other]), json(200, [current]));
    api.on("POST", "/auth/change-password", json(200, { message: "Password has been changed." }));
    api.on("GET", "/users/me", json(200, myProfile()));
    await renderSignedIn(<SecuritySettings />);
    const user = userEvent.setup();
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);

    await user.type(screen.getByLabelText("Current password"), "current password 1");
    await user.type(screen.getByLabelText("New password"), "a new password 2");
    await user.type(screen.getByLabelText("Confirm new password"), "a new password 2");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("You aren't signed in anywhere else.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await waitFor(() => expect(api.calls("GET", "/auth/sessions")).toHaveLength(2));
    expect(api.calls("DELETE")).toEqual([]);
    expect(api.calls("POST", "/auth/sessions/revoke-others")).toEqual([]);
  });

  it("loads the sessions again after two-factor login is turned off, as the backend has ended the others", async () => {
    api.on("GET", "/auth/sessions", json(200, [current, other]), json(200, [current]));
    api.on("GET", "/users/me", json(200, myProfile({ two_factor_enabled: true, recovery_codes_left: 10 })));
    api.on("POST", "/auth/two-factor/disable", json(200, { message: "Two-factor login is off." }));
    await renderSignedIn(<SecuritySettings />);
    const user = userEvent.setup();
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Turn off two-factor login" }));
    const form = within(screen.getByRole("form", { name: "Turn off two-factor login" }));
    await user.type(form.getByLabelText("Password"), "current password 1");
    await user.type(form.getByLabelText("Code"), "123456");
    await user.click(form.getByRole("checkbox", { name: "I understand that logging in will need only my password." }));
    await user.click(form.getByRole("button", { name: "Turn off two-factor login" }));

    expect(await screen.findByText("You aren't signed in anywhere else.")).toBeInTheDocument();
    expect(screen.getByText("Two-factor login is off. Your other sessions have been signed out.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await waitFor(() => expect(api.calls("GET", "/auth/sessions")).toHaveLength(2));
    expect(api.calls("POST", "/auth/sessions/revoke-others")).toEqual([]);
  });
});
