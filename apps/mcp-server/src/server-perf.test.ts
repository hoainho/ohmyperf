import { describe, expect, it } from "vitest";
import { selectLargestResources, type PerfSummary, type Report } from "@ohmyperf/core";
import { extractInsight, summarize } from "./server.js";

function baseReport(over: Partial<Report> = {}): Report {
  return {
    schemaVersion: "1.0.0",
    meta: {
      url: "https://example.com",
      startedAt: "2026-06-24T00:00:00.000Z",
      durationMs: 1000,
      runs: 3,
      mode: "real",
      browser: { name: "chromium", version: "148.0", source: "bundled" },
      host: { os: "linux", arch: "x64", nodeVersion: "v22" },
      parity: { mode: "headless", knownDeltas: {} },
      emulation: false,
      pluginCapabilityUses: [],
      measurementId: "m_v040",
    },
    runs: [{ runIndex: 0, cold: true, metrics: {}, resources: [], longTasks: [], meta: {} }],
    aggregated: {},
    frames: { root: "r", nodes: {} },
    audits: [],
    artifacts: {},
    pluginData: {},
    ...over,
  } as unknown as Report;
}

const PERF: PerfSummary = {
  timing: { ttfbMs: 120, fcpMs: 800, lcpMs: 1500, dclMs: 600, loadEventMs: 1800, networkIdleMs: 2000, fullLoadMs: 2100, gatingPhase: "main-thread" },
  network: {
    totalRequests: 42,
    totalTransferBytes: 1_200_000,
    byType: { js: { count: 10, bytes: 800_000 }, css: { count: 3, bytes: 90_000 } },
    cachedRequests: 5,
    cachedBytes: 40_000,
    firstPartyBytes: 900_000,
    thirdPartyBytes: 300_000,
    renderBlockingCount: 4,
    largestResources: [{ url: "https://x/app.js", bytes: 800_000 }],
    slowestRequests: [{ url: "https://x/api", responseMs: 500 }],
    failedRequestCount: 2,
    failedRequests: [{ url: "https://x/404.js", status: 404 }],
  },
  javascript: { transferBytes: 800_000, requestCount: 10, parseCompileMs: 14, executionMs: 126, mainThreadBlockingMs: 320, topBlockingScripts: [{ url: "https://x/app.js", blockingMs: 200 }] },
  mainThread: { totalTaskMs: 720, longTaskCount: 8, totalBlockingMs: 250, layoutMs: 9, recalcStyleMs: 11 },
  errors: { jsErrorCount: 2, jsErrors: [], consoleErrorCount: 5, consoleWarningCount: 3, consoleSamples: [], firstPartyErrorCount: 1, failedRequestCount: 2 },
  stability: { cls: 0.02, thirdPartyCount: 2, thirdPartyMainThreadMs: 320, trust: "high", servability: "real-page" },
};

describe("S7 MCP perf insights", () => {
  it("perf-summary insight returns the whole rollup", () => {
    const slice = extractInsight(baseReport({ perfSummary: PERF }), "perf-summary", 20);
    expect(slice.data).toEqual(PERF);
    expect(slice.summary).toMatch(/Full-Load 2100ms/);
    expect(slice.summary).toMatch(/2 JS/); // errors line
  });

  it("network / javascript / errors insights return their group", () => {
    const r = baseReport({ perfSummary: PERF });
    expect(extractInsight(r, "network", 20).data).toEqual(PERF.network);
    expect(extractInsight(r, "javascript", 20).data).toEqual(PERF.javascript);
    expect(extractInsight(r, "errors", 20).data).toEqual(PERF.errors);
    expect(extractInsight(r, "network", 20).summary).toMatch(/42 request/);
    expect(extractInsight(r, "javascript", 20).summary).toMatch(/exec 126ms/);
    expect(extractInsight(r, "errors", 20).summary).toMatch(/5 console error/);
  });

  it("all 4 insights degrade gracefully when perfSummary absent", () => {
    const r = baseReport();
    for (const name of ["perf-summary", "network", "javascript", "errors"] as const) {
      const slice = extractInsight(r, name, 20);
      expect(slice.data).toBeNull();
      expect(slice.summary).toMatch(/predates v0\.3\.0|rerun `measure`/i);
    }
  });

  it("resources insight uses the SHARED selectLargestResources ordering", () => {
    const resources = [
      { url: "https://x/a.js", mimeType: "application/javascript", requestMs: 0, responseMs: 10, transferSizeBytes: 100, encodedSizeBytes: 100, decodedSizeBytes: 100, renderBlocking: false, cacheHit: false },
      { url: "https://x/b.css", mimeType: "text/css", requestMs: 0, responseMs: 10, transferSizeBytes: 5000, encodedSizeBytes: 5000, decodedSizeBytes: 5000, renderBlocking: true, cacheHit: false },
      { url: "https://x/c.png", mimeType: "image/png", requestMs: 0, responseMs: 10, transferSizeBytes: 800, encodedSizeBytes: 800, decodedSizeBytes: 800, renderBlocking: false, cacheHit: false },
    ];
    const r = baseReport({ runs: [{ runIndex: 0, cold: true, metrics: {}, resources, longTasks: [], meta: {} }] as unknown as Report["runs"] });
    const insight = extractInsight(r, "resources", 5).data as Array<{ url: string }>;
    const expected = selectLargestResources(resources, 5).map((x) => x.url);
    expect(insight.map((x) => x.url)).toEqual(expected);
    expect(insight[0]!.url).toBe("https://x/b.css"); // 5000 largest
  });

  it("summarize() surfaces perfSummary Network + Errors lines when present (muted), absent otherwise", () => {
    const withPs = summarize(baseReport({ perfSummary: PERF, aggregated: { lcp: { median: 1500, p75: 1600, cov: 0.05, runs: 3, p95: 1600, mean: 1500, stdev: 0, droppedOutliers: 0 } } as unknown as Report["aggregated"] }), "/tmp/r.json");
    expect(withPs).toMatch(/Network: 42 reqs, 1\.1 MB/);
    expect(withPs).toMatch(/Errors: 2 JS/);
    const withoutPs = summarize(baseReport(), "/tmp/r.json");
    expect(withoutPs).not.toMatch(/Network: \d+ reqs/);
    expect(withoutPs).not.toMatch(/^Errors:/m);
  });
});
