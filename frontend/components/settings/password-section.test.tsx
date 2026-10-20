import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, deferred, json } from "@/test/api";
import { authState, renderSignedIn } from "@/test/render";
import { PasswordSection } from "./password-section";

const CURRENT = "current password 1";
const NEW = "a new password 2";

async function setup() {
  const onChanged = vi.fn();
  await renderSignedIn(<PasswordSection onChanged={onChanged} />);
  return {
    onChanged,
    user: userEvent.setup(),
    current: screen.getByLabelText("Current password"),
    next: screen.getByLabelText("New password"),
    confirm: screen.getByLabelText("Confirm new password"),
    submit: screen.getByRole("button", { name: "Change password" }),
  };
}

type Fields = Awaited<ReturnType<typeof setup>>;

async function fill({ user, current, next, confirm }: Fields, values = [CURRENT, NEW, NEW]) {
  const [a, b, c] = values;
  if (a) await user.type(current, a);
  if (b) await user.type(next, b);
  if (c) await user.type(confirm, c);
}

const changeRequests = () => api.calls("POST", "/auth/change-password");

describe("PasswordSection", () => {
  it("asks for every field and sends nothing until they are given", async () => {
    const fields = await setup();

    await fields.user.click(fields.submit);

    expect(fields.current).toHaveAccessibleDescription("Enter your current password.");
    expect(fields.next).toHaveAccessibleDescription("Choose a password.");
    expect(fields.confirm).toHaveAccessibleDescription("Enter the new password again.");
    for (const input of [fields.current, fields.next, fields.confirm]) expect(input).toBeInvalid();
    expect(fields.current).toHaveFocus();
    expect(changeRequests()).toEqual([]);
  });

  it("states the password requirements next to the new password", async () => {
    const { next } = await setup();

    expect(next).toHaveAccessibleDescription("Use 12 to 128 characters.");
  });

  it("checks that the confirmation matches before sending", async () => {
    const fields = await setup();
    await fill(fields, [CURRENT, NEW, `${NEW}!`]);

    await fields.user.click(fields.submit);

    expect(fields.confirm).toHaveAccessibleDescription("The passwords don't match.");
    expect(fields.confirm).toHaveFocus();
    expect(changeRequests()).toEqual([]);

    // Changing the new password makes "don't match" out of date.
    await fields.user.type(fields.next, "x");
    expect(fields.confirm).toBeValid();
  });

  it("holds the new password to the backend's minimum before sending", async () => {
    const fields = await setup();
    await fill(fields, [CURRENT, "short", "short"]);

    await fields.user.click(fields.submit);

    expect(fields.next).toHaveAccessibleDescription("Use at least 12 characters.");
    expect(fields.next).toHaveFocus();
    expect(changeRequests()).toEqual([]);
  });

  it("changes the password, clears every field and says what happened", async () => {
    api.on("POST", "/auth/change-password", json(200, { message: "Password has been changed." }));
    const fields = await setup();
    await fill(fields);

    await fields.user.click(fields.submit);

    expect(
      await screen.findByText("Your password has been changed. Any other sessions have been signed out."),
    ).toBeInTheDocument();
    expect(changeRequests().map((call) => call.body)).toEqual([
      { current_password: CURRENT, new_password: NEW },
    ]);
    for (const input of [fields.current, fields.next, fields.confirm]) expect(input).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Password" })).toHaveFocus();
    expect(fields.onChanged).toHaveBeenCalledTimes(1);
    // The backend keeps this session, so the user stays signed in.
    expect(authState()).toBe("authenticated");
  });

  it("shows a wrong current password on its field, and keeps the session", async () => {
    api.on("POST", "/auth/change-password", json(400, { detail: "Current password is incorrect." }));
    const fields = await setup();
    await fill(fields);

    await fields.user.click(fields.submit);

    await waitFor(() =>
      expect(fields.current).toHaveAccessibleDescription("Your current password is incorrect."),
    );
    expect(fields.current).toHaveFocus();
    // Typed once is enough: the new password is not asked for again.
    expect(fields.next).toHaveValue(NEW);
    expect(fields.onChanged).not.toHaveBeenCalled();
    expect(authState()).toBe("authenticated");
  });

  it("shows the backend's own refusal of the new password on that field", async () => {
    api.on(
      "POST",
      "/auth/change-password",
      json(422, {
        detail: [
          {
            loc: ["body", "new_password"],
            msg: "Value error, Password must be at least 14 characters long.",
            type: "value_error",
          },
        ],
      }),
    );
    const fields = await setup();
    await fill(fields);

    await fields.user.click(fields.submit);

    await waitFor(() =>
      expect(fields.next).toHaveAccessibleDescription("Password must be at least 14 characters long."),
    );
    expect(fields.next).toHaveFocus();
  });

  it.each([
    ["a server error", json(500, { detail: "Internal server error." }), "Something went wrong. Please try again."],
    [
      "too many wrong passwords",
      json(429, { detail: "Too many requests. Try again later." }, { "Retry-After": "600" }),
      "Too many attempts. Please wait about 10 minutes before trying again.",
    ],
  ])("explains %s and keeps what was typed", async (_, reply, message) => {
    api.on("POST", "/auth/change-password", reply);
    const fields = await setup();
    await fill(fields);

    await fields.user.click(fields.submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(fields.current).toHaveValue(CURRENT);
    expect(fields.onChanged).not.toHaveBeenCalled();
  });

  it("sends one request however often the form is submitted meanwhile", async () => {
    const answer = deferred();
    api.on("POST", "/auth/change-password", answer.reply);
    const fields = await setup();
    await fill(fields);
    const form = fields.submit.closest("form")!;

    // Twice before React renders again, which the disabled button cannot stop.
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(changeRequests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Changing password…" })).toBeDisabled();

    await act(() => answer.respond(json(200, { message: "Password has been changed." })));
    expect(await screen.findByRole("button", { name: "Change password" })).toBeEnabled();
    expect(changeRequests()).toHaveLength(1);
  });

  it("lets go of the user when the backend says the session has ended", async () => {
    api.on("POST", "/auth/change-password", json(401, { detail: "Not authenticated." }));
    const fields = await setup();
    await fill(fields);

    await fields.user.click(fields.submit);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(fields.onChanged).not.toHaveBeenCalled();
  });
});
