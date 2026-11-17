import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("is ticked by its label and by the keyboard", async () => {
    render(<Checkbox label="I've saved these codes" />);
    const user = userEvent.setup();
    const box = screen.getByRole("checkbox", { name: "I've saved these codes" });

    await user.click(screen.getByText("I've saved these codes"));
    expect(box).toBeChecked();

    await user.keyboard(" ");
    expect(box).not.toBeChecked();
  });

  it("is described by its hint, or by its error instead", () => {
    const { rerender } = render(<Checkbox label="Delete my account" hint="This can't be undone." />);
    const box = screen.getByRole("checkbox", { name: "Delete my account" });
    expect(box).toHaveAccessibleDescription("This can't be undone.");
    expect(box).not.toHaveAttribute("aria-invalid");

    rerender(<Checkbox label="Delete my account" hint="This can't be undone." error="Tick the box to confirm." />);

    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription("Tick the box to confirm.");
  });
});
