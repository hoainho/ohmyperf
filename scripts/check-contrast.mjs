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

const VENDORED_BRANDS = ["linear-app", "stripe", "vercel"];
const VENDORED_TOKENS = ["--accent", "--success", "--warn", "--danger"];

for (const brand of VENDORED_BRANDS) {
  const brandCssPath = resolve(root, "packages/design-tokens/brands", brand, "tokens.css");
  let brandCss;
  try {
    brandCss = await readFile(brandCssPath, "utf8");
  } catch {
    console.log(`SKIP (not vendored yet): ${brand}`);
    continue;
  }
  const { fgHex, bgHex } = extractFgBgHex(brandCss);
  if (!fgHex || !bgHex) {
    failures.push(`${brand}: could not parse --bg / --fg hex from tokens.css`);
    continue;
  }
  for (const token of VENDORED_TOKENS) {
    const re = new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{6}|rgba?\\([^)]+\\))`);
    const m = brandCss.match(re);
    if (!m) {
      failures.push(`${brand}: ${token} not found in tokens.css`);
      continue;
    }
    const tokenColor = parseColor(m[1]);
    if (!tokenColor) {
      failures.push(`${brand}: ${token} = ${m[1]} could not be parsed as RGB`);
      continue;
    }
    const onBg = contrastRatioRgb(tokenColor, parseColor(bgHex));
    const onFg = contrastRatioRgb(tokenColor, parseColor(fgHex));
    const best = Math.max(onBg, onFg);
    const which = onBg >= onFg ? "vs bg" : "vs fg";
    if (best < MIN_RATIO) {
      failures.push(`${brand}/${token}: ${m[1]} → best ${best.toFixed(2)}:1 ${which} (need ≥${MIN_RATIO}:1)`);
    } else {
      console.log(`${brand}/${token}: ${m[1]} → ${onBg.toFixed(2)}:1 (vs bg ${bgHex}) / ${onFg.toFixed(2)}:1 (vs fg ${fgHex}) ✓`);
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

function extractFgBgHex(css) {
  const bg = css.match(/--bg:\s*(#[0-9a-fA-F]{6})/);
  const fg = css.match(/--fg:\s*(#[0-9a-fA-F]{6})/);
  return { fgHex: fg?.[1], bgHex: bg?.[1] };
}

function parseColor(s) {
  const t = String(s).trim();
  const hex = t.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  const rgba = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) };
  }
  return null;
}

function rgbToRelativeLuminance({ r, g, b }) {
  const ch = (v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatioRgb(a, b) {
  const la = rgbToRelativeLuminance(a);
  const lb = rgbToRelativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
