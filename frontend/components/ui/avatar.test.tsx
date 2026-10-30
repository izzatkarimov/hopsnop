import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { API_URL } from "@/test/api";
import { Avatar } from "./avatar";

const person = { username: "alice_92", displayName: "Alice Example" };
const PATH = "/users/alice_92/avatar/0b6f1c3e-6a51-4c71-9a4a-0f1f2b3c4d5e";

describe("Avatar", () => {
  it("shows the picture the API serves at the path the profile names", () => {
    const { container } = render(<Avatar user={{ ...person, avatarUrl: PATH }} />);

    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", `${API_URL}${PATH}`);
    expect(image).toHaveAttribute("alt", "");
  });

  it.each([
    "https://images.example.com/alice.png",
    "//images.example.com/alice.png",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "users/alice_92/avatar/1",
    "/users/alice_92/avatar/1?x=<script>",
  ])("never puts %j into an image, and shows the initials instead", (avatarUrl) => {
    const { container } = render(<Avatar user={{ ...person, avatarUrl }} />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AE")).toBeInTheDocument();
  });

  it("shows the initials when there is no picture", () => {
    const { container } = render(<Avatar user={{ ...person, avatarUrl: null }} />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AE")).toBeInTheDocument();
  });

  it("falls back to the initials when the picture cannot be loaded", () => {
    const { container } = render(<Avatar user={{ ...person, avatarUrl: PATH }} />);

    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AE")).toBeInTheDocument();
  });
});
