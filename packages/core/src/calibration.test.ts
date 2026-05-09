import { describe, expect, it } from "vitest";
import { aggregateRuns, isReportUnstable } from "./engine.js";
import type { RunReport } from "./types.js";

function run(index: number, metrics: Record<string, number>): RunReport {
  const m: Record<string, { name: string; value: number; unit: "ms" | "score" }> = {};
  for (const [k, v] of Object.entries(metrics)) {
    m[k] = { name: k, value: v, unit: k === "cls" ? "score" : "ms" };
  }
  return {
    runIndex: index,
    cold: index === 0,
    metrics: m,
    resources: [],
    longTasks: [],
    meta: {},
  };
}

describe("aggregateRuns: outlier rejection", () => {
  it("does NOT reject outliers when N < 5", () => {
    const runs = [run(0, { lcp: 100 }), run(1, { lcp: 100 }), run(2, { lcp: 1000 })];
    const agg = aggregateRuns(runs);
    expect(agg["lcp"]!.runs).toBe(3);
    expect(agg["lcp"]!.droppedOutliers).toBe(0);
  });

  it("rejects extreme outliers via modified Z-score when N >= 5", () => {
    const runs = [
      run(0, { lcp: 100 }),
      run(1, { lcp: 102 }),
      run(2, { lcp: 99 }),
      run(3, { lcp: 101 }),
      run(4, { lcp: 100 }),
      run(5, { lcp: 100000 }),
    ];
    const agg = aggregateRuns(runs);
    expect(agg["lcp"]!.droppedOutliers).toBeGreaterThanOrEqual(1);
    expect(agg["lcp"]!.runs).toBeLessThan(6);
    expect(agg["lcp"]!.median).toBeLessThan(200);
  });

  it("computes median/p75/p95/cov on the surviving values", () => {
    const runs = [
      run(0, { lcp: 100 }),
      run(1, { lcp: 110 }),
      run(2, { lcp: 105 }),
      run(3, { lcp: 115 }),
      run(4, { lcp: 95 }),
    ];
    const agg = aggregateRuns(runs);
    const lcp = agg["lcp"]!;
    expect(lcp.runs).toBe(5);
    expect(lcp.median).toBe(105);
    expect(Number.isFinite(lcp.p75)).toBe(true);
    expect(Number.isFinite(lcp.p95)).toBe(true);
    expect(Number.isFinite(lcp.cov)).toBe(true);
    expect(lcp.cov).toBeLessThan(0.2);
  });

  it("returns droppedOutliers=0 for a single sample", () => {
    const runs = [run(0, { lcp: 42 })];
    const agg = aggregateRuns(runs);
    expect(agg["lcp"]!.runs).toBe(1);
    expect(agg["lcp"]!.median).toBe(42);
    expect(agg["lcp"]!.cov).toBe(0);
  });
});

describe("isReportUnstable", () => {
  it("flags when LCP CoV > 0.2", () => {
    const agg = aggregateRuns([
      run(0, { lcp: 100 }),
      run(1, { lcp: 200 }),
      run(2, { lcp: 80 }),
      run(3, { lcp: 250 }),
    ]);
    expect(isReportUnstable(agg)).toBe(true);
  });

  it("does NOT flag when all CWVs are tight", () => {
    const agg = aggregateRuns([
      run(0, { lcp: 100, cls: 0.01, fcp: 80 }),
      run(1, { lcp: 102, cls: 0.01, fcp: 81 }),
      run(2, { lcp: 99, cls: 0.01, fcp: 80 }),
    ]);
    expect(isReportUnstable(agg)).toBe(false);
  });

  it("does NOT flag based on non-CWV metrics like tbt", () => {
    const agg = aggregateRuns([
      run(0, { tbt: 0 }),
      run(1, { tbt: 1000 }),
    ]);
    expect(isReportUnstable(agg)).toBe(false);
  });
});
