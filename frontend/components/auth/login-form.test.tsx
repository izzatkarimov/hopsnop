import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, deferred, json, networkError } from "@/test/api";
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
    // GuestOnly takes a signed-in user to the app.
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
    // Only the backend's own text means "not verified"; any other 403 is unexpected.
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
    // A second submission, e.g. Enter pressed again.
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
    // Out of the address bar, so that a reload does not say it again.
    expect(replaceState).toHaveBeenCalledWith(null, "", window.location.pathname);
  });
});

/** Two submissions in the same moment, before React can render in between. */
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
