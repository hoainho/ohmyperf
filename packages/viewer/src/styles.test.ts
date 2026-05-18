import { describe, expect, it } from "vitest";
import { VIEWER_CSS } from "./styles.js";

describe("VIEWER_CSS", () => {
  it("contains @media print stylesheet for B&W PDF export", () => {
    expect(VIEWER_CSS).toContain("@media print");
    expect(VIEWER_CSS).toContain('content: " (good)"');
    expect(VIEWER_CSS).toContain('content: " (needs improvement)"');
    expect(VIEWER_CSS).toContain('content: " (poor)"');
  });

  it("emits hex fallback before oklch for every design token", () => {
    const tokenLines = VIEWER_CSS.split("\n").filter((l) => l.match(/^\s*--color-[\w-]+:/));
    const seen = new Set<string>();
    for (const line of tokenLines) {
      const name = line.match(/--color-([\w-]+):/)?.[1];
      if (!name) continue;
      const isHex = line.includes("#");
      const isOklch = line.includes("oklch(");
      if (!seen.has(name) && isOklch) {
        const hasHexBefore = tokenLines.some((l) => l.includes(`--color-${name}:`) && l.includes("#"));
        expect(hasHexBefore, `--color-${name}: missing hex fallback before oklch`).toBe(true);
      }
      if (isHex || isOklch) seen.add(name);
    }
    expect(seen.size).toBeGreaterThanOrEqual(16);
  });

  it("includes :root and prefers-color-scheme dark blocks (dark mode preserved)", () => {
    expect(VIEWER_CSS).toContain(":root");
    expect(VIEWER_CSS).toContain("@media (prefers-color-scheme: dark)");
  });

  it("uses --color-* design tokens (no legacy --bg/--accent vars)", () => {
    expect(VIEWER_CSS).not.toContain("--bg:");
    expect(VIEWER_CSS).not.toContain("--accent:");
    expect(VIEWER_CSS).toContain("--color-accent-primary");
  });
});
