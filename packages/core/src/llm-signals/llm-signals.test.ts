import { describe, expect, it } from "vitest";
import { classifyOrigin, parseOriginInfo } from "./origin-class.js";
import { classifyServability } from "./servability.js";
import { computeTrustScore } from "./trust-score.js";
import { buildFixPlan } from "./fix-plan.js";
import type { Report } from "../types.js";

function reportFixture(opts: Partial<Report> & { url?: string; cov?: number; runs?: number } = {}): Report {
  const url = opts.url ?? "https://example.com/";
  const cov = opts.cov ?? 0.05;
  const runs = opts.runs ?? 5;
  return {
    schemaVersion: "1.0.0",
    meta: {
      url,
      startedAt: new Date().toISOString(),
      durationMs: 1000,
      runs,
      mode: "real",
      browser: { name: "chromium", version: "0", source: "bundled" },
      host: { os: "linux", arch: "x64", nodeVersion: "v22" },
      parity: { mode: "headless", knownDeltas: {} },
      emulation: false,
      pluginCapabilityUses: [],
      measurementId: "t",
    },
    runs: [],
    aggregated: {
      lcp: { name: "lcp", median: 1000, p75: 1100, p95: 1200, mean: 1050, stdev: 50, cov, runs, droppedOutliers: 0 },
      fcp: { name: "fcp", median: 800, p75: 850, p95: 900, mean: 820, stdev: 30, cov, runs, droppedOutliers: 0 },
    },
    frames: { root: "ohmyperf:root", nodes: {} },
    audits: [],
    artifacts: {},
    pluginData: {},
    ...opts,
  } as Report;
}

describe("classifyOrigin", () => {
  it("same host = same-origin", () => {
    const primary = parseOriginInfo("https://example.com/page");
    expect(classifyOrigin("https://example.com/static/a.js", primary)).toBe("same-origin");
  });

  it("same registrable domain, different subdomain = same-site", () => {
    const primary = parseOriginInfo("https://www.example.com/");
    expect(classifyOrigin("https://cdn.example.com/a.js", primary)).toBe("same-site");
  });

  it("different registrable domain = cross-site", () => {
    const primary = parseOriginInfo("https://example.com/");
    expect(classifyOrigin("https://cdn.googletagmanager.com/gtm.js", primary)).toBe("cross-site");
  });

  it("co.uk style TLD: example.co.uk vs cdn.example.co.uk = same-site", () => {
    const primary = parseOriginInfo("https://www.example.co.uk/");
    expect(classifyOrigin("https://cdn.example.co.uk/a.js", primary)).toBe("same-site");
  });

  it("invalid URL returns unknown", () => {
    const primary = parseOriginInfo("https://example.com/");
    expect(classifyOrigin("not a url", primary)).toBe("unknown");
  });

  it("null primary returns unknown for any resource", () => {
    expect(classifyOrigin("https://example.com/a.js", null)).toBe("unknown");
  });
});

describe("classifyServability", () => {
  it("normal page returns real-page", () => {
    const r = reportFixture({
      runs: [
        {
          runIndex: 0,
          cold: true,
          metrics: {},
          resources: Array.from({ length: 10 }, (_, i) => ({
            url: `https://example.com/r${String(i)}.js`,
            mimeType: "application/javascript",
            requestMs: 10,
            responseMs: 20,
            transferSizeBytes: 5000,
            encodedSizeBytes: 4000,
            decodedSizeBytes: 12000,
            renderBlocking: false,
            cacheHit: false,
          })),
          longTasks: [],
          meta: {},
        },
      ],
    });
    const s = classifyServability(r);
    expect(s.classification).toBe("real-page");
  });

  it("Cloudflare turnstile URL flags bot-challenge", () => {
    const r = reportFixture({
      runs: [
        {
          runIndex: 0,
          cold: true,
          metrics: {},
          resources: [
            {
              url: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/f/ov2",
              mimeType: "text/html",
              requestMs: 10,
              responseMs: 20,
              transferSizeBytes: 1408,
              encodedSizeBytes: 1408,
              decodedSizeBytes: 2800,
              renderBlocking: true,
              cacheHit: false,
            },
          ],
          longTasks: [],
          meta: {},
        },
      ],
    });
    const s = classifyServability(r);
    expect(s.classification).toBe("bot-challenge-suspected");
    expect(s.signals.some((sig) => sig.includes("cloudflare_challenge_url"))).toBe(true);
    expect(s.recommendedAction).toBeTruthy();
  });

  it("1 resource < 10KB no JS = bot-challenge-suspected", () => {
    const r = reportFixture({
      runs: [
        {
          runIndex: 0,
          cold: true,
          metrics: {},
          resources: [
            {
              url: "https://example.com/",
              mimeType: "text/html",
              requestMs: 1,
              responseMs: 2,
              transferSizeBytes: 618,
              encodedSizeBytes: 618,
              decodedSizeBytes: 800,
              renderBlocking: true,
              cacheHit: false,
            },
          ],
          longTasks: [],
          meta: {},
        },
      ],
    });
    const s = classifyServability(r);
    expect(s.classification).toBe("bot-challenge-suspected");
  });

  it("no runs returns unknown", () => {
    const r = reportFixture({ runs: [] });
    const s = classifyServability(r);
    expect(s.classification).toBe("unknown");
  });

  it("zero resources returns error-page", () => {
    const r = reportFixture({
      runs: [{ runIndex: 0, cold: true, metrics: {}, resources: [], longTasks: [], meta: {} }],
    });
    const s = classifyServability(r);
    expect(s.classification).toBe("error-page");
  });
});

describe("computeTrustScore", () => {
  it("n=5 cov=5% returns high overall", () => {
    const r = reportFixture({ runs: 5, cov: 0.05 });
    const t = computeTrustScore(r);
    expect(t.overall).toBe("high");
  });

  it("n=2 returns unreliable (cant reach significance)", () => {
    const r = reportFixture({ runs: 2, cov: 0.05 });
    const t = computeTrustScore(r);
    expect(t.overall).toBe("medium");
    expect(t.perMetric["lcp"]?.recommendedAction).toMatch(/runs/i);
  });

  it("n=1 returns unreliable", () => {
    const r = reportFixture({ runs: 1, cov: 0.0 });
    const t = computeTrustScore(r);
    expect(t.overall).toBe("unreliable");
  });

  it("cov=50% returns unreliable even with n=5", () => {
    const r = reportFixture({ runs: 5, cov: 0.50 });
    const t = computeTrustScore(r);
    expect(t.overall).toBe("unreliable");
    expect(t.recommendedAction).toMatch(/rerun|noisy/i);
  });

  it("no metrics returns unreliable with no_cwv_metrics", () => {
    const r = reportFixture();
    (r as { aggregated: Record<string, unknown> }).aggregated = {};
    const t = computeTrustScore(r);
    expect(t.overall).toBe("unreliable");
    expect(t.reasons).toContain("no_cwv_metrics_in_report");
  });
});

describe("buildFixPlan", () => {
  it("empty opportunities = empty fix plan", () => {
    const plan = buildFixPlan(reportFixture());
    expect(plan).toEqual([]);
  });

  it("first-party render-blocking script gets defer archetype + first-party applicability", () => {
    const r = reportFixture({
      opportunities: [
        {
          id: "render-blocking-resources",
          title: "Eliminate render-blocking",
          metric: "fcp",
          items: [{ url: "https://example.com/static/main.js", wastedMs: 320 }],
        },
      ],
      runs: [
        {
          runIndex: 0,
          cold: true,
          metrics: {},
          resources: [
            {
              url: "https://example.com/static/main.js",
              mimeType: "application/javascript",
              requestMs: 5,
              responseMs: 10,
              transferSizeBytes: 50000,
              encodedSizeBytes: 12000,
              decodedSizeBytes: 50000,
              renderBlocking: true,
              cacheHit: false,
              originClass: "same-origin",
            },
          ],
          longTasks: [],
          meta: {},
        },
      ],
    });
    const plan = buildFixPlan(r);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.archetype).toBe("render-blocking-script-add-defer");
    expect(plan[0]?.applicability).toBe("first-party");
    expect(plan[0]?.confidence).toBe("high");
    expect(plan[0]?.rank).toBe(1);
    expect(plan[0]?.expectedImpactMs).toBe(320);
  });

  it("cross-site render-blocking is ranked LOWER than first-party", () => {
    const r = reportFixture({
      opportunities: [
        {
          id: "render-blocking-resources",
          title: "Eliminate render-blocking",
          metric: "fcp",
          items: [
            { url: "https://cdn.googletagmanager.com/gtm.js", wastedMs: 500 },
            { url: "https://example.com/local.js", wastedMs: 100 },
          ],
        },
      ],
      runs: [
        {
          runIndex: 0,
          cold: true,
          metrics: {},
          resources: [
            {
              url: "https://cdn.googletagmanager.com/gtm.js",
              mimeType: "application/javascript",
              requestMs: 5, responseMs: 10, transferSizeBytes: 70000, encodedSizeBytes: 20000, decodedSizeBytes: 70000,
              renderBlocking: true, cacheHit: false,
              originClass: "cross-site",
            },
            {
              url: "https://example.com/local.js",
              mimeType: "application/javascript",
              requestMs: 5, responseMs: 10, transferSizeBytes: 5000, encodedSizeBytes: 1500, decodedSizeBytes: 5000,
              renderBlocking: true, cacheHit: false,
              originClass: "same-origin",
            },
          ],
          longTasks: [],
          meta: {},
        },
      ],
    });
    const plan = buildFixPlan(r);
    expect(plan).toHaveLength(2);
    expect(plan[0]?.applicability).toBe("first-party");
    expect(plan[0]?.target.url).toBe("https://example.com/local.js");
    expect(plan[1]?.applicability).toBe("third-party-cannot-apply");
  });

  it("dedupes identical (archetype, url) pairs", () => {
    const r = reportFixture({
      opportunities: [
        {
          id: "render-blocking-resources",
          title: "x",
          metric: "fcp",
          items: [{ url: "https://example.com/a.js", wastedMs: 100 }],
        },
      ],
      runs: [
        {
          runIndex: 0,
          cold: true,
          metrics: {},
          opportunities: [
            {
              id: "render-blocking-resources",
              title: "x",
              metric: "fcp",
              items: [{ url: "https://example.com/a.js", wastedMs: 100 }],
            },
          ],
          resources: [
            { url: "https://example.com/a.js", mimeType: "application/javascript", requestMs: 0, responseMs: 0, transferSizeBytes: 1000, encodedSizeBytes: 500, decodedSizeBytes: 1000, renderBlocking: true, cacheHit: false, originClass: "same-origin" },
          ],
          longTasks: [],
          meta: {},
        },
      ],
    });
    const plan = buildFixPlan(r);
    expect(plan).toHaveLength(1);
  });
});
