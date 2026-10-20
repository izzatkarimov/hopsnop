import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, deferred, html, json, networkError, noContent } from "@/test/api";
import { account, authState, renderSignedIn } from "@/test/render";
import { renderSignedOut, renderWithSessionCheck } from "@/test/session";
import { AuthSwitch } from "./auth-switch";
import { GuestOnly } from "./guest-only";
import { LogoutButton } from "./logout-button";
import { RequireAuth } from "./require-auth";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/** The provider says when a check fails; the tests expect it to. */
function expectSessionCheckLog() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

const privatePage = (
  <RequireAuth>
    <p>Private page</p>
  </RequireAuth>
);

describe("RequireAuth", () => {
  it("shows nothing of the page while the session is being checked", async () => {
    const check = deferred();
    renderWithSessionCheck(privatePage, check.reply);

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByText("Private page")).not.toBeInTheDocument();

    await act(() => check.respond(json(200, account)));
    expect(await screen.findByText("Private page")).toBeInTheDocument();
  });

  it("shows the page to a signed-in user", async () => {
    await renderSignedIn(privatePage);

    expect(screen.getByText("Private page")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to the login page without showing the page", async () => {
    await renderSignedOut(privatePage);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("Private page")).not.toBeInTheDocument();
  });

  it("does not take a failed check for 'signed out', and checks again on request", async () => {
    const log = expectSessionCheckLog();
    renderWithSessionCheck(privatePage, json(503, { detail: "Unavailable." }), json(200, account));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load Hopsnop");
    expect(alert).toHaveTextContent("We couldn't check whether you're signed in. Please try again.");
    expect(router.replace).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Private page")).toBeInTheDocument();
    expect(api.calls("GET", "/auth/me")).toHaveLength(2);
  });
});

describe("GuestOnly", () => {
  const loginPage = (
    <GuestOnly>
      <p>Login form</p>
    </GuestOnly>
  );

  it("shows its page to a signed-out visitor", async () => {
    await renderSignedOut(loginPage);

    expect(screen.getByText("Login form")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("takes a signed-in user to the app instead", async () => {
    await renderSignedIn(loginPage);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(screen.getByRole("status")).toHaveTextContent("Taking you to Hopsnop…");
    expect(screen.queryByText("Login form")).not.toBeInTheDocument();
  });

  it("still lets the user log in when the session could not be checked", async () => {
    const log = expectSessionCheckLog();
    renderWithSessionCheck(loginPage, networkError());

    await waitFor(() => expect(authState()).toBe("error"));
    expect(screen.getByText("Login form")).toBeInTheDocument();
    expect(log).toHaveBeenCalled();
  });
});

describe("AuthSwitch", () => {
  const publicPage = <AuthSwitch authenticated={<p>Signed-in view</p>} guest={<p>Guest view</p>} />;

  it("waits for the session check before choosing", async () => {
    const check = deferred();
    renderWithSessionCheck(publicPage, check.reply);

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByText("Guest view")).not.toBeInTheDocument();

    await act(() => check.respond(json(200, account)));
    expect(await screen.findByText("Signed-in view")).toBeInTheDocument();
  });

  it("shows the guest view only when the backend says there is no session", async () => {
    await renderSignedOut(publicPage);

    expect(screen.getByText("Guest view")).toBeInTheDocument();
    expect(screen.queryByText("Signed-in view")).not.toBeInTheDocument();
  });

  it.each([
    ["the API is unreachable", networkError()],
    ["the server fails", json(503, { detail: "Unavailable." })],
    ["a 401 does not come from the backend", html(401)],
  ])("asks to try again, and shows no guest view, when %s", async (_, reply) => {
    const log = expectSessionCheckLog();
    renderWithSessionCheck(publicPage, reply);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load Hopsnop");
    // A signed-in user must not be shown as signed out.
    expect(screen.queryByText("Guest view")).not.toBeInTheDocument();
    expect(log).toHaveBeenCalled();
  });

  it("chooses again once a retry gets an answer", async () => {
    const log = expectSessionCheckLog();
    renderWithSessionCheck(publicPage, networkError(), json(401, { detail: "Not authenticated." }));
    await screen.findByRole("alert");

    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Guest view")).toBeInTheDocument();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("LogoutButton", () => {
  async function setup(variant: "button" | "icon" = "button") {
    await renderSignedIn(
      <RequireAuth>
        <LogoutButton variant={variant} />
      </RequireAuth>,
    );
    return { user: userEvent.setup(), button: screen.getByRole("button", { name: "Log out" }) };
  }

  it("ends the session, and the signed-in page leads to the login page", async () => {
    api.on("POST", "/auth/logout", noContent());
    const { user, button } = await setup();

    await user.click(button);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(api.calls("POST", "/auth/logout")).toHaveLength(1);
  });

  it("counts a session the backend no longer has as logged out", async () => {
    api.on("POST", "/auth/logout", json(401, { detail: "Not authenticated." }));
    const { user, button } = await setup("icon");

    await user.click(button);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });

  it.each([
    ["the server fails", json(500, { detail: "Internal server error." })],
    ["the API is unreachable", networkError()],
  ])("keeps the user signed in, and says so, when %s", async (_, reply) => {
    api.on("POST", "/auth/logout", reply);
    const { user, button } = await setup();

    await user.click(button);

    // The session may still be alive on the server.
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't log out. Try again.");
    expect(authState()).toBe("authenticated");
    expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("can be pressed only once while logging out", async () => {
    const answer = deferred();
    api.on("POST", "/auth/logout", answer.reply);
    const { user, button } = await setup();

    await user.click(button);

    expect(screen.getByRole("button", { name: "Logging out…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Logging out…" }));
    expect(api.calls("POST", "/auth/logout")).toHaveLength(1);

    await act(() => answer.respond(noContent()));
    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});
