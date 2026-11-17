import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink } from "./button";
import { IconButton } from "./icon-button";
import { IconPlus } from "./icons";

describe("Button", () => {
  it("is named by its text, with the icon hidden from assistive technology", () => {
    render(<Button icon={<IconPlus />}>New post</Button>);

    const button = screen.getByRole("button", { name: "New post" });
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("doesn't submit a form unless it's a submit button", async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <Button>Cancel</Button>
        <Button type="submit" variant="primary">
          Save
        </Button>
      </form>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("can't be pressed while disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="danger" disabled onClick={onClick}>
        Delete account
      </Button>,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Delete account" }));

    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete account" })).toBeDisabled();
  });

  it("looks the same as a link that goes somewhere", () => {
    render(
      <ButtonLink href="/register" variant="primary" size="lg">
        Sign up
      </ButtonLink>,
    );

    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/register");
  });
});

describe("IconButton", () => {
  it("is named by its label, as the icon says nothing", async () => {
    const onClick = vi.fn();
    render(<IconButton label="Show password" icon={<IconPlus />} onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Show password" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
