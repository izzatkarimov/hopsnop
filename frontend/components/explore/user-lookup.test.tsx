import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, deferred, json, networkError } from "@/test/api";
import { account, renderSignedIn } from "@/test/render";
import { UserLookup } from "./user-lookup";

function profile(username: string, displayName: string, extra: object = {}) {
  return {
    id: `id-${username}`,
    username,
    display_name: displayName,
    bio: null,
    avatar_url: null,
    followers_count: 3,
    following_count: 1,
    created_at: "2026-02-01T10:00:00.000000Z",
    following: false,
    ...extra,
  };
}

const alice = profile("alice_92", "Alice Example", { bio: "Writes about trains." });
const bob = profile("bob_77", "Bob Example");

async function setup() {
  await renderSignedIn(<UserLookup />);
  return { user: userEvent.setup(), input: screen.getByRole("searchbox", { name: "Username" }) };
}

async function settle() {
  await act(() => new Promise((resolve) => setImmediate(resolve)));
}

function lookups() {
  return api
    .calls("GET")
    .filter((call) => call.path.startsWith("/users/"))
    .map((call) => call.path.slice("/users/".length));
}

describe("UserLookup", () => {
  it("looks up at once on Enter, and shows the account", async () => {
    api.on("GET", "/users/alice_92", json(200, alice));
    const { user, input } = await setup();

    await user.type(input, "alice_92{Enter}");

    const link = await screen.findByRole("link", { name: /Alice Example/ });
    expect(link).toHaveAttribute("href", "/users/alice_92");
    expect(screen.getByText("Writes about trains.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Found Alice Example, @alice_92.");
    expect(lookups()).toEqual(["alice_92"]);
  });

  it("accepts a leading @, other case and spaces around the name", async () => {
    api.on("GET", "/users/alice_92", json(200, alice));
    const { user, input } = await setup();

    await user.type(input, " @Alice_92 {Enter}");

    expect(await screen.findByRole("link", { name: /Alice Example/ })).toBeInTheDocument();
    expect(lookups()).toEqual(["alice_92"]);
  });

  it("says so when no account has the username", async () => {
    api.on("GET", "/users/nobody_here", json(404, { detail: "User not found." }));
    const { user, input } = await setup();

    await user.type(input, "nobody_here{Enter}");

    expect(await screen.findByText("No account is called @nobody_here")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No account is called @nobody_here.");
    expect(screen.queryByRole("link", { name: /nobody_here/ })).not.toBeInTheDocument();
  });

  it("marks the signed-in user's own account", async () => {
    api.on(
      "GET",
      `/users/${account.username}`,
      json(200, profile(account.username, account.display_name, { id: account.id })),
    );
    const { user, input } = await setup();

    await user.type(input, `${account.username}{Enter}`);

    await screen.findByRole("link", { name: /Test Viewer/ });
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("is busy while the answer is on its way", async () => {
    const answer = deferred();
    api.on("GET", "/users/alice_92", answer.reply);
    const { user, input } = await setup();

    await user.type(input, "alice_92{Enter}");

    const results = input.closest("form")!.nextElementSibling!;
    expect(results).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("link", { name: /Alice Example/ })).not.toBeInTheDocument();

    await act(() => answer.respond(json(200, alice)));
    expect(await screen.findByRole("link", { name: /Alice Example/ })).toBeInTheDocument();
    expect(results).toHaveAttribute("aria-busy", "false");
  });

  it("explains a failure and tries again on request", async () => {
    api.on("GET", "/users/alice_92", json(503, { detail: "Unavailable." }), json(200, alice));
    const { user, input } = await setup();

    await user.type(input, "alice_92{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't look up @alice_92");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: /Alice Example/ })).toBeInTheDocument();
    expect(lookups()).toEqual(["alice_92", "alice_92"]);
  });

  it("says when Hopsnop can't be reached, and Enter tries the same name again", async () => {
    api.on("GET", "/users/alice_92", networkError(), json(200, alice));
    const { user, input } = await setup();

    await user.type(input, "alice_92{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach Hopsnop. Check your connection and try again.",
    );

    await user.type(input, "{Enter}");

    expect(await screen.findByRole("link", { name: /Alice Example/ })).toBeInTheDocument();
    expect(lookups()).toEqual(["alice_92", "alice_92"]);
  });

  it("never lets an earlier answer replace the answer for a later username", async () => {
    const aliceAnswer = deferred();
    api.on("GET", "/users/alice_92", aliceAnswer.reply);
    api.on("GET", "/users/bob_77", json(200, bob));
    const { user, input } = await setup();

    await user.type(input, "alice_92{Enter}");
    await user.tripleClick(input);
    await user.paste("bob_77");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("link", { name: /Bob Example/ })).toBeInTheDocument();

    await act(() => aliceAnswer.respond(json(200, alice)));
    await settle();

    expect(screen.getByRole("link", { name: /Bob Example/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Alice Example/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Found Bob Example, @bob_77.");
  });

  it("drops an answer for a username that was cleared while it was on its way", async () => {
    const aliceAnswer = deferred();
    api.on("GET", "/users/alice_92", aliceAnswer.reply);
    const { user, input } = await setup();

    await user.type(input, "alice_92{Enter}");
    await user.clear(input);
    await act(() => aliceAnswer.respond(json(200, alice)));
    await settle();

    expect(screen.queryByRole("link", { name: /Alice Example/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("explains a username that is too short once Enter is pressed", async () => {
    const { user, input } = await setup();

    await user.type(input, "ab");
    expect(input).toBeValid();

    await user.keyboard("{Enter}");

    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription("Usernames have at least 3 characters.");
    expect(lookups()).toEqual([]);
  });
});

describe("UserLookup while the user types", () => {
  // The test moves the typing timer; user-event and findBy would wait on their own.
  async function setupTyping() {
    await renderSignedIn(<UserLookup />);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    return screen.getByRole("searchbox", { name: "Username" });
  }

  function typeQuickly(input: HTMLElement, text: string, from = "") {
    let value = from;
    for (const char of text) {
      value += char;
      fireEvent.change(input, { target: { value } });
    }
  }

  async function pause(ms: number) {
    await act(() => vi.advanceTimersByTimeAsync(ms));
  }

  it("waits until typing pauses, then sends one request for the whole name", async () => {
    api.on("GET", "/users/alice_92", json(200, alice));
    const input = await setupTyping();

    typeQuickly(input, "alice_92");
    await pause(399);
    expect(lookups()).toEqual([]);
    await pause(1);
    await settle();

    expect(lookups()).toEqual(["alice_92"]);
    expect(screen.getByRole("link", { name: /Alice Example/ })).toBeInTheDocument();
  });

  it("starts the wait again with every change", async () => {
    api.on("GET", "/users/alice_9", json(404, { detail: "User not found." }));
    const input = await setupTyping();

    typeQuickly(input, "alice_92");
    await pause(300);
    fireEvent.change(input, { target: { value: "alice_9" } });
    await pause(300);
    expect(lookups()).toEqual([]);
    await pause(100);
    await settle();

    expect(lookups()).toEqual(["alice_9"]);
  });

  it("does not ask again for the username it has shown", async () => {
    api.on("GET", "/users/alice_92", json(200, alice));
    const input = await setupTyping();
    typeQuickly(input, "alice_92");
    await pause(400);
    await settle();

    fireEvent.submit(input.closest("form")!);
    fireEvent.change(input, { target: { value: "alice_92 " } });
    fireEvent.change(input, { target: { value: "ALICE_92" } });
    await pause(1000);
    await settle();

    expect(lookups()).toEqual(["alice_92"]);
    expect(screen.getByRole("link", { name: /Alice Example/ })).toBeInTheDocument();
  });

  it.each([
    ["a name", "Alice Smith", "Usernames have only letters, numbers and underscores. Searching by name isn't available yet."],
    ["too many characters", "a".repeat(31), "Usernames have at most 30 characters."],
  ])("explains %s and sends nothing, however long it waits", async (_, text, message) => {
    const input = await setupTyping();

    typeQuickly(input, text);
    await pause(5000);

    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription(message);
    expect(lookups()).toEqual([]);
  });
});
