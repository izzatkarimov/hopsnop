import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Dialog } from "./dialog";

function Example({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  const textRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New post
      </button>
      <button type="button">Elsewhere</button>
      {open && (
        <Dialog
          title="New post"
          onClose={() => setOpen(false)}
          dismissible={dismissible}
          initialFocus={textRef}
          headerEnd="Step 1 of 2"
          footer={<Button variant="primary">Post</Button>}
        >
          <label>
            Text
            <input ref={textRef} />
          </label>
        </Dialog>
      )}
    </>
  );
}

async function open(dismissible?: boolean) {
  render(<Example dismissible={dismissible} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New post" }));
  return user;
}

describe("Dialog", () => {
  it("is a modal dialog named by its title", async () => {
    await open();

    const dialog = screen.getByRole("dialog", { name: "New post" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Step 1 of 2");
  });

  it("moves focus into the dialog as it opens", async () => {
    await open();

    expect(screen.getByLabelText("Text")).toHaveFocus();
  });

  it("closes on Escape and gives focus back to what opened it", async () => {
    const user = await open();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New post" })).toHaveFocus();
  });

  it("closes with Cancel, giving focus back the same way", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New post" })).toHaveFocus();
  });

  it("stays open, with no Cancel, while it may not be dismissed", async () => {
    const user = await open(false);

    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog", { name: "New post" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("keeps Tab inside: from the last control to the first and back", async () => {
    const user = await open();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const post = screen.getByRole("button", { name: "Post" });

    await user.tab();
    expect(post).toHaveFocus();

    await user.tab();
    expect(cancel).toHaveFocus();

    await user.tab({ shift: true });
    expect(post).toHaveFocus();
    expect(screen.getByRole("button", { name: "Elsewhere" })).not.toHaveFocus();
  });

  it("puts a header control in place of Cancel when given one", async () => {
    render(
      <Dialog title="New story" onClose={() => {}} headerStart={<Button>Back</Button>}>
        Body
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});

describe("Dialog: full screen", () => {
  function Viewer({ onKey }: { onKey?: (event: KeyboardEvent<HTMLDialogElement>) => void }) {
    const [open, setOpen] = useState(true);
    return open ? (
      <Dialog variant="fullscreen" title="Stories by Alice" onClose={() => setOpen(false)} onKeyDown={onKey}>
        <button type="button">Next</button>
      </Dialog>
    ) : (
      <p>Closed</p>
    );
  }

  it("is named by its title without showing it, and shows only what it is given", () => {
    render(<Viewer />);

    const dialog = screen.getByRole("dialog", { name: "Stories by Alice" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("hears keys first, and closes on Escape unless the key was taken", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let takeEscape = true;
    render(
      <Viewer
        onKey={(event) => {
          keys.push(event.key);
          if (event.key === "Escape" && takeEscape) event.preventDefault();
        }}
      />,
    );

    await user.keyboard("{ArrowRight}{Escape}");
    expect(keys).toEqual(["ArrowRight", "Escape"]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    takeEscape = false;
    await user.keyboard("{Escape}");
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });
});
