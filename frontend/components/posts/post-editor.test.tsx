import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/types";
import { PostEditor } from "./post-editor";
import type { EditResult } from "./use-post-actions";

const published: Post = {
  id: "00000000-0000-4000-8000-000000000001",
  author: { id: "author-id", username: "test_viewer", displayName: "Test Viewer", avatarUrl: null },
  content: "Published text",
  parentPostId: null,
  isReply: false,
  createdAt: "2026-10-19T09:00:00.000000Z",
  updatedAt: "2026-10-19T09:00:00.000000Z",
  repostCount: 0,
  likeCount: 0,
  likedByViewer: false,
  repostedByViewer: false,
};

function setup(onSave: (content: string) => Promise<EditResult>) {
  const onClose = vi.fn();
  render(<PostEditor post={published} onSave={onSave} onClose={onClose} />);
  return {
    onClose,
    user: userEvent.setup(),
    text: screen.getByRole("textbox", { name: "Post text" }),
    save: screen.getByRole("button", { name: "Save" }),
  };
}

describe("PostEditor", () => {
  it("keeps the edited text, and says why, when the save fails", async () => {
    const onSave = vi.fn(async () => ({
      saved: false as const,
      close: false,
      message: "This text wasn't accepted. Check it and try again.",
    }));
    const { onClose, user, text, save } = setup(onSave);

    await user.clear(text);
    await user.type(text, "Edited text");
    await user.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent("This text wasn't accepted. Check it and try again.");
    expect(text).toHaveValue("Edited text");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it.each([
    ["once saved", { saved: true } as EditResult],
    ["when nothing more can be done, e.g. the post is too old", { saved: false, close: true, message: "" } as EditResult],
  ])("closes %s", async (_, result) => {
    const { onClose, user, text, save } = setup(vi.fn(async () => result));

    await user.type(text, "!");
    await user.click(save);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for text that is unchanged once trimmed", async () => {
    const onSave = vi.fn(async () => ({ saved: true }) as EditResult);
    const { onClose, user, text, save } = setup(onSave);

    await user.type(text, "   ");
    await user.click(save);

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape without saving", async () => {
    const onSave = vi.fn(async () => ({ saved: true }) as EditResult);
    const { onClose, user, text } = setup(onSave);

    await user.type(text, " and more");
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("cannot save an empty text or one over the limit", async () => {
    const { user, text, save } = setup(vi.fn(async () => ({ saved: true }) as EditResult));

    await user.clear(text);
    expect(save).toBeDisabled();

    await user.paste("a".repeat(301));
    expect(text).toBeInvalid();
    expect(save).toBeDisabled();
  });

  it("saves once, however often it is sent at the same moment", async () => {
    let finish!: (result: EditResult) => void;
    const onSave = vi.fn(() => new Promise<EditResult>((resolve) => (finish = resolve)));
    const { onClose, user, text, save } = setup(onSave);
    await user.type(text, "!");
    const form = save.closest("form")!;

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(text).toHaveAttribute("readonly");
    await act(async () => finish({ saved: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
