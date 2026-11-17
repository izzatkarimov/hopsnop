import { useEffect, useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/auth/require-auth";
import { api, noContent } from "@/test/api";
import { authState, renderSignedIn } from "@/test/render";
import { AppShell } from "./app-shell";

const nav = vi.hoisted(() => ({
  pathname: "/",
  go: (href: string) => void href,
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav.router,
}));

beforeEach(() => {
  nav.pathname = "/";
  // Like the router: a push shows the other page.
  nav.router.push.mockImplementation((href: string) => nav.go(href));
});

/** Stands in for the pages, following the router. */
function Pages() {
  const [pathname, setPathname] = useState(nav.pathname);
  useEffect(() => {
    nav.go = (href) => {
      nav.pathname = href;
      setPathname(href);
    };
  }, []);

  return <p>{pathname === "/" ? "Home page" : "Another page"}</p>;
}

async function renderShell() {
  await renderSignedIn(
    <RequireAuth>
      <AppShell>
        <Pages />
      </AppShell>
    </RequireAuth>,
  );
  return userEvent.setup();
}

function sidebarNav() {
  return screen.getAllByRole("navigation", { name: "Primary" })[0];
}

describe("AppShell", () => {
  it("links to Home, Search, Settings and Profile, and to no notifications", async () => {
    await renderShell();

    const links = within(sidebarNav()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Home", "Search", "Settings", "Profile"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/search",
      "/settings",
      "/profile",
    ]);
    expect(document.body).not.toHaveTextContent(/notification/i);
  });

  it("marks the current page in every navigation", async () => {
    nav.pathname = "/search";
    await renderShell();

    for (const link of screen.getAllByRole("link", { name: "Search" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    for (const link of screen.getAllByRole("link", { name: "Home" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("lets keyboard users skip to the page", async () => {
    await renderShell();

    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("opens the New post dialog from the sidebar, on any page, without leaving it", async () => {
    nav.pathname = "/settings";
    const user = await renderShell();

    await user.click(screen.getAllByRole("button", { name: "New post" })[0]);

    expect(screen.getByRole("dialog", { name: "New post" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Write a post" })).toHaveFocus();
    expect(screen.getByText("Another page")).toBeInTheDocument();
    expect(nav.router.push).not.toHaveBeenCalled();
  });

  it("opens it from the phone bar too, and gives focus back on closing", async () => {
    const user = await renderShell();
    const bars = screen.getAllByRole("navigation", { name: "Primary" });
    const button = within(bars[1]).getByRole("button", { name: "New post" });

    await user.click(button);
    expect(screen.getByRole("dialog", { name: "New post" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("shows who is signed in, linking to their profile", async () => {
    await renderShell();

    expect(screen.getByRole("link", { name: "Test Viewer @test_viewer" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });

  it("logs out in one click from the sidebar", async () => {
    api.on("POST", "/auth/logout", noContent());
    const user = await renderShell();

    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(authState()).toBe("unauthenticated"));
    expect(api.calls("POST", "/auth/logout")).toHaveLength(1);
  });
});
