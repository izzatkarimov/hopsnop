import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, deferred, json, networkError } from "@/test/api";
import { LOGIN_CHALLENGE } from "@/test/fixtures";
import { account, authState } from "@/test/render";
import { renderSignedOut, renderWithSessionCheck } from "@/test/session";
import { GuestOnly } from "./guest-only";
import { LoginForm } from "./login-form";

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => nav.params,
}));

beforeEach(() => {
  nav.params = new URLSearchParams();
});

const loginPage = (
  <GuestOnly>
    <LoginForm />
  </GuestOnly>
);

async function setup() {
  await renderSignedOut(loginPage);
  return fields();
}

function fields() {
  return {
    user: userEvent.setup(),
    identifier: screen.getByLabelText("Username or email"),
    password: screen.getByLabelText("Password"),
    submit: screen.getByRole("button", { name: "Log in" }),
  };
}

const loginRequests = () => api.calls("POST", "/auth/login");

describe("LoginForm", () => {
  it.each([
    ["nothing", "", ""],
    ["no password", "test_viewer", ""],
    ["only spaces as the username", "   ", "a password"],
  ])("asks for both fields when given %s, and sends nothing", async (_, identifier, password) => {
    const { user, submit, ...input } = await setup();
    if (identifier) await user.type(input.identifier, identifier);
    if (password) await user.type(input.password, password);

    await user.click(submit);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter your username or email and your password.",
    );
    expect(loginRequests()).toEqual([]);
  });

  it("logs in with the username trimmed and the password as typed, then moves on", async () => {
    api.on("POST", "/auth/login", json(200, account));
    const { user, identifier, password, submit } = await setup();

    await user.type(identifier, "  test_viewer  ");
    await user.type(password, " pass word ");
    await user.click(submit);

    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(loginRequests().map((call) => call.body)).toEqual([
      { identifier: "test_viewer", password: " pass word " },
    ]);
    expect(nav.router.replace).toHaveBeenCalledWith("/");
    expect(screen.getByRole("status")).toHaveTextContent("Taking you to Hopsnop…");
  });

  it.each([
    ["wrong credentials", json(401, { detail: "Invalid username/email or password." })],
    ["input no account can have", json(422, { detail: [] })],
  ])("gives one answer for %s", async (_, reply) => {
    api.on("POST", "/auth/login", reply);
    const { user, identifier, password, submit } = await setup();
    await user.type(identifier, "test_viewer");
    await user.type(password, "wrong password");

    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username, email or password.");
    expect(authState()).toBe("unauthenticated");
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("tells a user whose email address is not verified how to verify it", async () => {
    api.on("POST", "/auth/login", json(403, { detail: "Email address is not verified." }));
    const { user, identifier, password, submit } = await setup();
    await user.type(identifier, "test_viewer");
    await user.type(password, "right password");

    await user.click(submit);

    expect(await screen.findByText(/Your email address isn't verified yet\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "request a new verification link" })).toHaveAttribute(
      "href",
      "/verify-email",
    );
    expect(authState()).toBe("unauthenticated");
  });

  it.each([
    ["another refusal", json(403, { detail: "Cross-origin request rejected." }), "Something went wrong. Please try again."],
    ["a server error", json(500, { detail: "Internal server error." }), "Something went wrong. Please try again."],
    [
      "too many failed logins",
      json(429, { detail: "Too many requests. Try again later." }, { "Retry-After": "300" }),
      "Too many attempts. Please wait about 5 minutes before trying again.",
    ],
    ["no connection", networkError(), "Couldn't reach Hopsnop. Check your connection and try again."],
  ])("explains %s", async (_, reply, message) => {
    api.on("POST", "/auth/login", reply);
    const { user, identifier, password, submit } = await setup();
    await user.type(identifier, "test_viewer");
    await user.type(password, "a password");

    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(authState()).toBe("unauthenticated");
  });

  it("sends one request while logging in, however often the form is sent", async () => {
    const answer = deferred();
    api.on("POST", "/auth/login", answer.reply);
    const { user, identifier, password, submit } = await setup();
    await user.type(identifier, "test_viewer");
    await user.type(password, "a password");

    await user.click(submit);
    fireEvent.submit(submit.closest("form")!);

    expect(loginRequests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Logging in…" })).toBeDisabled();

    await act(() => answer.respond(json(200, account)));
    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(loginRequests()).toHaveLength(1);
  });

  it("is not signed out again by a session check that answers after the login", async () => {
    const check = deferred();
    api.on("POST", "/auth/login", json(200, account));
    renderWithSessionCheck(loginPage, check.reply);
    const { user, identifier, password, submit } = fields();
    expect(authState()).toBe("loading");

    await user.type(identifier, "test_viewer");
    await user.type(password, "a password");
    await user.click(submit);
    await waitFor(() => expect(authState()).toBe("authenticated"));

    // The check was asked before the login, so its answer is out of date.
    await act(() => check.respond(json(401, { detail: "Not authenticated." })));
    await act(() => new Promise((resolve) => setImmediate(resolve)));

    expect(authState()).toBe("authenticated");
  });

  it("says once, after a password reset, that the user has been logged out everywhere", async () => {
    nav.params = new URLSearchParams("password_reset=done");
    const replaceState = vi.spyOn(window.history, "replaceState");

    await renderSignedOut(loginPage);

    expect(
      screen.getByText(
        "Your password has been reset and you've been logged out on all devices. Log in with your new password.",
      ),
    ).toBeInTheDocument();
    expect(replaceState).toHaveBeenCalledWith(null, "", window.location.pathname);
  });
});

function submitTwiceAtOnce(form: HTMLFormElement) {
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("LoginForm: one login at a time", () => {
  it("sends one request when the form is sent twice in the same moment", async () => {
    const answer = deferred();
    api.on("POST", "/auth/login", answer.reply);
    const { user, identifier, password, submit } = await setup();
    await user.type(identifier, "test_viewer");
    await user.type(password, "a password");

    submitTwiceAtOnce(submit.closest("form")!);

    expect(loginRequests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Logging in…" })).toBeDisabled();

    await act(() => answer.respond(json(200, account)));
    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(loginRequests()).toHaveLength(1);
  });

  it("lets the user try again after a failed login", async () => {
    api.on(
      "POST",
      "/auth/login",
      json(401, { detail: "Invalid username/email or password." }),
      json(200, account),
    );
    const { user, identifier, password, submit } = await setup();
    await user.type(identifier, "test_viewer");
    await user.type(password, "a password");

    await user.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username, email or password.");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(loginRequests()).toHaveLength(2);
  });

  it("sends the login once the fields it asked for are given", async () => {
    api.on("POST", "/auth/login", json(200, account));
    const { user, identifier, password, submit } = await setup();

    await user.click(submit);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your username or email and your password.");
    await user.type(identifier, "test_viewer");
    await user.type(password, "a password");
    await user.click(submit);

    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(loginRequests()).toHaveLength(1);
  });
});

const { challenge: CHALLENGE } = LOGIN_CHALLENGE;
const codeRequests = () => api.calls("POST", "/auth/login/two-factor");

async function reachCodeStep() {
  api.on("POST", "/auth/login", json(202, LOGIN_CHALLENGE));
  const { user, identifier, password, submit } = await setup();
  await user.type(identifier, "test_viewer");
  await user.type(password, "right password");
  await user.click(submit);
  await screen.findByRole("heading", { name: "Enter your login code" });
  return {
    user,
    code: screen.getByLabelText("Code"),
    verify: screen.getByRole("button", { name: "Verify" }),
  };
}

function passwordStepHeading() {
  return screen.getByRole("heading", { name: "Log in to Hopsnop" });
}

describe("LoginForm: two-factor login", () => {
  it("asks for a code on the same page once the password is right, without signing in yet", async () => {
    const address = window.location.href;
    const { code } = await reachCodeStep();

    expect(screen.getByRole("heading", { name: "Enter your login code" })).toHaveFocus();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(code).toHaveAccessibleDescription("Can't use the app? Enter one of your recovery codes instead.");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    // A numeric keypad couldn't type a recovery code.
    expect(code).not.toHaveAttribute("inputmode");
    expect(authState()).toBe("unauthenticated");
    expect(codeRequests()).toEqual([]);
    expect(window.location.href).toBe(address);
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(nav.router.push).not.toHaveBeenCalled();
  });

  it("logs in with the right code and moves on as a normal login does", async () => {
    api.on("POST", "/auth/login/two-factor", json(200, account));
    const { user, code, verify } = await reachCodeStep();

    await user.type(code, "123 456");
    await user.click(verify);

    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(codeRequests().map((call) => call.body)).toEqual([{ challenge: CHALLENGE, code: "123 456" }]);
    expect(nav.router.replace).toHaveBeenCalledWith("/");
    expect(screen.getByRole("status")).toHaveTextContent("Taking you to Hopsnop…");
  });

  it("takes a recovery code, sent as typed", async () => {
    api.on("POST", "/auth/login/two-factor", json(200, account));
    const { user, code, verify } = await reachCodeStep();

    await user.type(code, "abcd-efgh-jkmn-pqrs");
    await user.click(verify);

    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(codeRequests()[0].body).toEqual({ challenge: CHALLENGE, code: "abcd-efgh-jkmn-pqrs" });
  });

  it("stays on the code step after a wrong code, so the user can try again", async () => {
    api.on(
      "POST",
      "/auth/login/two-factor",
      json(400, { detail: "Invalid code." }),
      json(200, account),
    );
    const { user, code, verify } = await reachCodeStep();

    await user.type(code, "111111");
    await user.click(verify);

    await waitFor(() =>
      expect(code).toHaveAccessibleDescription("That code didn't work. Check it and try again."),
    );
    expect(code).toHaveFocus();
    expect(code).toHaveValue("111111");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
    expect(authState()).toBe("unauthenticated");

    await user.clear(code);
    await user.type(code, "222222");
    await user.click(verify);

    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(codeRequests().map((call) => call.body)).toEqual([
      { challenge: CHALLENGE, code: "111111" },
      { challenge: CHALLENGE, code: "222222" },
    ]);
  });

  it.each([
    ["nothing", "", "Enter a code from your authenticator app or a recovery code."],
    ["too few digits", "12345", "Enter the 6 digits from your app, or a recovery code like ABCD-EFGH-JKMN-PQRS."],
    ["a short recovery code", "ABCD-EFGH-JKMN", "Enter the 6 digits from your app, or a recovery code like ABCD-EFGH-JKMN-PQRS."],
  ])("sends nothing for %s, as it would only count as a wrong code", async (_, typed, message) => {
    const { user, code, verify } = await reachCodeStep();
    if (typed) await user.type(code, typed);

    await user.click(verify);

    expect(code).toHaveAccessibleDescription(message);
    expect(code).toHaveFocus();
    expect(codeRequests()).toEqual([]);
  });

  it.each([
    ["the challenge has expired or was voided", json(400, { detail: "Invalid or expired login challenge." })],
    ["the account is gone", json(401, { detail: "Not authenticated." })],
    ["the challenge is refused as malformed", json(422, { detail: [{ loc: ["body", "challenge"], msg: "Too long", type: "string_too_long" }] })],
  ])("goes back to the password step when %s", async (_, reply) => {
    api.on("POST", "/auth/login/two-factor", reply);
    const { user, code, verify } = await reachCodeStep();

    await user.type(code, "123456");
    await user.click(verify);

    await waitFor(() => expect(passwordStepHeading()).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That login has expired, or too many wrong codes were entered. Enter your password to try again.",
    );
    expect(screen.getByLabelText("Username or email")).toHaveValue("test_viewer");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
    expect(authState()).toBe("unauthenticated");
  });

  it("starts a new login after an expired challenge, with a new challenge", async () => {
    api.on("POST", "/auth/login/two-factor", json(400, { detail: "Invalid or expired login challenge." }));
    const { user, code, verify } = await reachCodeStep();
    await user.type(code, "123456");
    await user.click(verify);
    await waitFor(() => expect(passwordStepHeading()).toHaveFocus());

    api.on("POST", "/auth/login", json(200, account));
    await user.type(screen.getByLabelText("Password"), "right password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(loginRequests()).toHaveLength(2);
    expect(codeRequests()).toHaveLength(1);
  });

  it.each([
    [
      "too many wrong codes",
      json(429, { detail: "Too many requests. Try again later." }, { "Retry-After": "300" }),
      "Too many attempts. Please wait about 5 minutes before trying again.",
    ],
    ["a server error", json(500, { detail: "Internal server error." }), "Something went wrong. Please try again."],
    ["no connection", networkError(), "Couldn't reach Hopsnop. Check your connection and try again."],
  ])("explains %s and stays on the code step", async (_, reply, message) => {
    api.on("POST", "/auth/login/two-factor", reply);
    const { user, code, verify } = await reachCodeStep();

    await user.type(code, "123456");
    await user.click(verify);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("heading", { name: "Enter your login code" })).toBeInTheDocument();
    expect(code).toHaveValue("123456");
    expect(authState()).toBe("unauthenticated");
  });

  it("goes back to the password step without a request", async () => {
    const { user, code } = await reachCodeStep();
    await user.type(code, "123456");

    await user.click(screen.getByRole("button", { name: "Back to log in" }));

    await waitFor(() => expect(passwordStepHeading()).toHaveFocus());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Username or email")).toHaveValue("test_viewer");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(codeRequests()).toEqual([]);
  });

  it("asks for the code afresh after going back, with the new challenge", async () => {
    const { user } = await reachCodeStep();
    await user.click(screen.getByRole("button", { name: "Back to log in" }));
    const newChallenge = { ...LOGIN_CHALLENGE, challenge: "YW5vdGhlci1tYWRlLXVwLWNoYWxsZW5nZQ" };
    api.on("POST", "/auth/login", json(202, newChallenge));
    api.on("POST", "/auth/login/two-factor", json(200, account));

    await user.type(screen.getByLabelText("Password"), "right password");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    const code = await screen.findByLabelText("Code");
    expect(code).toHaveValue("");
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(codeRequests()[0].body).toEqual({ challenge: newChallenge.challenge, code: "123456" });
  });

  it("sends one code at a time, however often the form is sent", async () => {
    const answer = deferred();
    api.on("POST", "/auth/login/two-factor", answer.reply);
    const { user, code, verify } = await reachCodeStep();
    await user.type(code, "123456");

    await user.click(verify);
    fireEvent.submit(verify.closest("form")!);

    expect(codeRequests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Verifying…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to log in" })).toBeDisabled();

    await act(() => answer.respond(json(200, account)));
    await waitFor(() => expect(authState()).toBe("authenticated"));
    expect(codeRequests()).toHaveLength(1);
  });

  it("keeps the challenge out of storage, cookies, the address, the history, the page and the console", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const history = [vi.spyOn(window.history, "pushState"), vi.spyOn(window.history, "replaceState")];
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    api.on(
      "POST",
      "/auth/login/two-factor",
      json(400, { detail: "Invalid code." }),
      json(429, { detail: "Too many requests. Try again later." }, { "Retry-After": "60" }),
    );
    const { user, code, verify } = await reachCodeStep();

    await user.type(code, "111111");
    await user.click(verify);
    await waitFor(() => expect(codeRequests()).toHaveLength(1));
    await user.click(verify);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(CHALLENGE);
    await user.click(screen.getByRole("button", { name: "Back to log in" }));

    const mentions = (value: unknown) => JSON.stringify(value ?? null).includes(CHALLENGE);
    expect(setItem.mock.calls.some(mentions)).toBe(false);
    expect([...Array(localStorage.length).keys()]).toEqual([]);
    expect([...Array(sessionStorage.length).keys()]).toEqual([]);
    expect(document.cookie).not.toContain(CHALLENGE);
    expect(window.location.href).not.toContain(CHALLENGE);
    for (const spy of history) expect(spy.mock.calls.some(mentions)).toBe(false);
    expect([...nav.router.push.mock.calls, ...nav.router.replace.mock.calls].some(mentions)).toBe(false);
    for (const spy of consoles) expect(spy.mock.calls.some(mentions)).toBe(false);
    expect(document.body.innerHTML).not.toContain(CHALLENGE);
    // Sent to the backend, in the body, and nowhere else.
    expect(api.calls().filter(mentions).map((call) => call.path)).toEqual([
      "/auth/login/two-factor",
      "/auth/login/two-factor",
    ]);
    expect(api.calls().some((call) => call.path.includes(CHALLENGE))).toBe(false);
  });
});
