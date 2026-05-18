import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isInteractiveContext } from "./run-interactive.js";

describe("isInteractiveContext", () => {
  it("returns false in test environment (vitest is not a TTY)", () => {
    expect(isInteractiveContext()).toBe(false);
  });
});

describe("run-interactive.ts source-level invariants (regression guards)", () => {
  const src = readFileSync(new URL("./run-interactive.ts", import.meta.url), "utf8");

  it("Chromium binary path prompt does NOT set 'placeholder' — clack 0.4 quirk would submit placeholder on Enter", () => {
    const start = src.indexOf("Chromium binary path");
    const end = src.indexOf("if (p.isCancel(browserPathRaw))");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/placeholder\s*:/);
  });

  it("URL prompt does NOT set 'placeholder' — would bleed example.com into measurement on empty Enter", () => {
    const start = src.indexOf("URL to measure");
    const end = src.indexOf("if (p.isCancel(url))");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/placeholder\s*:/);
  });

  it("Output directory prompt uses defaultValue (NOT placeholder) for blank-Enter handling", () => {
    const start = src.indexOf('"Output directory"');
    const end = src.indexOf("if (p.isCancel(outputRaw))");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).toMatch(/defaultValue\s*:\s*"\.\/ohmyperf-out"/);
    expect(block).not.toMatch(/placeholder\s*:/);
  });

  it("Number of runs prompt does NOT set 'placeholder' — initialValue is the real default", () => {
    const start = src.indexOf("Number of runs");
    const end = src.indexOf("if (p.isCancel(runsRaw))");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/placeholder\s*:/);
  });

  it("Documents the @clack/core placeholder quirk so future edits don't re-introduce the bug", () => {
    expect(src).toMatch(/@clack\/core 0\.4.*quirk/i);
  });

  it("Expands ~ in paths via os.homedir() (browser-path + output)", () => {
    expect(src).toMatch(/function expandHome/);
    expect(src).toMatch(/expandHome\(browserPathTrimmed/);
    expect(src).toMatch(/expandHome\(outputTrimmed/);
  });

  it("Empty browserPath normalizes to undefined (not the empty string)", () => {
    expect(src).toMatch(/browserPathTrimmed\.length > 0 \? expandHome\(browserPathTrimmed\) : undefined/);
  });

  it("Summary box shows Browser=(Playwright bundled) when path is empty (not placeholder text)", () => {
    expect(src).toMatch(/browserPath \? pc\.cyan\(browserPath\) : pc\.dim\("\(Playwright bundled\)"\)/);
  });

  it("Source no longer references the broken 'leave blank to use Playwright bundled' string literal", () => {
    expect(src).not.toContain("leave blank to use Playwright bundled");
  });
});
