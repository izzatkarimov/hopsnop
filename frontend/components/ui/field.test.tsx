import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Field, TextAreaField } from "./field";
import { IconButton } from "./icon-button";
import { IconMail } from "./icons";

describe("Field", () => {
  it("is labelled, and described by its hint", () => {
    render(<Field label="Username" hint="3 to 30 letters, numbers or underscores." />);

    const input = screen.getByLabelText("Username");
    expect(input).toHaveAccessibleDescription("3 to 30 letters, numbers or underscores.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("shows an error instead of the hint, marks the input invalid and links the two", () => {
    render(
      <Field
        label="Username"
        hint="3 to 30 letters, numbers or underscores."
        error="That username is already taken."
      />,
    );

    const input = screen.getByLabelText("Username");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("That username is already taken.");
    expect(screen.queryByText("3 to 30 letters, numbers or underscores.")).not.toBeInTheDocument();
  });

  it("goes back to the hint once the error is gone", () => {
    const { rerender } = render(<Field label="Email" hint="We never show it." error="Enter your email address." />);

    rerender(<Field label="Email" hint="We never show it." error={null} />);

    const input = screen.getByLabelText("Email");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("We never show it.");
  });

  it("keeps the prefix out of the label and the value", async () => {
    render(<Field label="Username" prefix="@" />);
    const input = screen.getByLabelText("Username");

    await userEvent.setup().type(input, "alice_92");

    expect(input).toHaveValue("alice_92");
    expect(input).toHaveAccessibleName("Username");
    expect(screen.getByText("@")).toHaveAttribute("aria-hidden", "true");
  });

  it("hides an icon prefix from assistive technology", () => {
    render(<Field label="Email" prefix={<IconMail />} />);

    expect(screen.getByLabelText("Email").parentElement!.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("puts a trailing control next to the input, reachable from the keyboard", async () => {
    render(<Field label="Password" trailing={<IconButton label="Show password" icon={null} />} />);
    const user = userEvent.setup();

    await user.tab();
    expect(screen.getByLabelText("Password")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Show password" })).toHaveFocus();
  });
});

describe("TextAreaField", () => {
  it("shows an error the same way", () => {
    render(<TextAreaField label="Bio" hint="Up to 160 characters." error="Use at most 160 characters." />);

    const textarea = screen.getByLabelText("Bio");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAccessibleDescription("Use at most 160 characters.");
  });
});
