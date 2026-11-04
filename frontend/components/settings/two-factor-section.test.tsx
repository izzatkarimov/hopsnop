import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MyProfileResponse } from "@/lib/profiles";
import { api, deferred, json } from "@/test/api";
import type { Reply } from "@/test/api";
import { RECOVERY_CODES, TWO_FACTOR_SETUP, myProfile } from "@/test/fixtures";
import { authState, renderSignedIn } from "@/test/render";
import { TwoFactorSection } from "./two-factor-section";

const PASSWORD = "my password 123";
const ON: Partial<MyProfileResponse> = { two_factor_enabled: true, recovery_codes_left: 10 };
const GROUPED_SECRET = "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP";
const SESSIONS_ENDED = "Your other sessions have been signed out.";

async function setup(...profiles: Reply[]) {
  api.on("GET", "/users/me", ...(profiles.length ? profiles : [json(200, myProfile())]));
  const onChanged = vi.fn();
  await renderSignedIn(<TwoFactorSection onChanged={onChanged} />);
  return { user: userEvent.setup(), onChanged };
}

async function setupWith(fields: Partial<MyProfileResponse>) {
  const result = await setup(json(200, myProfile(fields)));
  await screen.findByText(isStatusLine);
  return result;
}

function isStatusLine(_: string, element: Element | null) {
  return element?.tagName === "P" && /^Two-factor login is (on|off)\.$/.test(element.textContent ?? "");
}

function statusLine() {
  return screen.getByText(isStatusLine);
}

function sectionHeading() {
  return screen.getByRole("heading", { level: 2, name: "Two-factor login" });
}

function noticeOf(text: string) {
  return screen.getByText(text);
}

const requests = (path: string) => api.calls("POST", `/auth/two-factor/${path}`);

describe("TwoFactorSection: status", () => {
  it("shows that it's off, with a way to turn it on", async () => {
    await setupWith({});

    expect(statusLine()).toHaveTextContent("Two-factor login is off.");
    expect(screen.getByRole("button", { name: "Turn on two-factor login" })).toBeInTheDocument();
    expect(screen.queryByText(/recovery codes? left/)).not.toBeInTheDocument();
  });

  it("shows that it's on, and how many recovery codes are left", async () => {
    await setupWith({ ...ON, recovery_codes_left: 7 });

    expect(statusLine()).toHaveTextContent("Two-factor login is on.");
    expect(screen.getByText("7 recovery codes left.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace recovery codes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off two-factor login" })).toBeInTheDocument();
    expect(screen.queryByText(/Warning:/)).not.toBeInTheDocument();
  });

  it.each([
    [3, "You have only 3 recovery codes left."],
    [1, "You have only 1 recovery code left."],
    [0, "You have no recovery codes left."],
  ])("warns, in words, when %i codes are left", async (left, words) => {
    await setupWith({ ...ON, recovery_codes_left: left });

    const warning = screen.getByText(/Warning:/).closest("p")!;
    expect(warning).toHaveTextContent(words);
    expect(warning).toHaveTextContent("Replace them, so that you can still log in if you lose your phone.");
  });

  it("doesn't warn with 4 codes left", async () => {
    await setupWith({ ...ON, recovery_codes_left: 4 });

    expect(screen.getByText("4 recovery codes left.")).toBeInTheDocument();
    expect(screen.queryByText(/Warning:/)).not.toBeInTheDocument();
  });

  it("offers to try again when the status can't be loaded", async () => {
    const { user } = await setup(json(500, { detail: "Internal server error." }), json(200, myProfile(ON)));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load your two-factor login settings. Something went wrong. Please try again.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(isStatusLine)).toHaveTextContent("Two-factor login is on.");
  });

  it("signs out when the session has ended", async () => {
    const answer = deferred();
    await setup(answer.reply);

    await act(() => answer.respond(json(401, { detail: "Not authenticated." })));

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});

async function openSetup(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Turn on two-factor login" }));
  expect(screen.getByRole("heading", { name: "Turn on two-factor login" })).toHaveFocus();
}

async function reachScan(user: ReturnType<typeof userEvent.setup>) {
  await openSetup(user);
  await user.type(screen.getByLabelText("Password"), PASSWORD);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Scan the QR code" });
  return {
    code: screen.getByLabelText("Code from the app"),
    turnOn: screen.getByRole("button", { name: "Turn on" }),
  };
}

describe("TwoFactorSection: turning it on", () => {
  it("goes from the password to the QR code to the recovery codes, and ends other sessions", async () => {
    api.on("POST", "/auth/two-factor/start", json(200, TWO_FACTOR_SETUP));
    api.on("POST", "/auth/two-factor/confirm", json(200, { recovery_codes: RECOVERY_CODES }));
    const { user, onChanged } = await setupWith({});

    const { code, turnOn } = await reachScan(user);

    expect(screen.getByRole("heading", { name: "Scan the QR code" })).toHaveFocus();
    expect(requests("start").map((call) => call.body)).toEqual([{ password: PASSWORD }]);
    const qr = screen.getByRole("img", { name: /^QR code for your authenticator app\./ });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(qr).toHaveAccessibleName(
      "QR code for your authenticator app. If you can't scan it, enter the setup key shown below it instead.",
    );
    expect(screen.getByText(GROUPED_SECRET)).toHaveAttribute("translate", "no");

    await user.click(screen.getByRole("button", { name: "Copy key" }));
    expect(await navigator.clipboard.readText()).toBe(TWO_FACTOR_SETUP.secret);

    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await user.type(code, "123456");
    await user.click(turnOn);

    expect(await screen.findByRole("heading", { name: "Save your recovery codes" })).toHaveFocus();
    // The password was kept for confirm, which needs it again.
    expect(requests("confirm").map((call) => call.body)).toEqual([{ password: PASSWORD, code: "123456" }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(noticeOf(`Two-factor login is on. ${SESSIONS_ENDED}`)).toHaveAttribute("role", "status");
    expect(statusLine()).toHaveTextContent("Two-factor login is on.");
    expect(screen.getByText("10 recovery codes left.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("JBSW");

    await user.click(screen.getByRole("checkbox", { name: "I've saved these codes" }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(sectionHeading()).toHaveFocus();
    for (const recoveryCode of RECOVERY_CODES) {
      expect(document.body.innerHTML).not.toContain(recoveryCode);
    }
    expect(screen.getByRole("button", { name: "Replace recovery codes" })).toBeInTheDocument();
    expect(api.calls("GET", "/users/me")).toHaveLength(1);
  });

  it("asks for the password before anything is sent", async () => {
    const { user } = await setupWith({});
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    const password = screen.getByLabelText("Password");
    expect(password).toHaveAccessibleDescription("Enter your password.");
    expect(password).toHaveFocus();
    expect(requests("start")).toEqual([]);
  });

  it("shows a wrong password on the field and stays on the first step", async () => {
    api.on("POST", "/auth/two-factor/start", json(400, { detail: "Current password is incorrect." }));
    const { user } = await setupWith({});
    await openSetup(user);
    const password = screen.getByLabelText("Password");
    await user.type(password, "wrong password");

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(password).toHaveAccessibleDescription("Your password is incorrect."));
    expect(password).toHaveFocus();
    expect(password).toHaveValue("wrong password");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("stays on the QR code after a wrong code, and takes the right one", async () => {
    api.on("POST", "/auth/two-factor/start", json(200, TWO_FACTOR_SETUP));
    api.on(
      "POST",
      "/auth/two-factor/confirm",
      json(400, { detail: "Invalid code." }),
      json(200, { recovery_codes: RECOVERY_CODES }),
    );
    const { user, onChanged } = await setupWith({});
    const { code, turnOn } = await reachScan(user);
    await user.type(code, "111111");

    await user.click(turnOn);

    await waitFor(() =>
      expect(code).toHaveAccessibleDescription("That code didn't work. Enter the newest code from the app."),
    );
    expect(code).toHaveFocus();
    expect(screen.getByRole("img", { name: /^QR code/ })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();

    await user.clear(code);
    await user.type(code, "222222");
    await user.click(turnOn);

    expect(await screen.findByRole("heading", { name: "Save your recovery codes" })).toBeInTheDocument();
    expect(requests("confirm").map((call) => call.body)).toEqual([
      { password: PASSWORD, code: "111111" },
      { password: PASSWORD, code: "222222" },
    ]);
  });

  it("sends nothing for a code that isn't 6 digits", async () => {
    api.on("POST", "/auth/two-factor/start", json(200, TWO_FACTOR_SETUP));
    const { user } = await setupWith({});
    const { code, turnOn } = await reachScan(user);
    await user.type(code, "ABCD-EFGH-JKMN-PQRS");

    await user.click(turnOn);

    expect(code).toHaveAccessibleDescription("Enter the 6 digits your authenticator app shows.");
    expect(requests("confirm")).toEqual([]);
  });

  it("starts again, without the old key, when the setup has expired", async () => {
    api.on("POST", "/auth/two-factor/start", json(200, TWO_FACTOR_SETUP));
    api.on("POST", "/auth/two-factor/confirm", json(400, { detail: "No two-factor setup is pending." }));
    const { user } = await setupWith({});
    const { code, turnOn } = await reachScan(user);
    await user.type(code, "123456");

    await user.click(turnOn);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Turn on two-factor login" })).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent("The setup expired. Enter your password to start again.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("JBSW");
  });

  it("shows how things stand when it was turned on elsewhere meanwhile", async () => {
    api.on("POST", "/auth/two-factor/start", json(409, { detail: "Two-factor login is already on." }));
    const { user, onChanged } = await setup(json(200, myProfile()), json(200, myProfile(ON)));
    await screen.findByText(isStatusLine);
    await openSetup(user);
    await user.type(screen.getByLabelText("Password"), PASSWORD);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(statusLine()).toHaveTextContent("Two-factor login is on."));
    expect(
      noticeOf("Two-factor login was changed elsewhere, so nothing was done here. What's shown is now up to date."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("explains a rate limit on the code, and keeps the QR code", async () => {
    api.on("POST", "/auth/two-factor/start", json(200, TWO_FACTOR_SETUP));
    api.on(
      "POST",
      "/auth/two-factor/confirm",
      json(429, { detail: "Too many requests. Try again later." }, { "Retry-After": "120" }),
    );
    const { user } = await setupWith({});
    const { code, turnOn } = await reachScan(user);
    await user.type(code, "123456");

    await user.click(turnOn);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Please wait about 2 minutes before trying again.",
    );
    expect(screen.getByRole("img", { name: /^QR code/ })).toBeInTheDocument();
    expect(code).toHaveValue("123456");
  });

  it.each([
    ["Cancel", async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Cancel" }))],
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
  ])("drops the key and the password on %s, and starts afresh next time", async (_, leave) => {
    api.on("POST", "/auth/two-factor/start", json(200, TWO_FACTOR_SETUP));
    const { user } = await setupWith({});
    const { code } = await reachScan(user);
    await user.type(code, "123456");

    await leave(user);

    expect(screen.getByRole("button", { name: "Turn on two-factor login" })).toHaveFocus();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("JBSW");
    expect(requests("confirm")).toEqual([]);

    await openSetup(user);
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("signs out when the session has ended", async () => {
    api.on("POST", "/auth/two-factor/start", json(401, { detail: "Not authenticated." }));
    const { user } = await setupWith({});
    await openSetup(user);
    await user.type(screen.getByLabelText("Password"), PASSWORD);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });

  it("sends one confirmation at a time", async () => {
    const answer = deferred();
    api.on("POST", "/auth/two-factor/start", json(200, TWO_FACTOR_SETUP));
    api.on("POST", "/auth/two-factor/confirm", answer.reply);
    const { user } = await setupWith({});
    const { code, turnOn } = await reachScan(user);
    await user.type(code, "123456");

    await user.click(turnOn);
    fireEvent.submit(turnOn.closest("form")!);

    expect(requests("confirm")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Turning on…" })).toBeDisabled();

    await act(() => answer.respond(json(200, { recovery_codes: RECOVERY_CODES })));
    expect(await screen.findByRole("heading", { name: "Save your recovery codes" })).toBeInTheDocument();
    expect(requests("confirm")).toHaveLength(1);
  });
});

async function openReplace(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Replace recovery codes" }));
  expect(screen.getByRole("heading", { name: "Replace recovery codes" })).toHaveFocus();
  return {
    password: screen.getByLabelText("Password"),
    code: screen.getByLabelText("Code from your authenticator app"),
    submit: screen.getByRole("button", { name: "Replace codes" }),
  };
}

describe("TwoFactorSection: replacing recovery codes", () => {
  it("shows the new codes once, ends other sessions, and clears the warning", async () => {
    api.on("POST", "/auth/two-factor/recovery-codes", json(200, { recovery_codes: RECOVERY_CODES }));
    const { user, onChanged } = await setupWith({ ...ON, recovery_codes_left: 2 });
    expect(screen.getByText(/Warning:/)).toBeInTheDocument();
    const { password, code, submit } = await openReplace(user);
    expect(code).toHaveAttribute("inputmode", "numeric");

    await user.type(password, PASSWORD);
    await user.type(code, "123456");
    await user.click(submit);

    expect(await screen.findByRole("heading", { name: "Save your recovery codes" })).toHaveFocus();
    expect(requests("recovery-codes").map((call) => call.body)).toEqual([{ password: PASSWORD, code: "123456" }]);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(RECOVERY_CODES);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(
      noticeOf(`Your recovery codes have been replaced, and the old ones no longer work. ${SESSIONS_ENDED}`),
    ).toBeInTheDocument();
    expect(screen.getByText("10 recovery codes left.")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "I've saved these codes" }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByText(/Warning:/)).not.toBeInTheDocument();
    for (const recoveryCode of RECOVERY_CODES) {
      expect(document.body.innerHTML).not.toContain(recoveryCode);
    }
    await openReplace(user);
    expect(screen.queryAllByRole("listitem")).toEqual([]);
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it.each([
    ["a wrong password", { detail: "Current password is incorrect." }, "Password", "Your password is incorrect."],
    [
      "a wrong code",
      { detail: "Invalid code." },
      "Code from your authenticator app",
      "That code didn't work. Check it and try again.",
    ],
  ])("shows %s on its field and keeps the form", async (_, body, label, message) => {
    api.on("POST", "/auth/two-factor/recovery-codes", json(400, body));
    const { user, onChanged } = await setupWith(ON);
    const { password, code, submit } = await openReplace(user);
    await user.type(password, PASSWORD);
    await user.type(code, "123456");

    await user.click(submit);

    const field = screen.getByLabelText(label);
    await waitFor(() => expect(field).toHaveAccessibleDescription(message));
    expect(field).toHaveFocus();
    expect(password).toHaveValue(PASSWORD);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("takes only a code from the app, not a recovery code", async () => {
    const { user } = await setupWith(ON);
    const { password, code, submit } = await openReplace(user);
    await user.type(password, PASSWORD);
    await user.type(code, "ABCD-EFGH-JKMN-PQRS");

    await user.click(submit);

    expect(code).toHaveAccessibleDescription("Enter the 6 digits your authenticator app shows.");
    expect(requests("recovery-codes")).toEqual([]);
  });

  it("shows how things stand when it was turned off elsewhere meanwhile", async () => {
    api.on("POST", "/auth/two-factor/recovery-codes", json(400, { detail: "Two-factor login is off." }));
    const { user } = await setup(json(200, myProfile(ON)), json(200, myProfile()));
    await screen.findByText(isStatusLine);
    const { password, code, submit } = await openReplace(user);
    await user.type(password, PASSWORD);
    await user.type(code, "123456");

    await user.click(submit);

    await waitFor(() => expect(statusLine()).toHaveTextContent("Two-factor login is off."));
    expect(sectionHeading()).toHaveFocus();
  });
});

async function openDisable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Turn off two-factor login" }));
  expect(screen.getByRole("heading", { name: "Turn off two-factor login" })).toHaveFocus();
  return {
    password: screen.getByLabelText("Password"),
    code: screen.getByLabelText("Code"),
    understood: screen.getByRole("checkbox", {
      name: "I understand that logging in will need only my password.",
    }),
    submit: screen.getByRole("button", { name: "Turn off two-factor login" }),
  };
}

describe("TwoFactorSection: turning it off", () => {
  it.each([
    ["a code from the app", "123456"],
    ["a recovery code, sent as typed", "abcd-efgh-jkmn-pqrs"],
  ])("turns it off with %s, and ends other sessions", async (_, typed) => {
    api.on("POST", "/auth/two-factor/disable", json(200, { message: "Two-factor login is off." }));
    const { user, onChanged } = await setupWith(ON);
    const { password, code, understood, submit } = await openDisable(user);
    expect(code).not.toHaveAttribute("inputmode");
    expect(code).toHaveAccessibleDescription("From your authenticator app, or one of your recovery codes.");

    await user.type(password, PASSWORD);
    await user.type(code, typed);
    await user.click(understood);
    await user.click(submit);

    await waitFor(() => expect(statusLine()).toHaveTextContent("Two-factor login is off."));
    expect(requests("disable").map((call) => call.body)).toEqual([{ password: PASSWORD, code: typed }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(noticeOf(`Two-factor login is off. ${SESSIONS_ENDED}`)).toBeInTheDocument();
    expect(sectionHeading()).toHaveFocus();
    expect(screen.queryByText(/recovery codes? left/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on two-factor login" })).toBeInTheDocument();
  });

  it("asks for the confirmation before anything is sent", async () => {
    const { user } = await setupWith(ON);
    const { password, code, understood, submit } = await openDisable(user);
    await user.type(password, PASSWORD);
    await user.type(code, "123456");

    await user.click(submit);

    expect(understood).toHaveFocus();
    expect(understood).toHaveAccessibleDescription("Confirm that you want to turn off two-factor login.");
    expect(requests("disable")).toEqual([]);
  });

  it("shows a wrong code on its field and stays on", async () => {
    api.on("POST", "/auth/two-factor/disable", json(400, { detail: "Invalid code." }));
    const { user, onChanged } = await setupWith(ON);
    const { password, code, understood, submit } = await openDisable(user);
    await user.type(password, PASSWORD);
    await user.type(code, "ABCD-EFGH-JKMN-PQRS");
    await user.click(understood);

    await user.click(submit);

    await waitFor(() =>
      expect(code).toHaveAccessibleDescription("That code didn't work. Check it and try again."),
    );
    expect(code).toHaveFocus();
    expect(code).toHaveValue("ABCD-EFGH-JKMN-PQRS");
    expect(statusLine()).toHaveTextContent("Two-factor login is on.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("closes on Escape, and opens again with nothing filled in", async () => {
    const { user } = await setupWith(ON);
    const { password } = await openDisable(user);
    await user.type(password, PASSWORD);

    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Turn off two-factor login" })).toHaveFocus();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    const reopened = await openDisable(user);
    expect(reopened.password).toHaveValue("");
    expect(reopened.understood).not.toBeChecked();
    expect(requests("disable")).toEqual([]);
  });

  it("signs out when the session has ended", async () => {
    api.on("POST", "/auth/two-factor/disable", json(401, { detail: "Not authenticated." }));
    const { user } = await setupWith(ON);
    const { password, code, understood, submit } = await openDisable(user);
    await user.type(password, PASSWORD);
    await user.type(code, "123456");
    await user.click(understood);

    await user.click(submit);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});
