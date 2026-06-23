import { describe, expect, it } from "vitest";
import { computeHotspots } from "./hotspots.js";
import type { DomTopology, Opportunity, Report, RunReport } from "./types.js";

function run(p: Partial<RunReport>): RunReport {
  return {
    runIndex: 0,
    cold: true,
    metrics: {},
    resources: [],
    longTasks: [],
    meta: {},
    ...p,
  };
}

function makeReport(p: { runs?: RunReport[]; opportunities?: Opportunity[]; audits?: unknown[] }): Report {
  return {
    schemaVersion: "1.0.0",
    meta: {} as Report["meta"],
    runs: p.runs ?? [],
    aggregated: {},
    frames: { root: "r", nodes: {} },
    audits: p.audits ?? [],
    artifacts: {},
    pluginData: {},
    ...(p.opportunities ? { opportunities: p.opportunities } : {}),
  } as unknown as Report;
}

const topo = (containers: DomTopology["containers"], totalNodes = 1000): DomTopology => ({
  totalNodes,
  maxDepth: 10,
  viewport: { width: 1280, height: 720 },
  containers,
});

describe("computeHotspots", () => {
  it("dom-size hotspots are cost-ranked and propagate off-screen fraction", () => {
    const report = makeReport({
      runs: [
        run({
          runtime: { layoutDuration: 100, recalcStyleDuration: 100 }, // 200ms layout budget
          domTopology: topo(
            [
              { selector: ".big", signature: "ul>li", childCount: 200, nodeCount: 800, offscreenFraction: 0.9, similarChildrenRatio: 0.95 },
              { selector: ".small", signature: "div>p", childCount: 40, nodeCount: 100, offscreenFraction: 0.1, similarChildrenRatio: 0.5 },
            ],
            1000,
          ),
        }),
      ],
    });
    const h = computeHotspots(report);
    const domHots = h.filter((x) => x.cause === "dom-size");
    expect(domHots).toHaveLength(2);
    // .big = 800/1000 * 200ms = 160ms; .small = 100/1000*200 = 20ms → .big ranks first
    expect(domHots[0]!.selector).toBe(".big");
    expect(domHots[0]!.costMs).toBe(160);
    expect(domHots[0]!.offscreenFraction).toBe(0.9);
    expect(h[0]!.costMs).toBeGreaterThanOrEqual(h[1]!.costMs); // globally sorted desc
  });

  it("resource hotspots come from opportunities with wastedMs as cost", () => {
    const report = makeReport({
      runs: [run({})],
      opportunities: [
        {
          id: "render-blocking-resources",
          title: "Eliminate render-blocking resources",
          metric: "fcp",
          items: [{ url: "https://x/app.css", wastedMs: 240, wastedBytes: 16000 }],
        },
      ],
    });
    const h = computeHotspots(report);
    const r = h.find((x) => x.cause === "resource");
    expect(r).toBeDefined();
    expect(r!.selector).toBe("https://x/app.css");
    expect(r!.costMs).toBe(240);
    expect(r!.bytes).toBe(16000);
  });

  it("script hotspots group long tasks by attributed URL", () => {
    const report = makeReport({
      runs: [
        run({
          longTasks: [
            { startTime: 100, duration: 120, attribution: "main-thread", attributionRich: { url: "https://x/app.js", frameId: "r" } },
            { startTime: 300, duration: 80, attribution: "main-thread", attributionRich: { url: "https://x/app.js", frameId: "r" } },
          ],
        }),
      ],
    });
    const h = computeHotspots(report);
    const s = h.find((x) => x.cause === "script");
    expect(s).toBeDefined();
    expect(s!.selector).toBe("https://x/app.js");
    expect(s!.costMs).toBe(200);
  });

  it("third-party hotspots come from the third-parties audit (main-thread time)", () => {
    const report = makeReport({
      runs: [run({})],
      audits: [
        {
          id: "third-parties",
          title: "Third-party usage",
          passed: true,
          status: "pass",
          score: 1,
          details: { items: [{ entity: "Google Tag Manager", category: "tag-manager", transferSize: 90000, mainThreadTime: 320 }] },
        },
      ],
    });
    const h = computeHotspots(report);
    const tp = h.find((x) => x.cause === "third-party");
    expect(tp).toBeDefined();
    expect(tp!.selector).toBe("Google Tag Manager");
    expect(tp!.costMs).toBe(320);
    expect(tp!.gatingPhase).toBe("network");
  });

  it("is deterministic", () => {
    const report = makeReport({
      runs: [run({ runtime: { layoutDuration: 50 }, domTopology: topo([{ selector: ".a", signature: "ul>li", childCount: 50, nodeCount: 300, offscreenFraction: 0.5, similarChildrenRatio: 0.9 }]) })],
    });
    expect(computeHotspots(report)).toEqual(computeHotspots(report));
  });
});
