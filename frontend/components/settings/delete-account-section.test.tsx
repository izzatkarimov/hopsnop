import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/auth/require-auth";
import { api, deferred, json, noContent } from "@/test/api";
import { authState, renderSignedIn } from "@/test/render";
import { DeleteAccountSection } from "./delete-account-section";

// RequireAuth uses the App Router, which only exists in a running Next.js app.
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const PASSWORD = "my password 123";

async function setup() {
  await renderSignedIn(
    <RequireAuth>
      <DeleteAccountSection />
    </RequireAuth>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Delete account" }));
  return {
    user,
    password: screen.getByLabelText("Password"),
    understood: screen.getByRole("checkbox", {
      name: "I understand that my account and everything in it will be deleted permanently.",
    }),
    submit: screen.getByRole("button", { name: "Delete account permanently" }),
  };
}

const deleteRequests = () => api.calls("POST", "/auth/delete-account");

describe("DeleteAccountSection", () => {
  it("asks for the password first, and Cancel sends nothing", async () => {
    const { user, password, understood } = await setup();
    expect(password).toHaveFocus();

    await user.type(password, PASSWORD);
    await user.click(understood);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete account" })).toHaveFocus();
    expect(deleteRequests()).toEqual([]);
    expect(authState()).toBe("authenticated");
  });

  it("closes on Escape, and opens again with nothing filled in", async () => {
    const { user, password } = await setup();
    await user.type(password, PASSWORD);

    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(deleteRequests()).toEqual([]);
  });

  it("needs both the password and the confirmation before it sends anything", async () => {
    const { user, password, understood, submit } = await setup();

    await user.click(submit);
    expect(password).toHaveAccessibleDescription("Enter your password.");
    expect(understood).toHaveAccessibleDescription(
      "Confirm that you understand your account will be deleted for good.",
    );
    expect(password).toHaveFocus();

    await user.type(password, PASSWORD);
    await user.click(submit);
    expect(password).toBeValid();
    expect(understood).toBeInvalid();
    expect(understood).toHaveFocus();

    expect(deleteRequests()).toEqual([]);
  });

  it("keeps the account when the password is wrong", async () => {
    api.on("POST", "/auth/delete-account", json(400, { detail: "Current password is incorrect." }));
    const { user, password, understood, submit } = await setup();
    await user.type(password, "wrong password");
    await user.click(understood);

    await user.click(submit);

    await waitFor(() => expect(password).toHaveAccessibleDescription("Your password is incorrect."));
    expect(password).toHaveFocus();
    expect(authState()).toBe("authenticated");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["a server error", json(503, { detail: "Unavailable." }), "Something went wrong. Please try again."],
    [
      "too many wrong passwords",
      json(429, { detail: "Too many requests. Try again later." }, { "Retry-After": "120" }),
      "Too many attempts. Please wait about 2 minutes before trying again.",
    ],
  ])("explains %s and keeps the account", async (_, reply, message) => {
    api.on("POST", "/auth/delete-account", reply);
    const { user, password, understood, submit } = await setup();
    await user.type(password, PASSWORD);
    await user.click(understood);

    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(authState()).toBe("authenticated");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("signs out here and leads to the login page once the account is deleted", async () => {
    api.on("POST", "/auth/delete-account", noContent());
    const { user, password, understood, submit } = await setup();
    await user.type(password, PASSWORD);
    await user.click(understood);

    await user.click(submit);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(deleteRequests().map((call) => call.body)).toEqual([{ password: PASSWORD }]);
    expect(screen.queryByRole("heading", { name: "Delete account" })).not.toBeInTheDocument();
  });

  it("sends one request however often the form is submitted meanwhile", async () => {
    const answer = deferred();
    api.on("POST", "/auth/delete-account", answer.reply);
    const { user, password, understood, submit } = await setup();
    await user.type(password, PASSWORD);
    await user.click(understood);
    const form = submit.closest("form")!;

    // Twice before React renders again, which the disabled button cannot stop.
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(deleteRequests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Deleting account…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(() => answer.respond(noContent()));
    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(deleteRequests()).toHaveLength(1);
  });

  it("lets go of the user when the session has already ended", async () => {
    api.on("POST", "/auth/delete-account", json(401, { detail: "Not authenticated." }));
    const { user, password, understood, submit } = await setup();
    await user.type(password, PASSWORD);
    await user.click(understood);

    await user.click(submit);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(authState()).toBe("unauthenticated");
  });
});
