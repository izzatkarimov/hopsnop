import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavigationHistoryProvider, useHasNavigated } from "./navigation-history";

const nav = vi.hoisted(() => ({ pathname: "/posts/1" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

function Probe() {
  return <p>{useHasNavigated() ? "navigated" : "first page"}</p>;
}

describe("NavigationHistoryProvider", () => {
  it("knows once the tab has moved to another page here", () => {
    nav.pathname = "/posts/1";
    const ui = () => (
      <NavigationHistoryProvider>
        <Probe />
      </NavigationHistoryProvider>
    );
    const { rerender } = render(ui());
    expect(screen.getByText("first page")).toBeInTheDocument();

    nav.pathname = "/";
    rerender(ui());
    expect(screen.getByText("navigated")).toBeInTheDocument();

    nav.pathname = "/posts/1";
    rerender(ui());
    expect(screen.getByText("navigated")).toBeInTheDocument();
  });

  it("says no outside the app's shell", () => {
    render(<Probe />);

    expect(screen.getByText("first page")).toBeInTheDocument();
  });
});
