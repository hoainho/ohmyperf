import { describe, expect, it } from "vitest";
import { safeNumeric, safeUrl } from "./escape.js";

describe("safeUrl", () => {
  it("rejects javascript: scheme", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("JavaScript:alert(1)")).toBe("#");
    expect(safeUrl("  javascript:alert(1)")).toBe("#");
  });

  it("rejects data: scheme", () => {
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
  });

  it("rejects vbscript: scheme", () => {
    expect(safeUrl("vbscript:msgbox(1)")).toBe("#");
  });

  it("escapes safe HTTPS URLs", () => {
    expect(safeUrl("https://example.com/page?q=1&r=2")).toBe(
      "https://example.com/page?q=1&amp;r=2",
    );
  });

  it("escapes script tags embedded in URLs", () => {
    expect(safeUrl("https://x.com/<script>alert(1)</script>")).toBe(
      "https://x.com/&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("returns # for null/undefined", () => {
    expect(safeUrl(null)).toBe("#");
    expect(safeUrl(undefined)).toBe("#");
  });
});

describe("safeNumeric", () => {
  it("passes through finite numbers", () => {
    expect(safeNumeric(42)).toBe(42);
    expect(safeNumeric(0)).toBe(0);
    expect(safeNumeric(-3.14)).toBe(-3.14);
  });

  it("coerces numeric strings", () => {
    expect(safeNumeric("123")).toBe(123);
    expect(safeNumeric("3.14")).toBe(3.14);
  });

  it("rejects NaN", () => {
    expect(safeNumeric(NaN)).toBe(0);
    expect(safeNumeric(NaN, 99)).toBe(99);
  });

  it("rejects Infinity", () => {
    expect(safeNumeric(Infinity)).toBe(0);
    expect(safeNumeric(-Infinity, 99)).toBe(99);
  });

  it("rejects strings that don't parse", () => {
    expect(safeNumeric("abc")).toBe(0);
    expect(safeNumeric("abc", -1)).toBe(-1);
  });

  it("rejects null/undefined", () => {
    expect(safeNumeric(null)).toBe(0);
    expect(safeNumeric(undefined, 42)).toBe(42);
  });
});
