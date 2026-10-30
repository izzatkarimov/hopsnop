import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/auth/require-auth";
import type { StoryResponse } from "@/lib/stories";
import { api, deferred, html, json, networkError } from "@/test/api";
import { story, storyPage, viewerAuthor } from "@/test/fixtures";
import { authState, renderSignedIn } from "@/test/render";
import { StoryTray } from "./story-tray";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const LIST = "/stories?limit=50";
const HINT = "JPEG, PNG or WebP, up to 10 MB. Location, camera and other details in the file are removed.";

function preview(n: number) {
  return `blob:http://localhost/preview-${n}`;
}

beforeEach(() => {
  // jsdom has no object URLs.
  let made = 0;
  URL.createObjectURL = vi.fn(() => preview(++made));
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

function photo(name = "me.jpg", type = "image/jpeg", size = 1000): File {
  return new File([new Uint8Array(size)], name, { type });
}

async function setup(stories: StoryResponse[] = [], options: { applyAccept?: boolean } = {}) {
  api.on("GET", LIST, json(200, storyPage(stories)));
  await renderSignedIn(
    <RequireAuth>
      <StoryTray />
    </RequireAuth>,
  );
  await waitFor(() => expect(screen.queryByText("Loading stories…")).not.toBeInTheDocument());
  const user = userEvent.setup(options);
  await user.click(screen.getByRole("button", { name: "Add a story" }));
  const dialog = screen.getByRole("dialog", { name: "Add a story" });
  return {
    user,
    dialog,
    picture: within(dialog).getByLabelText("Choose picture") as HTMLInputElement,
    caption: within(dialog).getByLabelText("Caption"),
    publish: within(dialog).getByRole("button", { name: "Publish" }),
  };
}

const uploads = () => api.calls("POST", "/stories");

describe("AddStoryDialog: choosing a picture", () => {
  it("shows the chosen picture, and lets go of each preview once it is no longer shown", async () => {
    const { user, dialog, picture, publish } = await setup();
    expect(publish).toBeDisabled();
    expect(picture).toHaveAccessibleDescription(HINT);

    await user.upload(picture, photo("first.jpg"));
    expect(within(dialog).getByAltText("Preview of the chosen picture")).toHaveAttribute("src", preview(1));
    expect(publish).toBeEnabled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await user.upload(picture, photo("second.jpg"));
    expect(within(dialog).getByAltText("Preview of the chosen picture")).toHaveAttribute("src", preview(2));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview(1));

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview(2));
    expect(screen.getByRole("button", { name: "Add a story" })).toHaveFocus();
    expect(uploads()).toEqual([]);
  });

  it("closes with Esc and lets go of the preview", async () => {
    const { user, picture } = await setup();
    await user.upload(picture, photo());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview(1));
  });

  it.each([
    ["a file that is not a picture", photo("notes.txt", "text/plain"), "Choose a JPEG, PNG or WebP picture."],
    ["a picture larger than 10 MB", photo("big.jpg", "image/jpeg", 10 * 1024 * 1024 + 1), "Choose a picture of at most 10 MB."],
  ])("refuses %s before sending anything", async (_, file, message) => {
    const { user, dialog, picture, publish } = await setup([], { applyAccept: false });

    await user.upload(picture, file);

    expect(picture).toHaveAccessibleDescription(message);
    expect(within(dialog).queryByAltText("Preview of the chosen picture")).not.toBeInTheDocument();
    expect(publish).toBeDisabled();
    expect(uploads()).toEqual([]);
  });
});

describe("AddStoryDialog: the caption", () => {
  it("counts the caption's characters as they are typed, an emoji as one", async () => {
    const { user, caption } = await setup();
    expect(caption).toHaveAccessibleDescription("0 / 150");

    await user.type(caption, "Hi 👋");

    expect(caption).toHaveAccessibleDescription("4 / 150");
  });

  it("refuses a caption over 150 characters before sending anything", async () => {
    const { user, picture, caption, publish } = await setup();
    await user.upload(picture, photo());
    await user.click(caption);
    await user.paste("a".repeat(151));

    await user.click(publish);

    expect(caption).toHaveAccessibleDescription("Use at most 150 characters.");
    expect(caption).toHaveFocus();
    expect(uploads()).toEqual([]);
  });
});

describe("AddStoryDialog: publishing", () => {
  it("sends the picture and the caption, adds the story to Your story without reloading, and says so", async () => {
    api.on("POST", "/stories", json(201, story(0, viewerAuthor, { caption: "Good morning" })));
    const { user, picture, caption, publish } = await setup([story(5, viewerAuthor)]);
    const file = photo();
    await user.upload(picture, file);
    await user.type(caption, "  Good morning  ");

    await user.click(publish);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const form = uploads()[0].body as FormData;
    expect(form.get("image")).toBe(file);
    expect(form.get("caption")).toBe("Good morning");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview(1));
    expect(screen.getByRole("status")).toHaveTextContent("Your story was published.");
    expect(screen.getByRole("button", { name: "Add a story" })).toHaveFocus();
    expect(api.calls("GET", LIST)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Your story" }));
    const viewer = screen.getByRole("dialog", { name: "Your story" });
    expect(within(viewer).getByText("Story 1 of 2")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(within(viewer).getByText("Story 2 of 2")).toBeInTheDocument();
    expect(within(viewer).getByText("Good morning")).toBeInTheDocument();
  });

  it("gives one who had no story a Your story button with the new one", async () => {
    api.on("POST", "/stories", json(201, story(0, viewerAuthor)));
    const { user, picture, publish } = await setup();
    expect(screen.queryByRole("button", { name: "Your story" })).not.toBeInTheDocument();
    await user.upload(picture, photo());

    await user.click(publish);

    expect(await screen.findByRole("button", { name: "Your story" })).toBeInTheDocument();
    expect([...(uploads()[0].body as FormData).keys()]).toEqual(["image"]);
  });

  it("publishes once however often it is submitted, and stays open until the backend answers", async () => {
    const answer = deferred();
    api.on("POST", "/stories", answer.reply);
    const { user, dialog, picture, publish } = await setup();
    await user.upload(picture, photo());
    const form = publish.closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(uploads()).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Add a story" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Publishing…" })).toBeDisabled();

    await act(() => answer.respond(json(201, story(0, viewerAuthor))));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(uploads()).toHaveLength(1);
  });
});

describe("AddStoryDialog: when the backend does not take it", () => {
  it.each([
    [
      "a file it cannot read",
      json(422, { detail: "The file is not a JPEG, PNG or WebP picture that can be read." }),
      "The file is not a JPEG, PNG or WebP picture that can be read.",
    ],
    ["a file that is too large", json(413, { detail: "Request body too large." }), "The file is too large."],
    ["a file too large for a proxy on the way", html(413), "The file is too large."],
    [
      "an address that is not verified",
      json(403, { detail: "Email address is not verified." }),
      "Verify your email address before adding a story.",
    ],
  ])("says so on the picture for %s, and keeps what was chosen", async (_, reply, message) => {
    api.on("POST", "/stories", reply);
    const { user, dialog, picture, caption, publish } = await setup();
    await user.upload(picture, photo());
    await user.type(caption, "Hello");

    await user.click(publish);

    await waitFor(() => expect(picture).toHaveAccessibleDescription(message));
    expect(picture).toHaveFocus();
    expect(caption).toHaveValue("Hello");
    expect(within(dialog).getByAltText("Preview of the chosen picture")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Your story" })).not.toBeInTheDocument();
  });

  it("says so on the caption when the backend refuses it", async () => {
    api.on(
      "POST",
      "/stories",
      json(422, {
        detail: [{ loc: ["body", "caption"], msg: "String should have at most 150 characters", type: "string_too_long" }],
      }),
    );
    const { user, picture, caption, publish } = await setup();
    await user.upload(picture, photo());
    await user.type(caption, "Hello");

    await user.click(publish);

    await waitFor(() => expect(caption).toHaveAccessibleDescription("String should have at most 150 characters"));
    expect(caption).toHaveFocus();
    expect(picture).toHaveAccessibleDescription(HINT);
  });

  it("asks to wait when too many pictures were uploaded", async () => {
    api.on("POST", "/stories", json(429, { detail: "Too many requests." }, { "Retry-After": "120" }));
    const { user, dialog, picture, publish } = await setup();
    await user.upload(picture, photo());

    await user.click(publish);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Too many attempts. Please wait about 2 minutes before trying again.",
    );
    expect(within(dialog).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("offers to try again when Hopsnop could not be reached, with the same picture and caption", async () => {
    api.on("POST", "/stories", networkError(), json(201, story(0, viewerAuthor, { caption: "Hello" })));
    const { user, dialog, picture, caption, publish } = await setup();
    const file = photo();
    await user.upload(picture, file);
    await user.type(caption, "Hello");

    await user.click(publish);

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't reach Hopsnop. Check your connection and try again.");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(uploads()).toHaveLength(2);
    const retried = uploads()[1].body as FormData;
    expect(retried.get("image")).toBe(file);
    expect(retried.get("caption")).toBe("Hello");
    expect(screen.getByRole("button", { name: "Your story" })).toBeInTheDocument();
  });

  it("ends the session when the API no longer has one", async () => {
    api.on("POST", "/stories", json(401, { detail: "Not authenticated." }));
    const { user, picture, publish } = await setup();
    await user.upload(picture, photo());

    await user.click(publish);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});
