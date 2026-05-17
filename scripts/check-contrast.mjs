#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const cssPath = resolve(root, "apps", "website", "app", "globals.css");

const css = await readFile(cssPath, "utf8");

const tokens = [
  "--color-accent-primary",
  "--color-accent-success",
  "--color-accent-warning",
  "--color-accent-danger",
];

const lightFgL = 0.145;
const darkFgL = 0.985;
const MIN_RATIO = 3.0;

const failures = [];

for (const token of tokens) {
  const re = new RegExp(`${token}\\s*:\\s*oklch\\(([0-9.]+)\\s+[0-9.]+\\s+[0-9.]+\\s*\\)`, "g");
  const matches = [...css.matchAll(re)];
  if (matches.length === 0) {
    failures.push(`${token}: not found in globals.css`);
    continue;
  }
  for (const m of matches) {
    const L = Number(m[1]);
    const rOnDarkFg = contrastRatio(L, lightFgL);
    const rOnWhiteFg = contrastRatio(L, darkFgL);
    const tightest = Math.max(rOnDarkFg, rOnWhiteFg);
    const which = rOnDarkFg >= rOnWhiteFg ? "dark text" : "white text";
    if (tightest < MIN_RATIO) {
      failures.push(`${token}: L=${L} → best ${tightest.toFixed(2)}:1 with ${which} (need ≥${MIN_RATIO}:1 for icon/border use)`);
    } else {
      console.log(`${token}: L=${L} → ${rOnDarkFg.toFixed(2)}:1 (dark text) / ${rOnWhiteFg.toFixed(2)}:1 (white text) ✓`);
    }
  }
}

if (failures.length > 0) {
  console.error("\ncheck-contrast: FAILED");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

console.log(`\ncheck-contrast: all tokens have a foreground (dark or white) pair with ≥${MIN_RATIO}:1 contrast.`);

function contrastRatio(fgL, bgL) {
  const f = oklchLToRelativeLuminance(fgL);
  const b = oklchLToRelativeLuminance(bgL);
  const hi = Math.max(f, b);
  const lo = Math.min(f, b);
  return (hi + 0.05) / (lo + 0.05);
}

function oklchLToRelativeLuminance(L) {
  return Math.max(0, Math.min(1, Math.pow(L, 3)));
}
