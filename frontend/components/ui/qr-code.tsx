import { useMemo } from "react";
import { encodeQR } from "qr";

// The quiet zone ISO/IEC 18004 asks for, in modules.
const BORDER = 4;

type QrCodeProps = {
  value: string;
  /** Says what the code is for and where to find the same thing as text. */
  label: string;
};

/** Built by React from the module grid: no markup string, no image URL, no CSP change. */
export function QrCode({ value, label }: QrCodeProps) {
  const grid = useMemo(
    () => encodeQR(value, "raw", { ecc: "medium", border: BORDER }),
    [value],
  );
  const size = grid.length;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="block h-auto w-full max-w-56"
    >
      {/* Fixed colours, not theme tokens: scanners need dark on light. */}
      <rect width={size} height={size} fill="#ffffff" />
      <path d={modulesPath(grid)} fill="#000000" />
    </svg>
  );
}

function modulesPath(grid: boolean[][]): string {
  const parts: string[] = [];
  grid.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return parts.join("");
}
