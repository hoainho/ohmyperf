import { describe, expect, it } from "vitest";
import { evaluateRx } from "./rx.js";
import type { DomContainer, Hotspot, Report, RunReport } from "./types.js";

function run(p: Partial<RunReport>): RunReport {
  return { runIndex: 0, cold: true, metrics: {}, resources: [], longTasks: [], meta: {}, ...p };
}

interface Fixture {
  runs?: RunReport[];
  hotspots?: Hotspot[];
  fullLoad?: Record<string, unknown>;
  trustScore?: { overall: string };
}

function makeReport(p: Fixture): Report {
  return {
    schemaVersion: "1.0.0",
    meta: {} as Report["meta"],
    runs: p.runs ?? [],
    aggregated: {},
    frames: { root: "r", nodes: {} },
    audits: [],
    artifacts: {},
    pluginData: {},
    ...(p.hotspots ? { hotspots: p.hotspots } : {}),
    ...(p.fullLoad ? { fullLoad: p.fullLoad } : {}),
    ...(p.trustScore ? { trustScore: p.trustScore } : {}),
  } as unknown as Report;
}

const container = (p: Partial<DomContainer> & { selector: string }): DomContainer => ({
  signature: "ul>li",
  childCount: 0,
  nodeCount: 0,
  offscreenFraction: 0,
  similarChildrenRatio: 0.95,
  ...p,
});

describe("evaluateRx", () => {
  it("a 2,000-row off-screen list yields R2 virtualize as a top, gating recommendation", () => {
    const report = makeReport({
      runs: [
        run({
          runtime: { layoutDuration: 600, recalcStyleDuration: 400 },
          domTopology: {
            totalNodes: 8500,
            maxDepth: 6,
            viewport: { width: 1280, height: 720 },
            containers: [container({ selector: ".list", childCount: 2000, nodeCount: 8200, offscreenFraction: 0.92, similarChildrenRatio: 0.98 })],
          },
        }),
      ],
      hotspots: [
        { cause: "dom-size", selector: ".list", label: "list", costMs: 965, bytes: 0, nodeCount: 8200, offscreenFraction: 0.92, gatingPhase: "dom" },
      ],
      fullLoad: { fltMs: 2000, capped: false, gatingPhase: "main-thread", gatingDistribution: { network: 300, dom: 400, "main-thread": 2000 } },
    });
    const { recommendations } = evaluateRx(report);
    const r2 = recommendations.find((r) => r.rule === "R2-virtualize");
    expect(r2).toBeDefined();
    expect(r2!.target.selector).toBe(".list");
    expect(r2!.gating).toBe(true);
    expect(r2!.estFltDeltaMs).toBeGreaterThan(0);
    expect(Object.keys(r2!.howTo.frameworks).sort()).toEqual(["react", "svelte", "vanilla", "vue"]);
    expect(recommendations[0]!.rule).toBe("R2-virtualize"); // top by impact
  });

  it("a network-gated hero image yields R1 (positive), and an off-gate R5 is gating:false ~0", () => {
    const report = makeReport({
      runs: [run({})],
      hotspots: [
        { cause: "resource", selector: "https://x/hero.jpg", label: "hero", costMs: 800, bytes: 120000, nodeCount: 0, offscreenFraction: 0, gatingPhase: "network" },
        { cause: "script", selector: "https://x/app.js", label: "long tasks", costMs: 500, bytes: 0, nodeCount: 0, offscreenFraction: 0, gatingPhase: "main-thread" },
      ],
      fullLoad: { fltMs: 1500, capped: false, gatingPhase: "network", gatingDistribution: { network: 1500, "main-thread": 700, dom: 300 } },
    });
    const { recommendations } = evaluateRx(report);
    const r1 = recommendations.find((r) => r.rule === "R1-lazy-media");
    const r5 = recommendations.find((r) => r.rule === "R5-split-js");
    expect(r1).toBeDefined();
    expect(r1!.target.resource).toBe("https://x/hero.jpg");
    expect(r1!.gating).toBe(true);
    expect(r1!.estFltDeltaMs).toBeGreaterThan(0);
    expect(r5).toBeDefined();
    expect(r5!.gating).toBe(false);
    expect(r5!.estFltDeltaMs).toBe(0);
  });

  it("a small list does NOT trigger R2", () => {
    const report = makeReport({
      runs: [run({ domTopology: { totalNodes: 200, maxDepth: 4, viewport: { width: 1280, height: 720 }, containers: [container({ selector: ".small", childCount: 20, nodeCount: 60, offscreenFraction: 0.8 })] } })],
      fullLoad: { fltMs: 500, capped: false, gatingPhase: "main-thread", gatingDistribution: { "main-thread": 500 } },
    });
    const { recommendations } = evaluateRx(report);
    expect(recommendations.find((r) => r.rule === "R2-virtualize")).toBeUndefined();
  });

  it("unreliable trust → every recommendation confidence=low + a re-measure note", () => {
    const report = makeReport({
      runs: [run({})],
      hotspots: [{ cause: "resource", selector: "https://x/hero.jpg", label: "hero", costMs: 800, bytes: 0, nodeCount: 0, offscreenFraction: 0, gatingPhase: "network" }],
      fullLoad: { fltMs: 1500, capped: false, gatingPhase: "network", gatingDistribution: { network: 1500 } },
      trustScore: { overall: "unreliable" },
    });
    const { recommendations, note } = evaluateRx(report);
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.every((r) => r.confidence === "low")).toBe(true);
    expect(note).toBeTruthy();
  });

  it("a 'mixed' aggregate gate still credits real findings (does not zero them)", () => {
    const report = makeReport({
      runs: [
        run({
          runtime: { layoutDuration: 600, recalcStyleDuration: 400 },
          domTopology: {
            totalNodes: 8500,
            maxDepth: 6,
            viewport: { width: 1280, height: 720 },
            containers: [container({ selector: ".list", childCount: 2000, nodeCount: 8200, offscreenFraction: 0.92, similarChildrenRatio: 0.98 })],
          },
        }),
      ],
      hotspots: [{ cause: "dom-size", selector: ".list", label: "list", costMs: 965, bytes: 0, nodeCount: 8200, offscreenFraction: 0.92, gatingPhase: "dom" }],
      fullLoad: { fltMs: 2000, capped: false, gatingPhase: "mixed", gatingDistribution: { network: 1900, dom: 1850, "main-thread": 2000 } },
    });
    const r2 = evaluateRx(report).recommendations.find((r) => r.rule === "R2-virtualize");
    expect(r2).toBeDefined();
    expect(r2!.gating).toBe(true);
    expect(r2!.estFltDeltaMs).toBeGreaterThan(0);
  });

  it("a heavy third-party (main-thread) yields R8 offload", () => {
    const report = makeReport({
      runs: [run({})],
      hotspots: [{ cause: "third-party", selector: "Google Tag Manager", label: "third-party", costMs: 320, bytes: 90000, nodeCount: 0, offscreenFraction: 0, gatingPhase: "main-thread" }],
      fullLoad: { fltMs: 1500, capped: false, gatingPhase: "main-thread", gatingDistribution: { network: 200, dom: 100, "main-thread": 1500 } },
    });
    const r8 = evaluateRx(report).recommendations.find((r) => r.rule === "R8-offload-3p");
    expect(r8).toBeDefined();
    expect(r8!.target.resource).toBe("Google Tag Manager");
    expect(r8!.gating).toBe(true);
    expect(r8!.estFltDeltaMs).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const report = makeReport({
      runs: [run({})],
      hotspots: [{ cause: "resource", selector: "https://x/app.css", label: "css", costMs: 200, bytes: 0, nodeCount: 0, offscreenFraction: 0, gatingPhase: "network" }],
      fullLoad: { fltMs: 1000, capped: false, gatingPhase: "network", gatingDistribution: { network: 1000, "main-thread": 200 } },
    });
    expect(evaluateRx(report)).toEqual(evaluateRx(report));
  });
});
