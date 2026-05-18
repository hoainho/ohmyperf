import { describe, expect, it } from "vitest";
import { renderDonut } from "./donut.js";
import { renderHorizontalBars } from "./bar-chart.js";
import { renderCwvCard } from "./cwv-traffic-light.js";
import { classifyCwv, cwvStatusIcon } from "./cwv-thresholds.js";
import { renderSparkline } from "./sparkline.js";

describe("donut", () => {
  it("renders SVG with role=img and title for accessibility", () => {
    const svg = renderDonut(
      [
        { label: "A", value: 30 },
        { label: "B", value: 70 },
      ],
      { ariaLabel: "Test donut" },
    );
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>Test donut</title>");
    expect(svg).toContain('aria-label="Test donut"');
  });

  it("handles zero-slice empty state without throwing", () => {
    const svg = renderDonut([]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<circle");
  });

  it("strips NaN values via safeNumeric", () => {
    const svg = renderDonut([{ label: "Bad", value: Number.NaN }, { label: "Good", value: 10 }]);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");
  });
});

describe("renderHorizontalBars", () => {
  it("returns empty string for no items", () => {
    expect(renderHorizontalBars([])).toBe("");
  });

  it("renders SVG with title", () => {
    const svg = renderHorizontalBars(
      [
        { label: "Opportunity A", value: 500 },
        { label: "Opportunity B", value: 250 },
      ],
      { ariaLabel: "Top opportunities" },
    );
    expect(svg).toContain('role="img"');
    expect(svg).toContain("Top opportunities");
    expect(svg).toContain("Opportunity A");
    expect(svg).toContain("Opportunity B");
  });
});

describe("renderCwvCard", () => {
  it("renders good status when value <= good threshold", () => {
    const html = renderCwvCard(
      { median: 1500, p75: 1600, p95: 1700, mean: 1500, stdev: 50, cov: 0.03, runs: 3, droppedOutliers: 0 },
      { metric: "lcp" },
    );
    expect(html).toContain('data-cwv-status="good"');
    expect(html).toContain(">LCP<");
  });

  it("renders poor status for high LCP", () => {
    const html = renderCwvCard(
      { median: 5000, p75: 5200, p95: 5400, mean: 5050, stdev: 200, cov: 0.04, runs: 3, droppedOutliers: 0 },
      { metric: "lcp" },
    );
    expect(html).toContain('data-cwv-status="poor"');
  });

  it("falls back to unknown when no agg provided", () => {
    const html = renderCwvCard(undefined, { metric: "lcp" });
    expect(html).toContain('data-cwv-status="unknown"');
    expect(html).toContain(">—<");
  });
});

describe("classifyCwv", () => {
  it("CLS thresholds", () => {
    expect(classifyCwv("cls", 0.05)).toBe("good");
    expect(classifyCwv("cls", 0.2)).toBe("needs-improvement");
    expect(classifyCwv("cls", 0.3)).toBe("poor");
  });

  it("unknown metric returns unknown", () => {
    expect(classifyCwv("nonsense", 100)).toBe("unknown");
  });

  it("NaN value returns unknown", () => {
    expect(classifyCwv("lcp", Number.NaN)).toBe("unknown");
  });
});

describe("cwvStatusIcon", () => {
  it("returns three distinct icons + unknown placeholder", () => {
    expect(cwvStatusIcon("good")).toBe("✓");
    expect(cwvStatusIcon("needs-improvement")).toBe("!");
    expect(cwvStatusIcon("poor")).toBe("✗");
    expect(cwvStatusIcon("unknown")).toBe("—");
  });
});

describe("renderSparkline (deferred to v1.1)", () => {
  it("throws a recognisable error so callers know it's not implemented", () => {
    expect(() => renderSparkline()).toThrow(/sparkline-deferred-v1.1/);
  });
});
