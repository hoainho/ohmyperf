import { describe, expect, it } from "vitest";
import type { Report } from "@ohmyperf/core";
import {
  buildPromptMessages,
  classifyVerifyFix,
  evaluateBudget,
  extractInsight,
  parseMeasureInput,
  summarize,
  unreliableTrustWarning,
} from "./server.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Minimal-but-valid Report shapes, cast like packages/core/src/rx.test.ts. Each
// fixture toggles exactly the fields a story needs (additive-optional everywhere).

interface Overrides {
  aggregated?: Record<string, { median: number; p75: number; cov: number; runs: number }>;
  audits?: Array<{ id: string; title: string; passed: boolean; status: string; score: number | null; details?: unknown }>;
  fullLoad?: Record<string, unknown>;
  hotspots?: Array<Record<string, unknown>>;
  recommendations?: Array<Record<string, unknown>>;
  remediationNote?: string;
  servability?: { classification: string; signals: string[]; recommendedAction?: string };
  trustScore?: { overall: string; reasons: string[]; perMetric: Record<string, unknown>; recommendedAction?: string };
}

function makeReport(o: Overrides = {}): Report {
  const meta: Record<string, unknown> = {
    url: "https://example.com",
    startedAt: "2026-06-23T00:00:00.000Z",
    durationMs: 1000,
    runs: 3,
    mode: "real",
    browser: { name: "chromium", version: "147.0", source: "bundled" },
    host: { os: "linux", arch: "x64", nodeVersion: "v22" },
    parity: { mode: "headless", knownDeltas: {} },
    emulation: false,
    pluginCapabilityUses: [],
    measurementId: "m_example1",
  };
  if (o.servability) meta["servability"] = o.servability;
  return {
    schemaVersion: "1.0.0",
    meta,
    runs: [{ runIndex: 0, cold: true, metrics: {}, resources: [], longTasks: [], meta: {} }],
    aggregated: o.aggregated ?? {},
    frames: { root: "r", nodes: {} },
    audits: o.audits ?? [],
    artifacts: {},
    pluginData: {},
    ...(o.fullLoad ? { fullLoad: o.fullLoad } : {}),
    ...(o.hotspots ? { hotspots: o.hotspots } : {}),
    ...(o.recommendations ? { recommendations: o.recommendations } : {}),
    ...(o.remediationNote ? { remediationNote: o.remediationNote } : {}),
    ...(o.trustScore ? { trustScore: o.trustScore } : {}),
  } as unknown as Report;
}

const FULL_LOAD = {
  fltMs: 2200,
  capped: false,
  gatingPhase: "main-thread",
  gatingDistribution: { network: 900, dom: 400, "main-thread": 2200 },
  subTimeline: {
    ttfb: 120,
    fcp: 800,
    lcp: 1500,
    domContentLoaded: 600,
    loadEventEnd: 1800,
    networkIdleAt: 2000,
    lastMutationAt: 2100,
    lastLongTaskEndAt: 2200,
    visuallyCompleteAt: 2050,
    fltMs: 2200,
  },
  settleConfig: { until: "fully-loaded" },
};

const HOTSPOTS = [
  { selector: ".list", label: "2000 children · 8200 nodes", costMs: 965, bytes: 0, nodeCount: 8200, offscreenFraction: 0.92, gatingPhase: "dom", cause: "dom-size" },
  { selector: "https://x/app.js", label: "long tasks", costMs: 480, bytes: 0, nodeCount: 0, offscreenFraction: 0, gatingPhase: "main-thread", cause: "script" },
];

const RECS = [
  { id: "r1", rule: "R2-virtualize", title: "Virtualize the off-screen list", problem: "p", strategy: "s", alternativeStrategies: [], target: { selector: ".list" }, estFltDeltaMs: 700, gating: true, confidence: "high", howTo: { generic: "g", frameworks: {} }, evidence: "e" },
  { id: "r2", rule: "R5-split-js", title: "Split app.js", problem: "p", strategy: "s", alternativeStrategies: [], target: { resource: "https://x/app.js" }, estFltDeltaMs: 120, gating: false, confidence: "medium", howTo: { generic: "g", frameworks: {} }, evidence: "e" },
];

const TRUST_HIGH = { overall: "high", reasons: ["stable"], perMetric: {} };
const TRUST_UNRELIABLE = { overall: "unreliable", reasons: ["high variance"], perMetric: {}, recommendedAction: "increase runs" };

// ── S1: third-parties insight reads audits[] (not pluginData) ───────────────────
describe("S1 third-parties insight", () => {
  it("reads the `third-parties` audit details when present", () => {
    const details = { items: [{ entity: "Google Tag Manager", mainThreadTime: 320, transferSize: 90000 }] };
    const report = makeReport({ audits: [{ id: "third-parties", title: "Third-party usage", passed: true, status: "pass", score: 1, details }] });
    const slice = extractInsight(report, "third-parties", 20);
    expect(slice.data).toEqual(details);
    expect(slice.summary).toMatch(/third-party breakdown/i);
  });

  it("degrades gracefully (null) when no third-parties audit exists", () => {
    const report = makeReport({ audits: [{ id: "axe", title: "Axe", passed: true, status: "pass", score: 1 }] });
    const slice = extractInsight(report, "third-parties", 20);
    expect(slice.data).toBeNull();
    expect(slice.summary).toMatch(/no third-party data/i);
  });
});

// ── S3: measure forwards diagnose/rx/fullLoad (parser layer — the silent-drop trap) ─
describe("S3 parseMeasureInput forwarding", () => {
  it("forwards diagnose/rx and whitelists known fullLoad keys (drops unknown)", () => {
    const input = parseMeasureInput({
      url: "https://example.com",
      diagnose: true,
      rx: true,
      fullLoad: { until: "visually-complete", visual: true, bogusKey: 123 },
    });
    expect(input.diagnose).toBe(true);
    expect(input.rx).toBe(true);
    expect(input.fullLoad).toEqual({ until: "visually-complete", visual: true });
    expect(input.fullLoad && "bogusKey" in input.fullLoad).toBe(false);
  });

  it("default measure carries no diagnose/rx/fullLoad (byte-stable default path)", () => {
    const input = parseMeasureInput({ url: "https://example.com" });
    expect("diagnose" in input).toBe(false);
    expect("rx" in input).toBe(false);
    expect("fullLoad" in input).toBe(false);
  });

  it("ignores a non-object fullLoad and a fullLoad with only unknown keys", () => {
    expect(parseMeasureInput({ url: "https://example.com", fullLoad: "nope" }).fullLoad).toBeUndefined();
    expect(parseMeasureInput({ url: "https://example.com", fullLoad: { junk: 1 } }).fullLoad).toBeUndefined();
  });
});

// ── S4: full-load-breakdown insight ─────────────────────────────────────────────
describe("S4 full-load-breakdown insight", () => {
  it("surfaces FLT, gating, distribution, sub-timeline incl. visuallyCompleteAt", () => {
    const report = makeReport({ fullLoad: FULL_LOAD });
    const slice = extractInsight(report, "full-load-breakdown", 20);
    const data = slice.data as Record<string, unknown>;
    expect(data["fltMs"]).toBe(2200);
    expect(data["gatingPhase"]).toBe("main-thread");
    expect(data["gatingDistribution"]).toEqual(FULL_LOAD.gatingDistribution);
    expect((data["subTimeline"] as Record<string, unknown>)["visuallyCompleteAt"]).toBe(2050);
    expect(slice.summary).toMatch(/Full-Load Time: 2200ms/);
    expect(slice.summary).toMatch(/visually complete: 2050ms/);
  });

  it("degrades gracefully when fullLoad is absent", () => {
    const slice = extractInsight(makeReport(), "full-load-breakdown", 20);
    expect(slice.data).toBeNull();
    expect(slice.summary).toMatch(/predates v0\.2\.0|rerun `measure`/i);
  });
});

// ── S5: hotspots + remediation insights ─────────────────────────────────────────
describe("S5 hotspots + remediation insights", () => {
  it("hotspots: ranked by cost when present", () => {
    const slice = extractInsight(makeReport({ hotspots: HOTSPOTS }), "hotspots", 20);
    const data = slice.data as Array<{ costMs: number }>;
    expect(data).toHaveLength(2);
    expect(data[0]!.costMs).toBe(965); // top by cost
    expect(slice.summary).toMatch(/2 hotspot/);
  });

  it("hotspots: degrades gracefully when absent (re-measure with diagnose:true)", () => {
    const slice = extractInsight(makeReport(), "hotspots", 20);
    expect(slice.data).toBeNull();
    expect(slice.summary).toMatch(/diagnose:true/);
  });

  it("remediation: ranked by est FLT impact + surfaces remediationNote", () => {
    const slice = extractInsight(makeReport({ recommendations: RECS, remediationNote: "trust unreliable" }), "remediation", 20);
    const data = slice.data as { recommendations: Array<{ estFltDeltaMs: number }>; note?: string };
    expect(data.recommendations[0]!.estFltDeltaMs).toBe(700);
    expect(data.note).toBe("trust unreliable");
    expect(slice.summary).toMatch(/trust unreliable/);
  });

  it("remediation: degrades gracefully when absent (re-measure with rx:true)", () => {
    const slice = extractInsight(makeReport(), "remediation", 20);
    expect(slice.data).toBeNull();
    expect(slice.summary).toMatch(/rx:true/);
  });
});

// ── S6: summarize() golden — plain byte-stable, diagnose adds lines ──────────────
describe("S6 summarize golden", () => {
  const plain = makeReport({ aggregated: { lcp: { median: 100, p75: 110, cov: 0, runs: 3 } } });

  it("plain (non-diagnose) report: exact pre-change output, no new lines", () => {
    const out = summarize(plain, "/tmp/r.json");
    expect(out).toBe(
      [
        "Measured https://example.com",
        "Saved to: /tmp/r.json",
        "Mode: real; runs: 3; duration: 1000ms; measurementId: m_example1",
        "Browser: chromium 147.0 (bundled)",
        "  LCP   median=100.0 cov=0.0% n=3",
      ].join("\n"),
    );
    expect(out).not.toMatch(/Full-Load|Hotspots:|Recommendations:/);
    expect(out.endsWith("\n")).toBe(false);
    expect(out).not.toMatch(/undefined/);
  });

  it("diagnose report: adds Full-Load + Hotspots + Recommendations lines (no undefined)", () => {
    const diag = makeReport({
      aggregated: { lcp: { median: 1500, p75: 1600, cov: 0.05, runs: 3 } },
      fullLoad: FULL_LOAD,
      hotspots: HOTSPOTS,
      recommendations: RECS,
    });
    const out = summarize(diag, "/tmp/d.json");
    expect(out).toMatch(/Full-Load: 2200ms \(gating: main-thread\) — settle-based, not LCP/);
    expect(out).toMatch(/Hotspots: 2 \(top 2 by cost\)/);
    expect(out).toMatch(/Recommendations: 2 \(top 2 by est\. FLT impact\)/);
    expect(out).toMatch(/R2-virtualize.*\(gating\)/);
    expect(out).not.toMatch(/undefined/);
    expect(out.endsWith("\n")).toBe(false);
  });
});

// ── S7: measure_and_diagnose prompt ─────────────────────────────────────────────
describe("S7 measure_and_diagnose prompt", () => {
  it("returns the exact chained steps for a given url", () => {
    const messages = buildPromptMessages("measure_and_diagnose", { url: "https://moodtrip.hoainho.info" });
    expect(messages).toHaveLength(1);
    const text = messages[0]!.content.text;
    expect(text).toContain("https://moodtrip.hoainho.info");
    expect(text).toContain("diagnose: true");
    expect(text).toContain("rx: true");
    expect(text).toContain('insightName="full-load-breakdown"');
    expect(text).toContain('insightName="hotspots"');
    expect(text).toContain('insightName="remediation"');
    expect(text).toContain("get_servability");
    expect(text).toContain("get_trust_score");
  });

  it("does not collide with the existing diagnose_report prompt", () => {
    expect(() => buildPromptMessages("diagnose_report", { reportPath: "/p" })).not.toThrow();
    expect(() => buildPromptMessages("measure_and_diagnose", { url: "https://x" })).not.toThrow();
    expect(() => buildPromptMessages("nope", {})).toThrow(/unknown prompt/i);
  });
});

// ── S8: enforce_budget trust/servability gate + exit 0|12|13 ─────────────────────
describe("S8 enforce_budget gating", () => {
  const budget = { lcp: 2500 };

  it("bot-challenge within budget → gated, exitCode 13", () => {
    const report = makeReport({
      aggregated: { lcp: { median: 800, p75: 820, cov: 0.02, runs: 3 } },
      servability: { classification: "bot-challenge-suspected", signals: ["cf-challenge"] },
    });
    const v = evaluateBudget(report, budget);
    expect(v.gated).toBe(true);
    expect(v.exitCode).toBe(13);
    expect(v.gateReason).toBe("bot-challenge-suspected");
  });

  it("over-budget real-page → not gated, exitCode 12, FAIL", () => {
    const report = makeReport({
      aggregated: { lcp: { median: 4200, p75: 4400, cov: 0.05, runs: 3 } },
      servability: { classification: "real-page", signals: [] },
      trustScore: TRUST_HIGH,
    });
    const v = evaluateBudget(report, budget);
    expect(v.gated).toBe(false);
    expect(v.exitCode).toBe(12);
    expect(v.status).toBe("FAIL");
  });

  it("unreliable trust on a real page → gated, exitCode 13, reason unreliable", () => {
    const report = makeReport({
      aggregated: { lcp: { median: 800, p75: 820, cov: 0.4, runs: 3 } },
      servability: { classification: "real-page", signals: [] },
      trustScore: TRUST_UNRELIABLE,
    });
    const v = evaluateBudget(report, budget);
    expect(v.gated).toBe(true);
    expect(v.exitCode).toBe(13);
    expect(v.gateReason).toBe("unreliable");
  });

  it("force:true bypasses the gate (bot-challenge → metric verdict only)", () => {
    const report = makeReport({
      aggregated: { lcp: { median: 800, p75: 820, cov: 0.02, runs: 3 } },
      servability: { classification: "bot-challenge-suspected", signals: ["cf-challenge"] },
    });
    const v = evaluateBudget(report, budget, true);
    expect(v.gated).toBe(false);
    expect(v.exitCode).toBe(0); // within budget once the gate is bypassed
  });

  it("clean real-page within budget → exitCode 0, not gated", () => {
    const report = makeReport({
      aggregated: { lcp: { median: 800, p75: 820, cov: 0.02, runs: 3 } },
      servability: { classification: "real-page", signals: [] },
      trustScore: TRUST_HIGH,
    });
    const v = evaluateBudget(report, budget);
    expect(v.gated).toBe(false);
    expect(v.exitCode).toBe(0);
    expect(v.status).toBe("PASS");
  });
});

// ── S9: propose_patch / verify_fix trust gates ──────────────────────────────────
describe("S9 trust gates", () => {
  it("unreliableTrustWarning fires only on unreliable trust", () => {
    expect(unreliableTrustWarning(makeReport({ trustScore: TRUST_UNRELIABLE }))).toMatch(/unreliable/i);
    expect(unreliableTrustWarning(makeReport({ trustScore: TRUST_HIGH }))).toBeUndefined();
    expect(unreliableTrustWarning(makeReport())).toBeUndefined();
  });

  it("classifyVerifyFix returns inconclusive when candidate trust is unreliable", () => {
    expect(classifyVerifyFix(makeReport({ trustScore: TRUST_UNRELIABLE }), true).verdict).toBe("inconclusive");
    expect(classifyVerifyFix(makeReport({ trustScore: TRUST_UNRELIABLE }), false).verdict).toBe("inconclusive");
  });

  it("classifyVerifyFix returns regression/ok on a reliable candidate", () => {
    expect(classifyVerifyFix(makeReport({ trustScore: TRUST_HIGH }), true).verdict).toBe("regression");
    expect(classifyVerifyFix(makeReport({ trustScore: TRUST_HIGH }), false).verdict).toBe("ok");
  });
});
