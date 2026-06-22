// computeHotspots — pure: derive a ranked component/region cost table from a Report.
// Joins the DOM-topology snapshot, attributed long tasks, and render-blocking opportunities.
// Mirrors the computeTrustScore / buildFixPlan post-processing pattern (no I/O, deterministic).

import type { GatingPhase, Hotspot, HotspotCause, Report, RunReport } from "./types.js";

function representativeRun(report: Report): RunReport | undefined {
  return report.runs.find((r) => r.domTopology) ?? report.runs[0];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const CAUSE_PHASE: Record<HotspotCause, GatingPhase> = {
  "dom-size": "dom",
  layout: "main-thread",
  script: "main-thread",
  resource: "network",
  "third-party": "network",
};

export function computeHotspots(report: Report): Hotspot[] {
  const rep = representativeRun(report);
  const hotspots: Hotspot[] = [];

  // 1. DOM-size hotspots from the topology snapshot, cost ∝ subtree share of layout+recalc time.
  const topo = rep?.domTopology;
  const runtime = rep?.runtime ?? {};
  const layoutMs = (runtime["layoutDuration"] ?? 0) + (runtime["recalcStyleDuration"] ?? 0);
  if (topo && topo.totalNodes > 0) {
    for (const c of topo.containers) {
      const share = c.nodeCount / topo.totalNodes;
      hotspots.push({
        selector: c.selector,
        label: `${String(c.childCount)} children · ${String(c.nodeCount)} nodes`,
        costMs: round1(share * layoutMs),
        bytes: 0,
        nodeCount: c.nodeCount,
        offscreenFraction: c.offscreenFraction,
        gatingPhase: CAUSE_PHASE["dom-size"],
        cause: "dom-size",
        evidence: `subtree ${String(c.nodeCount)} nodes, ${String(Math.round(c.offscreenFraction * 100))}% off-screen, ${String(Math.round(c.similarChildrenRatio * 100))}% homogeneous children`,
      });
    }
  }

  // 2. Resource hotspots from render-blocking (and other) opportunities.
  for (const opp of report.opportunities ?? []) {
    for (const item of opp.items) {
      hotspots.push({
        selector: item.url,
        label: opp.title,
        costMs: round1(item.wastedMs ?? 0),
        bytes: item.wastedBytes ?? 0,
        nodeCount: 0,
        offscreenFraction: 0,
        gatingPhase: CAUSE_PHASE.resource,
        cause: "resource",
        evidence: `${opp.id}: wasted ${String(Math.round(item.wastedMs ?? 0))}ms on ${opp.metric}`,
      });
    }
  }

  // 3. Script hotspots from attributed long tasks (representative run), grouped by JS URL.
  const byUrl = new Map<string, number>();
  for (const lt of rep?.longTasks ?? []) {
    const url = lt.attributionRich?.url ?? lt.attribution;
    byUrl.set(url, (byUrl.get(url) ?? 0) + lt.duration);
  }
  for (const [url, dur] of byUrl) {
    hotspots.push({
      selector: url,
      label: "long tasks",
      costMs: round1(dur),
      bytes: 0,
      nodeCount: 0,
      offscreenFraction: 0,
      gatingPhase: CAUSE_PHASE.script,
      cause: "script",
      evidence: `${String(Math.round(dur))}ms of long tasks attributed to ${url}`,
    });
  }

  // 4. Third-party hotspots from the `third-parties` audit (main-thread time per entity).
  const tpAudit = report.audits.find((a) => a.id === "third-parties");
  for (const it of extractThirdParties(tpAudit?.details)) {
    hotspots.push({
      selector: it.entity,
      label: "third-party",
      costMs: round1(it.mainThreadTime),
      bytes: it.transferSize,
      nodeCount: 0,
      offscreenFraction: 0,
      gatingPhase: CAUSE_PHASE["third-party"],
      cause: "third-party",
      evidence: `${it.entity}: ${String(Math.round(it.mainThreadTime))}ms main-thread, ${String(Math.round(it.transferSize / 1024))}KB`,
    });
  }

  hotspots.sort((a, b) => b.costMs - a.costMs);
  return hotspots;
}

interface ThirdPartyItem {
  readonly entity: string;
  readonly mainThreadTime: number;
  readonly transferSize: number;
}

function extractThirdParties(details: unknown): ThirdPartyItem[] {
  if (details === null || typeof details !== "object") return [];
  const items = (details as Record<string, unknown>)["items"];
  if (!Array.isArray(items)) return [];
  const out: ThirdPartyItem[] = [];
  for (const it of items) {
    if (it === null || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (typeof o["entity"] !== "string") continue;
    out.push({
      entity: o["entity"],
      mainThreadTime: typeof o["mainThreadTime"] === "number" ? o["mainThreadTime"] : 0,
      transferSize: typeof o["transferSize"] === "number" ? o["transferSize"] : 0,
    });
  }
  return out;
}
