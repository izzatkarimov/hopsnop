import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, json } from "@/test/api";
import { VerifyEmail } from "./verify-email";

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params }));

const TOKEN = "single-use-verification-token";

beforeEach(() => {
  nav.params = new URLSearchParams();
});

const verifyRequests = () => api.calls("POST", "/auth/verify-email");

function openLink() {
  nav.params = new URLSearchParams({ token: TOKEN });
  const replaceState = vi.spyOn(window.history, "replaceState");
  // StrictMode runs effects twice, as development does. The token may be
  // redeemed only once, so it must still be sent only once.
  render(
    <StrictMode>
      <VerifyEmail />
    </StrictMode>,
  );
  return { replaceState };
}

describe("VerifyEmail", () => {
  it("sends the token once, takes it out of the address bar, and says the account is ready", async () => {
    api.on("POST", "/auth/verify-email", json(200, { message: "Email address verified." }));
    const { replaceState } = openLink();

    expect(await screen.findByRole("heading", { name: "Email verified" })).toBeInTheDocument();
    expect(screen.getByText("Your account is ready. You can log in now.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(verifyRequests().map((call) => call.body)).toEqual([{ token: TOKEN }]);
    expect(replaceState).toHaveBeenCalledWith(null, "", window.location.pathname);
  });

  it.each([
    ["refuses it", json(400, { detail: "Invalid or expired verification token." })],
    ["finds it malformed", json(422, { detail: [] })],
  ])("says the link didn't work when the backend %s, and offers a new one", async (_, reply) => {
    api.on("POST", "/auth/verify-email", reply);
    openLink();

    expect(await screen.findByRole("heading", { name: "This link didn't work" })).toBeInTheDocument();
    expect(screen.getByText("The verification link is invalid or has expired.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send a new link" })).toBeInTheDocument();
  });

  it("explains a failed request, and tries the same token again on request", async () => {
    api.on("POST", "/auth/verify-email", json(503, { detail: "Unavailable." }), json(200, { message: "ok" }));
    openLink();

    expect(await screen.findByRole("heading", { name: "Couldn't verify your email" })).toBeInTheDocument();
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Email verified" })).toBeInTheDocument();
    expect(verifyRequests().map((call) => call.body)).toEqual([{ token: TOKEN }, { token: TOKEN }]);
  });

  it("waits for the link when opened without one, and sends nothing", () => {
    render(<VerifyEmail />);

    expect(screen.getByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    expect(verifyRequests()).toEqual([]);
  });
});

describe("Asking for a new verification link", () => {
  function setup() {
    render(<VerifyEmail />);
    return {
      user: userEvent.setup(),
      email: screen.getByLabelText("Email"),
      submit: screen.getByRole("button", { name: "Send a new link" }),
    };
  }

  const resendRequests = () => api.calls("POST", "/auth/resend-verification");

  it("checks the address before asking", async () => {
    const { user, email, submit } = setup();

    await user.type(email, "not-an-address");
    await user.click(submit);

    expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    expect(resendRequests()).toEqual([]);
  });

  it("asks for a link and answers the same way whether or not the address has an account", async () => {
    api.on("POST", "/auth/resend-verification", json(200, { message: "ok" }));
    const { user, email, submit } = setup();

    await user.type(email, " someone@example.com ");
    await user.click(submit);

    expect(
      await screen.findByText("If that address belongs to an account that still needs verifying, a new link is on its way."),
    ).toBeInTheDocument();
    expect(resendRequests().map((call) => call.body)).toEqual([{ email: "someone@example.com" }]);
  });

  it("explains a failed request", async () => {
    api.on("POST", "/auth/resend-verification", json(500, { detail: "Internal server error." }));
    const { user, email, submit } = setup();

    await user.type(email, "someone@example.com");
    await user.click(submit);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Please try again."));
  });
});
