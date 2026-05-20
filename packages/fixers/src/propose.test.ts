import { describe, it, expect } from "vitest";
import { proposePatches } from "./propose.js";
import type { Report } from "@ohmyperf/core";

function makeReport(opportunities: Array<{
  id: string;
  metric: "lcp" | "fcp" | "tbt" | "inp" | "cls";
  items: Array<{ url: string; wastedMs?: number; wastedBytes?: number }>;
}>): Report {
  return {
    schemaVersion: "1.0.0",
    meta: {
      url: "https://example.com/",
      startedAt: new Date().toISOString(),
      durationMs: 1000,
      runs: 1,
      mode: "real",
      browser: { name: "chromium", version: "0", source: "bundled" },
      host: { os: "linux", arch: "x64", nodeVersion: "v22" },
      parity: { mode: "headless", knownDeltas: {} },
      emulation: false,
      pluginCapabilityUses: [],
      measurementId: "test",
    },
    runs: [],
    aggregated: {},
    frames: { root: "ohmyperf:root", nodes: {} },
    audits: [],
    artifacts: {},
    pluginData: {},
    opportunities: opportunities.map((o) => ({
      title: o.id,
      ...o,
    })),
  } as unknown as Report;
}

describe("proposePatches", () => {
  it("emits defer patches for render-blocking scripts", () => {
    const report = makeReport([
      {
        id: "render-blocking-resources",
        metric: "fcp",
        items: [
          { url: "https://cdn.example.com/static/main.js", wastedMs: 350 },
          { url: "https://cdn.example.com/static/analytics.js", wastedMs: 120 },
        ],
      },
    ]);
    const { patches, skipped } = proposePatches({ report });
    expect(skipped).toEqual([]);
    expect(patches).toHaveLength(2);
    expect(patches[0]?.archetype).toBe("render-blocking-script-add-defer");
    expect(patches[0]?.replace).toContain("defer");
    expect(patches[0]?.expectedImpactMs).toBe(350);
    expect(patches[1]?.expectedImpactMs).toBe(120);
  });

  it("emits media-print patches for render-blocking stylesheets", () => {
    const report = makeReport([
      {
        id: "render-blocking-resources",
        metric: "fcp",
        items: [{ url: "https://cdn.example.com/static/app.css", wastedMs: 80 }],
      },
    ]);
    const { patches } = proposePatches({ report });
    expect(patches[0]?.archetype).toBe("render-blocking-stylesheet-media-print");
    expect(patches[0]?.replace).toContain("media=\"print\"");
    expect(patches[0]?.replace).toContain("onload=\"this.media='all'\"");
  });

  it("emits LCP image patches (fetchpriority + preload)", () => {
    const report = makeReport([
      {
        id: "largest-contentful-paint-image",
        metric: "lcp",
        items: [{ url: "https://cdn.example.com/hero.webp", wastedMs: 400 }],
      },
    ]);
    const { patches } = proposePatches({ report });
    expect(patches).toHaveLength(2);
    const archetypes = patches.map((p) => p.archetype);
    expect(archetypes).toContain("lcp-image-fetchpriority-high");
    expect(archetypes).toContain("lcp-image-link-preload");
    const fp = patches.find((p) => p.archetype === "lcp-image-fetchpriority-high");
    expect(fp?.replace).toContain('fetchpriority="high"');
    const preload = patches.find((p) => p.archetype === "lcp-image-link-preload");
    expect(preload?.replace).toContain('rel="preload"');
  });

  it("skips when no archetype matches opportunity id", () => {
    const report = makeReport([
      {
        id: "unused-css-rules",
        metric: "fcp",
        items: [{ url: "https://cdn.example.com/style.css", wastedMs: 100 }],
      },
    ]);
    const { patches, skipped } = proposePatches({ report });
    expect(patches).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.opportunityId).toBe("unused-css-rules");
  });

  it("filters patches by url when provided", () => {
    const report = makeReport([
      {
        id: "render-blocking-resources",
        metric: "fcp",
        items: [
          { url: "https://cdn.example.com/a.js", wastedMs: 100 },
          { url: "https://cdn.example.com/b.js", wastedMs: 200 },
        ],
      },
    ]);
    const { patches } = proposePatches({
      report,
      url: "https://cdn.example.com/b.js",
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toBe("https://cdn.example.com/b.js");
  });

  it("respects maxPatches and sorts by wastedMs desc", () => {
    const report = makeReport([
      {
        id: "render-blocking-resources",
        metric: "fcp",
        items: [
          { url: "https://cdn.example.com/small.js", wastedMs: 30 },
          { url: "https://cdn.example.com/large.js", wastedMs: 500 },
          { url: "https://cdn.example.com/medium.js", wastedMs: 200 },
        ],
      },
    ]);
    const { patches } = proposePatches({ report, maxPatches: 2 });
    expect(patches).toHaveLength(2);
    expect(patches[0]?.url).toBe("https://cdn.example.com/large.js");
    expect(patches[1]?.url).toBe("https://cdn.example.com/medium.js");
  });

  it("flags missing requested opportunityId", () => {
    const report = makeReport([]);
    const { patches, skipped } = proposePatches({
      report,
      opportunityId: "render-blocking-resources",
    });
    expect(patches).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toContain("not present");
  });
});
