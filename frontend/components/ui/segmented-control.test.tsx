import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SegmentedControl, segmentPanelId, segmentTabId } from "./segmented-control";

const segments = [
  { id: "for-you", label: "For you" },
  { id: "following", label: "Following" },
  { id: "replies", label: "Replies" },
] as const;

type SegmentId = (typeof segments)[number]["id"];

function Example() {
  const [value, setValue] = useState<SegmentId>("for-you");
  return (
    <>
      <SegmentedControl label="Feed" idPrefix="feed" segments={segments} value={value} onChange={setValue} />
      <div role="tabpanel" id={segmentPanelId("feed", value)} aria-labelledby={segmentTabId("feed", value)}>
        Showing {value}
      </div>
    </>
  );
}

describe("SegmentedControl", () => {
  it("is a named tab list whose selected tab labels its panel", () => {
    render(<Example />);

    expect(screen.getByRole("tablist", { name: "Feed" })).toBeInTheDocument();
    const selected = screen.getByRole("tab", { name: "For you" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected).toHaveAttribute("aria-controls", "feed-panel-for-you");
    expect(screen.getByRole("tab", { name: "Following" })).not.toHaveAttribute("aria-controls");
    expect(screen.getByRole("tabpanel", { name: "For you" })).toHaveTextContent("Showing for-you");
  });

  it("selects a tab when it's clicked", async () => {
    render(<Example />);

    await userEvent.setup().click(screen.getByRole("tab", { name: "Following" }));

    expect(screen.getByRole("tab", { name: "Following" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Showing following");
  });

  it("moves with the arrow keys, Home and End, wrapping at the ends, with one tab stop", async () => {
    render(<Example />);
    const user = userEvent.setup();

    await user.tab();
    expect(screen.getByRole("tab", { name: "For you" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Following" })).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Replies" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Replies" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "For you" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Replies" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "For you" })).toHaveAttribute("aria-selected", "true");
  });
});
