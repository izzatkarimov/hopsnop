import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { formatFullDate } from "@/lib/format";
import { api, deferred, json, noContent } from "@/test/api";
import { authState, renderSignedIn } from "@/test/render";
import { SessionsSection } from "./sessions-section";

function session(id: string, isCurrent: boolean, createdAt: string) {
  return {
    id,
    created_at: createdAt,
    last_used_at: "2026-10-19T09:30:00.000000Z",
    expires_at: "2026-11-18T09:00:00.000000Z",
    is_current: isCurrent,
  };
}

// The backend lists the most recently used first; here the current
// session is not first, so the page has to put it there.
const other1 = session("11111111-1111-4111-8111-111111111111", false, "2026-10-10T08:00:00.000000Z");
const current = session("22222222-2222-4222-8222-222222222222", true, "2026-10-12T08:00:00.000000Z");
const other2 = session("33333333-3333-4333-8333-333333333333", false, "2026-10-14T08:00:00.000000Z");

async function setup() {
  await renderSignedIn(<SessionsSection />);
  return { user: userEvent.setup() };
}

/** The listed sessions, each by its title (without the "This browser" tag). */
async function rows() {
  const items = await screen.findAllByRole("listitem");
  return items.map(
    (item) => within(item).getByText(/^(Current|Other) session$/).firstChild?.textContent,
  );
}

const listRequests = () => api.calls("GET", "/auth/sessions");

describe("SessionsSection", () => {
  it("shows a placeholder, then every session with the current one first", async () => {
    const list = deferred();
    api.on("GET", "/auth/sessions", list.reply);
    await setup();

    expect(screen.getByRole("status")).toHaveTextContent("Loading sessions…");

    await act(() => list.respond(json(200, [other1, current, other2])));

    expect(await rows()).toEqual(["Current session", "Other session", "Other session"]);
    const first = screen.getAllByRole("listitem")[0];
    expect(within(first).getByText("This browser")).toBeInTheDocument();
    // Readable dates, with the exact moment for machines.
    const signedIn = within(first).getByText(formatFullDate(current.created_at));
    expect(signedIn).toHaveAttribute("dateTime", current.created_at);
    // Session ids are only used to end a session; they are never shown.
    expect(document.body).not.toHaveTextContent(current.id);
  });

  it("explains a failure to load, and loads again on request", async () => {
    api.on("GET", "/auth/sessions", json(503, { detail: "Unavailable." }), json(200, [current]));
    const { user } = await setup();

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your sessions");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await rows()).toEqual(["Current session"]);
    expect(listRequests()).toHaveLength(2);
  });

  it("ends another session, and loads the list again from the backend", async () => {
    api.on("GET", "/auth/sessions", json(200, [current, other1, other2]), json(200, [current, other2]));
    api.on("DELETE", `/auth/sessions/${other1.id}`, noContent());
    const { user } = await setup();
    await rows();

    await user.click(
      screen.getByRole("button", { name: `Sign out other session 1, signed in ${formatFullDate(other1.created_at)}` }),
    );

    expect(await screen.findByText("The session was signed out.")).toBeInTheDocument();
    await waitFor(() => expect(listRequests()).toHaveLength(2));
    expect(await rows()).toEqual(["Current session", "Other session"]);
    expect(authState()).toBe("authenticated");
  });

  it("signs out every other session after asking, and says how many", async () => {
    api.on("GET", "/auth/sessions", json(200, [current, other1, other2]), json(200, [current]));
    api.on("POST", "/auth/sessions/revoke-others", json(200, { revoked_count: 2 }));
    const { user } = await setup();
    await rows();

    await user.click(screen.getByRole("button", { name: "Sign out other sessions" }));
    expect(screen.getByRole("group", { name: /Sign out of every other session\?/ })).toBeInTheDocument();
    expect(api.calls("POST")).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Sign out others" }));

    expect(await screen.findByText("Signed out of 2 other sessions.")).toBeInTheDocument();
    expect(await rows()).toEqual(["Current session"]);
    expect(screen.getByText("You aren't signed in anywhere else.")).toBeInTheDocument();
  });

  it("asks before ending the current session, then signs out here", async () => {
    api.on("GET", "/auth/sessions", json(200, [current, other1]));
    api.on("DELETE", `/auth/sessions/${current.id}`, noContent());
    const { user } = await setup();
    await rows();

    await user.click(screen.getByRole("button", { name: "Sign out this browser" }));
    expect(screen.getByRole("group", { name: "Sign out of this browser? You'll have to log in again." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(api.calls("DELETE")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(api.calls("DELETE")).toHaveLength(1);
  });

  it("lets go of the user when the list cannot be read without a session", async () => {
    const list = deferred();
    api.on("GET", "/auth/sessions", list.reply);
    await setup();

    await act(() => list.respond(json(401, { detail: "Not authenticated." })));

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});
