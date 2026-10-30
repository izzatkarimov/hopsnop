import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/auth/require-auth";
import { renderSignedIn } from "@/test/render";
import { AppShell } from "./app-shell";
import { RightRail } from "./right-rail";

// The navigation reads the current path, and RequireAuth may redirect.
vi.mock("next/navigation", () => ({
  usePathname: () => "/explore",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const FORMER_SUGGESTIONS = [
  "Tomasz Brenner",
  "tbrenner",
  "Aiko Morimoto",
  "aiko_m",
  "Priya Nair",
  "priyanair",
];

describe("RightRail", () => {
  it("suggests no people", () => {
    render(<RightRail />);

    const rail = screen.getByRole("complementary", { name: "About Hopsnop" });
    expect(within(rail).queryByRole("heading", { name: "People to know" })).not.toBeInTheDocument();
    expect(within(rail).queryByRole("list")).not.toBeInTheDocument();
    expect(within(rail).queryByRole("link")).not.toBeInTheDocument();
    for (const text of FORMER_SUGGESTIONS) {
      expect(rail).not.toHaveTextContent(text);
    }
  });

  it("still says what Hopsnop is at this stage", () => {
    render(<RightRail />);

    expect(screen.getByRole("complementary", { name: "About Hopsnop" })).toHaveTextContent(
      "Hopsnop · Early preview",
    );
  });

  it("needs no data to render: it makes no request", () => {
    render(<RightRail />);

    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });
});

describe("AppShell", () => {
  it("shows the page, the navigation and the rail, and no suggested people anywhere", async () => {
    await renderSignedIn(
      <RequireAuth>
        <AppShell>
          <p>Page content</p>
        </AppShell>
      </RequireAuth>,
    );

    expect(await screen.findByRole("main")).toHaveTextContent("Page content");
    expect(screen.getAllByRole("link", { name: "Explore" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("complementary", { name: "About Hopsnop" })).toBeInTheDocument();
    for (const text of FORMER_SUGGESTIONS) {
      expect(document.body).not.toHaveTextContent(text);
    }
  });
});
