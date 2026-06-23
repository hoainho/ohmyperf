import { describe, expect, it } from "vitest";
import { frameChanged } from "./frame-diff.js";

describe("frameChanged", () => {
  it("first frame (no prev) is always a change", () => {
    expect(frameChanged(null, "anything", 0.01)).toBe(true);
  });

  it("byte-identical frames are not a change", () => {
    const f = "a".repeat(1000);
    expect(frameChanged(f, f, 0.01)).toBe(false);
  });

  it("frames differing well above epsilon → change", () => {
    const prev = "a".repeat(1000);
    const curr = "b".repeat(1000); // every sampled byte differs → ratio ~1.0
    expect(frameChanged(prev, curr, 0.1)).toBe(true);
  });

  it("frames differing below epsilon → no change", () => {
    const prev = "a".repeat(1000);
    // change ~0.5% of bytes; with epsilon 0.05 (5%) this is below threshold
    const arr = prev.split("");
    for (let i = 0; i < 1000; i += 200) arr[i] = "b"; // 5 of 1000 ≈ 0.5%
    const curr = arr.join("");
    expect(frameChanged(prev, curr, 0.05)).toBe(false);
  });

  it("a large length delta counts as a change even if sampled bytes match", () => {
    const prev = "a".repeat(100);
    const curr = "a".repeat(1000); // 90% length delta
    expect(frameChanged(prev, curr, 0.1)).toBe(true);
  });

  it("is deterministic", () => {
    const prev = "x".repeat(500);
    const curr = "x".repeat(400) + "y".repeat(100);
    expect(frameChanged(prev, curr, 0.02)).toBe(frameChanged(prev, curr, 0.02));
  });
});
