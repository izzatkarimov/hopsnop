import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, deferred, json } from "@/test/api";
import { account } from "@/test/render";
import { RegisterForm } from "./register-form";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const VALID = {
  displayName: "  Test Viewer ",
  username: " test_viewer ",
  email: " test_viewer@example.com ",
  password: " a long password ",
};

function setup() {
  // Registering needs no session, so no AuthProvider either.
  render(<RegisterForm />);
  return {
    user: userEvent.setup(),
    displayName: screen.getByLabelText("Display name"),
    username: screen.getByLabelText("Username"),
    email: screen.getByLabelText("Email"),
    password: screen.getByLabelText("Password"),
    submit: screen.getByRole("button", { name: "Create account" }),
  };
}

type Fields = ReturnType<typeof setup>;

async function fill(fields: Fields, values: Partial<typeof VALID> = {}) {
  const all = { ...VALID, ...values };
  for (const name of ["displayName", "username", "email", "password"] as const) {
    if (all[name]) await fields.user.type(fields[name], all[name]);
  }
}

const registerRequests = () => api.calls("POST", "/auth/register");

describe("RegisterForm", () => {
  it("checks every field before sending anything", async () => {
    const fields = setup();

    await fields.user.click(fields.submit);

    expect(fields.displayName).toHaveAccessibleDescription("Enter a display name.");
    expect(fields.username).toHaveAccessibleDescription("Choose a username.");
    expect(fields.email).toHaveAccessibleDescription("Enter your email address.");
    expect(fields.password).toHaveAccessibleDescription("Choose a password.");
    expect(fields.displayName).toHaveFocus();
    expect(registerRequests()).toEqual([]);
  });

  it("states the username and password rules next to their fields", () => {
    const { username, password } = setup();

    expect(username).toHaveAccessibleDescription("3 to 30 letters, numbers or underscores.");
    expect(password).toHaveAccessibleDescription("At least 12 characters.");
  });

  it.each([
    ["displayName", { displayName: "x".repeat(51) }, "Use at most 50 characters."],
    ["username", { username: "ab" }, "Use 3 to 30 letters, numbers or underscores."],
    ["username", { username: "no spaces" }, "Use 3 to 30 letters, numbers or underscores."],
    ["email", { email: "not-an-email" }, "Enter a valid email address."],
    ["password", { password: "too short" }, "Use at least 12 characters."],
  ] as const)("refuses an invalid %s before sending", async (field, values, message) => {
    const fields = setup();
    await fill(fields, values);

    await fields.user.click(fields.submit);

    expect(fields[field]).toHaveAccessibleDescription(message);
    expect(fields[field]).toHaveFocus();
    expect(registerRequests()).toEqual([]);
  });

  it("creates the account with trimmed details and the password as typed, then asks to verify", async () => {
    api.on("POST", "/auth/register", json(201, account));
    const fields = setup();
    await fill(fields);

    await fields.user.click(fields.submit);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/verify-email"));
    expect(registerRequests().map((call) => call.body)).toEqual([
      {
        display_name: "Test Viewer",
        username: "test_viewer",
        email: "test_viewer@example.com",
        password: " a long password ",
      },
    ]);
  });

  it.each([
    ["username", "Username already in use.", "That username is already taken."],
    ["email", "Email already in use.", "An account with this email address already exists."],
  ] as const)("shows a taken %s on its field", async (field, detail, message) => {
    api.on("POST", "/auth/register", json(409, { detail }));
    const fields = setup();
    await fill(fields);

    await fields.user.click(fields.submit);

    await waitFor(() => expect(fields[field]).toHaveAccessibleDescription(message));
    expect(fields[field]).toHaveFocus();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("puts the backend's own field errors on the fields", async () => {
    api.on(
      "POST",
      "/auth/register",
      json(422, {
        detail: [{ loc: ["body", "email"], msg: "Value error, That domain cannot receive email.", type: "value_error" }],
      }),
    );
    const fields = setup();
    await fill(fields);

    await fields.user.click(fields.submit);

    await waitFor(() =>
      expect(fields.email).toHaveAccessibleDescription("That domain cannot receive email."),
    );
  });

  it.each([
    ["another conflict", json(409, { detail: "Something else." }), "That username or email address is already in use."],
    ["a rejection without a field", json(422, { detail: [] }), "Some details were not accepted. Check them and try again."],
    ["a server error", json(500, { detail: "Internal server error." }), "Something went wrong. Please try again."],
    [
      "too many registrations",
      json(429, { detail: "Too many requests. Try again later." }, { "Retry-After": "900" }),
      "Too many attempts. Please wait about 15 minutes before trying again.",
    ],
  ])("explains %s for the whole form", async (_, reply, message) => {
    api.on("POST", "/auth/register", reply);
    const fields = setup();
    await fill(fields);

    await fields.user.click(fields.submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(router.push).not.toHaveBeenCalled();
    expect(fields.submit).toBeEnabled();
  });

  it("sends one request while the account is being created", async () => {
    const answer = deferred();
    api.on("POST", "/auth/register", answer.reply);
    const fields = setup();
    await fill(fields);

    await fields.user.click(fields.submit);
    fireEvent.submit(fields.submit.closest("form")!);

    expect(registerRequests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled();

    await act(() => answer.respond(json(201, account)));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(registerRequests()).toHaveLength(1);
  });
});

function submitTwiceAtOnce(form: HTMLFormElement) {
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("RegisterForm: one registration at a time", () => {
  it("sends one request when the form is sent twice in the same moment", async () => {
    const answer = deferred();
    api.on("POST", "/auth/register", answer.reply);
    const fields = setup();
    await fill(fields);

    submitTwiceAtOnce(fields.submit.closest("form")!);

    expect(registerRequests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled();

    await act(() => answer.respond(json(201, account)));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(registerRequests()).toHaveLength(1);
  });

  it("lets the user try again after a failed registration", async () => {
    api.on("POST", "/auth/register", json(500, { detail: "Internal server error." }), json(201, account));
    const fields = setup();
    await fill(fields);

    await fields.user.click(fields.submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    await fields.user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/verify-email"));
    expect(registerRequests()).toHaveLength(2);
  });

  it("sends the registration once a refused field is corrected", async () => {
    api.on("POST", "/auth/register", json(201, account));
    const fields = setup();
    await fill(fields, { password: "too short" });

    await fields.user.click(fields.submit);
    expect(fields.password).toHaveAccessibleDescription("Use at least 12 characters.");
    await fields.user.type(fields.password, " and longer now");
    await fields.user.click(fields.submit);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/verify-email"));
    expect(registerRequests()).toHaveLength(1);
  });
});
