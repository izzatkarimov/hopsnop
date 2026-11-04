import { render, screen } from "@testing-library/react";
import { decodeQR } from "qr/decode.js";
import { describe, expect, it } from "vitest";
import { TWO_FACTOR_SETUP } from "@/test/fixtures";
import { QrCode } from "./qr-code";

const URI = TWO_FACTOR_SETUP.otpauth_uri;
const LABEL = "QR code for your authenticator app. If you can't scan it, enter the setup key shown below it instead.";
const MODULE = /M(\d+) (\d+)h1v1h-1z/g;

function drawn() {
  const svg = screen.getByRole("img", { name: LABEL });
  const size = Number(svg.getAttribute("viewBox")!.split(" ")[3]);
  const d = svg.querySelector("path")!.getAttribute("d")!;
  const dark = [...d.matchAll(MODULE)].map(([, x, y]) => [Number(x), Number(y)]);
  return { svg, size, d, dark };
}

/** What a camera would see, 4 pixels to a module. */
function photograph(size: number, dark: number[][]) {
  const scale = 4;
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const [x, y] of dark) {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = ((y * scale + dy) * width + x * scale + dx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { width, height: width, data };
}

describe("QrCode", () => {
  it("draws the URI as inline SVG that reads back as exactly that URI", () => {
    render(<QrCode value={URI} label={LABEL} />);
    const { svg, size, d, dark } = drawn();

    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg).toHaveAttribute("viewBox", `0 0 ${size} ${size}`);
    // Nothing in the path but whole modules.
    expect(d.replace(MODULE, "")).toBe("");
    expect(decodeQR(photograph(size, dark))).toBe(URI);
  });

  it("leaves a quiet zone of 4 modules around the code", () => {
    render(<QrCode value={URI} label={LABEL} />);
    const { size, dark } = drawn();

    expect(dark.length).toBeGreaterThan(0);
    for (const [x, y] of dark) {
      expect(Math.min(x, y)).toBeGreaterThanOrEqual(4);
      expect(Math.max(x, y)).toBeLessThan(size - 4);
    }
  });

  it("uses no image, no inline style and no link, so the CSP needs nothing more", () => {
    const { container } = render(<QrCode value={URI} label={LABEL} />);

    expect(container.querySelector("img, image, foreignObject, script")).toBeNull();
    expect(container.querySelectorAll("[style], [href], [src]")).toHaveLength(0);
  });

  it("draws a different code for a different URI", () => {
    const { rerender } = render(<QrCode value={URI} label={LABEL} />);
    const before = drawn().d;

    rerender(<QrCode value={URI.replace("test_viewer", "alice_92")} label={LABEL} />);

    expect(drawn().d).not.toBe(before);
    const { size, dark } = drawn();
    expect(decodeQR(photograph(size, dark))).toBe(URI.replace("test_viewer", "alice_92"));
  });
});
