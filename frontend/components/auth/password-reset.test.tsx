import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, deferred, json } from "@/test/api";
import { renderSignedIn } from "@/test/render";
import { renderSignedOut } from "@/test/session";
import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPassword } from "./reset-password";

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => nav.params,
}));

const TOKEN = "single-use-reset-token";

beforeEach(() => {
  nav.params = new URLSearchParams();
});

describe("ForgotPasswordForm", () => {
  function setup() {
    render(<ForgotPasswordForm />);
    return {
      user: userEvent.setup(),
      email: screen.getByLabelText("Email"),
      submit: screen.getByRole("button", { name: "Send reset link" }),
    };
  }

  const requests = () => api.calls("POST", "/auth/forgot-password");

  it("checks the address before asking for a link", async () => {
    const { user, email, submit } = setup();

    await user.type(email, "not-an-address");
    await user.click(submit);

    expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    expect(email).toHaveFocus();
    expect(requests()).toEqual([]);
  });

  it("asks for a link and answers the same way whether or not the address has an account", async () => {
    api.on("POST", "/auth/forgot-password", json(200, { message: "If the address is registered, a link is on its way." }));
    const { user, email, submit } = setup();

    await user.type(email, " someone@example.com ");
    await user.click(submit);

    expect(
      await screen.findByText(
        "If that address belongs to an account, we've emailed it a link to reset your password. The link expires after a short time.",
      ),
    ).toBeInTheDocument();
    expect(requests().map((call) => call.body)).toEqual([{ email: "someone@example.com" }]);
  });

  it("explains a rate limit", async () => {
    api.on(
      "POST",
      "/auth/forgot-password",
      json(429, { detail: "Too many requests. Try again later." }, { "Retry-After": "600" }),
    );
    const { user, email, submit } = setup();

    await user.type(email, "someone@example.com");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Please wait about 10 minutes before trying again.",
    );
  });

  it("sends one request, however often it is sent at the same moment", async () => {
    // The backend counts every request against its limit, whatever the outcome.
    const answer = deferred();
    api.on("POST", "/auth/forgot-password", answer.reply);
    const { user, email, submit } = setup();
    await user.type(email, "someone@example.com");
    const form = submit.closest("form")!;

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(requests()).toHaveLength(1);
    await act(() => answer.respond(json(200, { message: "ok" })));
    expect(await screen.findByRole("button", { name: "Send reset link" })).toBeEnabled();
  });
});

describe("ResetPassword", () => {
  async function openLink() {
    nav.params = new URLSearchParams({ token: TOKEN });
    const replaceState = vi.spyOn(window.history, "replaceState");
    await renderSignedOut(<ResetPassword />);
    return {
      replaceState,
      user: userEvent.setup(),
      password: screen.getByLabelText("New password"),
      submit: screen.getByRole("button", { name: "Reset password" }),
    };
  }

  const requests = () => api.calls("POST", "/auth/reset-password");

  it("takes the token out of the address bar and browser history at once", async () => {
    const { replaceState } = await openLink();

    expect(replaceState).toHaveBeenCalledWith(null, "", window.location.pathname);
    expect(requests()).toEqual([]);
  });

  it("explains how to get a link when the page is opened without one", async () => {
    await renderSignedOut(<ResetPassword />);

    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("holds the new password to the policy before sending the token", async () => {
    const { user, password, submit } = await openLink();
    expect(password).toHaveAccessibleDescription("At least 12 characters.");

    await user.type(password, "too short");
    await user.click(submit);

    expect(password).toHaveAccessibleDescription("Use at least 12 characters.");
    expect(requests()).toEqual([]);
  });

  it("sets the new password with the token, then leads to the login page with a note", async () => {
    api.on("POST", "/auth/reset-password", json(200, { message: "Password has been reset." }));
    const { user, password, submit } = await openLink();

    await user.type(password, " a brand new password ");
    await user.click(submit);

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/login?password_reset=done"));
    expect(requests().map((call) => call.body)).toEqual([
      { token: TOKEN, new_password: " a brand new password " },
    ]);
  });

  it("checks the session again when the browser had one, as the reset ended them all", async () => {
    api.on("POST", "/auth/reset-password", json(200, { message: "Password has been reset." }));
    nav.params = new URLSearchParams({ token: TOKEN });
    await renderSignedIn(<ResetPassword />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("New password"), "a brand new password");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalled());
    expect(api.calls("GET", "/auth/me")).toHaveLength(2);
  });

  it("says the link no longer works when the backend refuses the token, and forgets it", async () => {
    api.on("POST", "/auth/reset-password", json(400, { detail: "Invalid or expired password reset token." }));
    const { user, password, submit } = await openLink();

    await user.type(password, "a brand new password");
    await user.click(submit);

    expect(await screen.findByRole("heading", { name: "This link didn't work" })).toBeInTheDocument();
    expect(screen.getByText("The password reset link is invalid or has expired.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
    // Neither the token nor the password typed for it is kept.
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal of the password on the field, and keeps the link usable", async () => {
    api.on(
      "POST",
      "/auth/reset-password",
      json(422, {
        detail: [{ loc: ["body", "new_password"], msg: "Value error, Password must be at least 14 characters long.", type: "value_error" }],
      }),
      json(200, { message: "Password has been reset." }),
    );
    const { user, password, submit } = await openLink();
    await user.type(password, "a brand new password");

    await user.click(submit);
    await waitFor(() =>
      expect(password).toHaveAccessibleDescription("Password must be at least 14 characters long."),
    );
    await user.type(password, " longer");
    await user.click(submit);

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/login?password_reset=done"));
    expect(requests().map((call) => (call.body as { token: string }).token)).toEqual([TOKEN, TOKEN]);
  });

  it("keeps the link usable after an unexpected failure", async () => {
    api.on("POST", "/auth/reset-password", json(503, { detail: "Unavailable." }));
    const { user, password, submit } = await openLink();
    await user.type(password, "a brand new password");

    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(screen.getByRole("button", { name: "Reset password" })).toBeEnabled();
    expect(password).toHaveValue("a brand new password");
  });
});
