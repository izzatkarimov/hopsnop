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
const HINT = "JPG, PNG or WebP, up to 10 MB";
const PREVIEW = "Preview of the chosen photo";

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

function image(name = "me.jpg", type = "image/jpeg", size = 1000): File {
  return new File([new Uint8Array(size)], name, { type });
}

type User = ReturnType<typeof userEvent.setup>;

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
  return { user, dialog: screen.getByRole("dialog", { name: "New story" }) };
}

function choosePhoto(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByLabelText(/^Choose (another )?photo$/);
}

function nextButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Next" });
}

function dropZone() {
  return screen.getByTestId("photo-drop-zone");
}

/** Chooses a photo and goes on to the caption. */
async function toDetails(user: User, dialog: HTMLElement, file = image()) {
  await user.upload(choosePhoto(dialog), file);
  await user.click(nextButton(dialog));
  return {
    caption: within(dialog).getByLabelText("Caption"),
    replace: within(dialog).getByLabelText("Replace photo") as HTMLInputElement,
    share: within(dialog).getByRole("button", { name: "Share story" }),
  };
}

const uploads = () => api.calls("POST", "/stories");

describe("AddStoryDialog: choosing a photo", () => {
  it("opens ready to choose, offers Next only once a photo is chosen, and lets go of each preview", async () => {
    const { user, dialog } = await setup();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(choosePhoto(dialog)).toHaveFocus();
    expect(choosePhoto(dialog)).toHaveAccessibleDescription(HINT);
    expect(nextButton(dialog)).toBeDisabled();

    await user.upload(choosePhoto(dialog), image("first.jpg"));
    expect(within(dialog).getByAltText(PREVIEW)).toHaveAttribute("src", preview(1));
    expect(within(dialog).getByLabelText("Choose another photo")).toBeInTheDocument();
    expect(nextButton(dialog)).toBeEnabled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await user.upload(choosePhoto(dialog), image("second.jpg"));
    expect(within(dialog).getByAltText(PREVIEW)).toHaveAttribute("src", preview(2));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview(1));

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview(2));
    expect(screen.getByRole("button", { name: "Add a story" })).toHaveFocus();
    expect(uploads()).toEqual([]);
  });

  it("takes a photo dropped on it", async () => {
    const { dialog } = await setup();

    fireEvent.dragEnter(dropZone());
    fireEvent.dragOver(dropZone());
    fireEvent.drop(dropZone(), { dataTransfer: { files: [image()] } });

    expect(within(dialog).getByAltText(PREVIEW)).toHaveAttribute("src", preview(1));
    expect(nextButton(dialog)).toBeEnabled();
  });

  it.each([
    ["a file that is not a picture", image("notes.txt", "text/plain"), "Choose a JPEG, PNG or WebP picture."],
    ["a picture larger than 10 MB", image("big.jpg", "image/jpeg", 10 * 1024 * 1024 + 1), "Choose a picture of at most 10 MB."],
  ])("refuses %s before sending anything, chosen or dropped", async (_, file, message) => {
    const { user, dialog } = await setup([], { applyAccept: false });

    await user.upload(choosePhoto(dialog), file);
    expect(choosePhoto(dialog)).toHaveAccessibleDescription(message);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(message);

    fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });
    expect(choosePhoto(dialog)).toHaveAccessibleDescription(message);

    expect(within(dialog).queryByAltText(PREVIEW)).not.toBeInTheDocument();
    expect(nextButton(dialog)).toBeDisabled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(uploads()).toEqual([]);
  });

  it("says only what is true of every story", async () => {
    const { dialog } = await setup();

    expect(within(dialog).getByText("Stories disappear after 24 hours.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("We remove location and camera details from your photo."),
    ).toBeInTheDocument();
  });

  it("closes with Esc, without asking, and lets go of the preview", async () => {
    const { user, dialog } = await setup();
    await user.upload(choosePhoto(dialog), image());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview(1));
  });
});

describe("AddStoryDialog: the second step", () => {
  it("goes to the caption with Next, and back with Back, keeping the photo and the caption", async () => {
    const { user, dialog } = await setup();

    const { caption } = await toDetails(user, dialog);
    expect(caption).toHaveFocus();
    expect(within(dialog).getByAltText(PREVIEW)).toHaveAttribute("src", preview(1));
    expect(within(dialog).queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    await user.type(caption, "Morning");

    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(choosePhoto(dialog)).toHaveFocus();
    expect(within(dialog).getByAltText(PREVIEW)).toHaveAttribute("src", preview(1));

    await user.click(nextButton(dialog));
    expect(within(dialog).getByLabelText("Caption")).toHaveValue("Morning");
    expect(screen.getByRole("dialog", { name: "New story" })).toBe(dialog);
  });

  it("replaces the photo, and keeps it when the new one is refused", async () => {
    const { user, dialog } = await setup([], { applyAccept: false });
    const { replace } = await toDetails(user, dialog);

    await user.upload(replace, image("other.png", "image/png"));
    expect(within(dialog).getByAltText(PREVIEW)).toHaveAttribute("src", preview(2));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview(1));

    await user.upload(replace, image("notes.txt", "text/plain"));
    expect(replace).toHaveAccessibleDescription("Choose a JPEG, PNG or WebP picture.");
    expect(within(dialog).getByAltText(PREVIEW)).toHaveAttribute("src", preview(2));
  });

  it("closes from Cancel and with Esc, without asking", async () => {
    const { user, dialog } = await setup();
    await toDetails(user, dialog);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(preview(1));

    await user.click(screen.getByRole("button", { name: "Add a story" }));
    await toDetails(user, screen.getByRole("dialog", { name: "New story" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(uploads()).toEqual([]);
  });
});

describe("AddStoryDialog: the caption", () => {
  it("counts the caption's characters as they are typed, an emoji as one", async () => {
    const { user, dialog } = await setup();
    const { caption } = await toDetails(user, dialog);
    expect(caption).toHaveAccessibleDescription("0 / 150");

    await user.type(caption, "Hi 👋");

    expect(caption).toHaveAccessibleDescription("4 / 150");
  });

  it("refuses a caption over 150 characters before sending anything", async () => {
    const { user, dialog } = await setup();
    const { caption, share } = await toDetails(user, dialog);
    await user.click(caption);
    await user.paste("a".repeat(151));

    await user.click(share);

    expect(caption).toHaveAccessibleDescription("Use at most 150 characters.");
    expect(caption).toHaveFocus();
    expect(uploads()).toEqual([]);
  });
});

describe("AddStoryDialog: sharing", () => {
  it("sends the photo and the caption, adds the story to Your story without reloading, and says so", async () => {
    api.on("POST", "/stories", json(201, story(0, viewerAuthor, { caption: "Good morning" })));
    const { user, dialog } = await setup([story(5, viewerAuthor)]);
    const file = image();
    const { caption, share } = await toDetails(user, dialog, file);
    await user.type(caption, "  Good morning  ");

    await user.click(share);

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

  it("gives one who had no story a Your story button with the new one, and sends no blank caption", async () => {
    api.on("POST", "/stories", json(201, story(0, viewerAuthor)));
    const { user, dialog } = await setup();
    expect(screen.queryByRole("button", { name: "Your story" })).not.toBeInTheDocument();
    const { share } = await toDetails(user, dialog);

    await user.click(share);

    expect(await screen.findByRole("button", { name: "Your story" })).toBeInTheDocument();
    expect([...(uploads()[0].body as FormData).keys()]).toEqual(["image"]);
  });

  it("shares once however often it is sent, and can't be closed or left until the backend answers", async () => {
    const answer = deferred();
    api.on("POST", "/stories", answer.reply);
    const { user, dialog } = await setup();
    const { caption } = await toDetails(user, dialog);
    const form = caption.closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(uploads()).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "New story" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Sharing…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Back" })).toBeDisabled();

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
  ])("says so on the photo for %s, and keeps what was chosen", async (_, reply, message) => {
    api.on("POST", "/stories", reply);
    const { user, dialog } = await setup();
    const { caption, replace, share } = await toDetails(user, dialog);
    await user.type(caption, "Hello");

    await user.click(share);

    await waitFor(() => expect(replace).toHaveAccessibleDescription(message));
    expect(replace).toHaveFocus();
    expect(caption).toHaveValue("Hello");
    expect(within(dialog).getByAltText(PREVIEW)).toBeInTheDocument();
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
    const { user, dialog } = await setup();
    const { caption, replace, share } = await toDetails(user, dialog);
    await user.type(caption, "Hello");

    await user.click(share);

    await waitFor(() => expect(caption).toHaveAccessibleDescription("String should have at most 150 characters"));
    expect(caption).toHaveFocus();
    expect(replace).not.toHaveAccessibleDescription();
  });

  it("asks to wait when too many pictures were uploaded", async () => {
    api.on("POST", "/stories", json(429, { detail: "Too many requests." }, { "Retry-After": "120" }));
    const { user, dialog } = await setup();
    const { share } = await toDetails(user, dialog);

    await user.click(share);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Too many attempts. Please wait about 2 minutes before trying again.",
    );
    expect(within(dialog).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("offers to try again when Hopsnop could not be reached, with the same photo and caption", async () => {
    api.on("POST", "/stories", networkError(), json(201, story(0, viewerAuthor, { caption: "Hello" })));
    const { user, dialog } = await setup();
    const file = image();
    const { caption, share } = await toDetails(user, dialog, file);
    await user.type(caption, "Hello");

    await user.click(share);

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
    const { user, dialog } = await setup();
    const { share } = await toDetails(user, dialog);

    await user.click(share);

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
  });
});
