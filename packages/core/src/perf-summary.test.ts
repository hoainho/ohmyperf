import { describe, expect, it } from "vitest";
import { computePerfSummary, selectLargestResources } from "./perf-summary.js";
import { computeHotspots, scriptBlockingFromLongTasks } from "./hotspots.js";
import type { AggregatedMetric, ConsoleMessage, LongTask, PageError, Report, Resource, RunReport } from "./types.js";

const agg = (median: number): AggregatedMetric => ({
  median,
  p75: median,
  p95: median,
  mean: median,
  stdev: 0,
  cov: 0,
  runs: 2,
  droppedOutliers: 0,
});

const res = (p: Partial<Resource> & { url: string }): Resource => ({
  url: p.url,
  mimeType: "",
  requestMs: 0,
  responseMs: 0,
  transferSizeBytes: 0,
  encodedSizeBytes: 0,
  decodedSizeBytes: 0,
  renderBlocking: false,
  cacheHit: false,
  ...p,
});

const lt = (url: string, duration: number): LongTask => ({
  startTime: 0,
  duration,
  attribution: "script",
  attributionRich: { url, frameId: "root" },
});

interface Fixture {
  runs: Array<Partial<RunReport>>;
  aggregated?: Record<string, AggregatedMetric>;
  audits?: Report["audits"];
  trustScore?: { overall: string };
  servability?: { classification: string };
  fullLoad?: Record<string, unknown>;
}

function makeReport(f: Fixture): Report {
  return {
    schemaVersion: "1.0.0",
    meta: { servability: f.servability } as Report["meta"],
    runs: f.runs.map((r, i) => ({
      runIndex: i,
      cold: i === 0,
      metrics: {},
      resources: [],
      longTasks: [],
      meta: {},
      ...r,
    })),
    aggregated: f.aggregated ?? {},
    frames: { root: "r", nodes: {} },
    audits: f.audits ?? [],
    artifacts: {},
    pluginData: {},
    ...(f.trustScore ? { trustScore: f.trustScore } : {}),
    ...(f.fullLoad ? { fullLoad: f.fullLoad } : {}),
  } as unknown as Report;
}

const RESOURCES: Resource[] = [
  res({ url: "https://site/app.js", mimeType: "application/javascript", transferSizeBytes: 200_000, responseMs: 300, originClass: "same-origin" }),
  res({ url: "https://site/style.css", mimeType: "text/css", transferSizeBytes: 30_000, responseMs: 80, renderBlocking: true, originClass: "same-origin" }),
  res({ url: "https://cdn.ads/track.js", mimeType: "application/javascript", transferSizeBytes: 50_000, responseMs: 500, originClass: "cross-site" }),
  res({ url: "https://site/logo.png", mimeType: "image/png", transferSizeBytes: 0, encodedSizeBytes: 8000, cacheHit: true, originClass: "same-origin" }),
  res({ url: "https://site/missing.js", mimeType: "text/html", transferSizeBytes: 100, responseMs: 20, status: 404, originClass: "same-origin" }),
  res({ url: "https://ads.blocked/x.js", failed: true, failureText: "net::ERR_BLOCKED_BY_CLIENT", originClass: "cross-site" }),
];
const LONGTASKS: LongTask[] = [lt("https://site/app.js", 120), lt("https://site/app.js", 80), lt("https://cdn.ads/track.js", 200)];
const RUNTIME_AGG = {
  "runtime.scriptDuration": agg(126),
  "runtime.v8CompileDuration": agg(14),
  "runtime.taskDuration": agg(720),
  "runtime.layoutDuration": agg(9),
  "runtime.recalcStyleDuration": agg(11),
  tbt: agg(250),
  cls: agg(0.02),
};
const TP_AUDIT = {
  id: "third-parties",
  title: "Third-party usage",
  passed: true,
  status: "pass" as const,
  score: 1,
  details: { items: [{ entity: "Ads Co", mainThreadTime: 320, transferSize: 50_000 }] },
};

describe("computePerfSummary", () => {
  it("(a) rolls up all 6 groups from verified sources", () => {
    const report = makeReport({
      runs: [{ resources: RESOURCES, longTasks: LONGTASKS }],
      aggregated: RUNTIME_AGG,
      audits: [TP_AUDIT],
      trustScore: { overall: "high" },
      servability: { classification: "real-page" },
      fullLoad: { fltMs: 2100, gatingPhase: "main-thread", subTimeline: { ttfb: 120, fcp: 800, lcp: 1500, domContentLoaded: 600, loadEventEnd: 1800, networkIdleAt: 2000 } },
    });
    const s = computePerfSummary(report);
    // timing
    expect(s.timing.fullLoadMs).toBe(2100);
    expect(s.timing.gatingPhase).toBe("main-thread");
    expect(s.timing.lcpMs).toBe(1500);
    // network
    expect(s.network.totalRequests).toBe(6);
    expect(s.network.byType["js"]).toEqual({ count: 2, bytes: 250_000 }); // app.js + track.js (missing.js is text/html)
    expect(s.network.firstPartyBytes).toBe(230_100); // app.js 200k + css 30k + missing 100 (logo cached=0)
    expect(s.network.thirdPartyBytes).toBe(50_000); // track.js (blocked x.js has 0 bytes)
    expect(s.network.renderBlockingCount).toBe(1);
    expect(s.network.cachedRequests).toBe(1);
    expect(s.network.failedRequestCount).toBe(2); // 404 + blocked
    // javascript (verified keys)
    expect(s.javascript.parseCompileMs).toBe(14);
    expect(s.javascript.executionMs).toBe(126);
    expect(s.javascript.transferBytes).toBe(250_000); // app.js + track.js (both application/javascript)
    // main-thread
    expect(s.mainThread.totalBlockingMs).toBe(250); // aggregated.tbt
    expect(s.mainThread.layoutMs).toBe(9);
    expect(s.mainThread.totalTaskMs).toBe(720);
    // stability
    expect(s.stability.cls).toBe(0.02);
    expect(s.stability.thirdPartyCount).toBe(1);
    expect(s.stability.thirdPartyMainThreadMs).toBe(320);
    expect(s.stability.trust).toBe("high");
    expect(s.stability.servability).toBe("real-page");
  });

  it("(b) DEFAULT run (no hotspots): topBlockingScripts is non-empty and equals the shared primitive", () => {
    const report = makeReport({ runs: [{ resources: RESOURCES, longTasks: LONGTASKS }], aggregated: RUNTIME_AGG });
    const s = computePerfSummary(report);
    expect(report.hotspots).toBeUndefined(); // default run — hotspots gated off
    expect(s.javascript.topBlockingScripts.length).toBeGreaterThan(0);
    const expected = scriptBlockingFromLongTasks(LONGTASKS)
      .sort((a, b) => b.costMs - a.costMs)
      .slice(0, 5)
      .map((h) => ({ url: h.selector, blockingMs: h.costMs }));
    expect(s.javascript.topBlockingScripts).toEqual(expected);
    // app.js (120+80=200) ranks above track.js (200)? tie -> both 200; just assert app.js present
    expect(s.javascript.topBlockingScripts.map((t) => t.url)).toContain("https://site/app.js");
  });

  it("(c) DIAGNOSE run: topBlockingScripts equals computeHotspots' script entries", () => {
    const diagnoseRun: Partial<RunReport> = {
      resources: RESOURCES,
      longTasks: LONGTASKS,
      domTopology: { totalNodes: 100, maxDepth: 4, viewport: { width: 1280, height: 720 }, containers: [] },
    };
    const report = makeReport({ runs: [diagnoseRun], aggregated: RUNTIME_AGG, audits: [TP_AUDIT] });
    const reportWithHotspots = { ...report, hotspots: computeHotspots(report) } as Report;
    const s = computePerfSummary(reportWithHotspots);
    const hotspotScripts = (reportWithHotspots.hotspots ?? [])
      .filter((h) => h.cause === "script")
      .sort((a, b) => b.costMs - a.costMs)
      .slice(0, 5)
      .map((h) => ({ url: h.selector, blockingMs: h.costMs }));
    expect(s.javascript.topBlockingScripts).toEqual(hotspotScripts);
  });

  it("(d) largestResources uses the shared selectLargestResources over runs[0]", () => {
    const report = makeReport({ runs: [{ resources: RESOURCES, longTasks: LONGTASKS }] });
    const s = computePerfSummary(report);
    const expected = selectLargestResources(RESOURCES, 5).map((r) => r.url);
    expect(s.network.largestResources.map((x) => x.url)).toEqual(expected);
    expect(s.network.largestResources[0]!.url).toBe("https://site/app.js"); // 200k largest
  });

  it("(e) errors/console are unioned + deduped + counted across runs", () => {
    const c1: ConsoleMessage[] = [{ level: "error", text: "boom", count: 2, originClass: "same-origin" }];
    const c2: ConsoleMessage[] = [{ level: "error", text: "boom", count: 1 }, { level: "warning", text: "warn", count: 1 }];
    const e1: PageError[] = [{ message: "TypeError: x", source: "exception", originClass: "same-origin" }];
    const e2: PageError[] = [{ message: "TypeError: x", source: "exception" }]; // dup across runs
    const report = makeReport({
      runs: [
        { consoleMessages: c1, pageErrors: e1 },
        { consoleMessages: c2, pageErrors: e2 },
      ],
    });
    const s = computePerfSummary(report);
    expect(s.errors.consoleErrorCount).toBe(3); // 2 + 1 summed
    expect(s.errors.consoleWarningCount).toBe(1);
    expect(s.errors.jsErrorCount).toBe(1); // deduped by message
    expect(s.errors.firstPartyErrorCount).toBe(2); // 1 js (same-origin) + 1 console error (same-origin)
  });

  it("(f) graceful when collectors return empty (zero errors -> all-zero, not undefined)", () => {
    const report = makeReport({ runs: [{ resources: [], longTasks: [] }] });
    const s = computePerfSummary(report);
    expect(s.errors.jsErrorCount).toBe(0);
    expect(s.errors.consoleErrorCount).toBe(0);
    expect(s.errors.jsErrors).toEqual([]);
    expect(s.network.totalRequests).toBe(0);
    expect(s.javascript.topBlockingScripts).toEqual([]);
  });

  it("(g) is deterministic", () => {
    const report = makeReport({ runs: [{ resources: RESOURCES, longTasks: LONGTASKS }], aggregated: RUNTIME_AGG, audits: [TP_AUDIT] });
    expect(computePerfSummary(report)).toEqual(computePerfSummary(report));
  });
});
