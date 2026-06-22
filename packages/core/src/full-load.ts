// Full-Load Time (FLT) — the settle-based "page is truly done" metric.
//
// This module is a PURE function of four activity streams (no I/O), so it is
// fully deterministic and unit-testable with synthetic inputs. The engine
// (US-3) builds the streams from CDP collectors and calls `computeFullLoad`.
//
// See openspec/changes/add-full-load-time/design.md for the formal model.

import type {
  FullLoadConfig,
  FullLoadResult,
  FullLoadSubTimeline,
  GatingPhase,
} from "./types.js";

export const FULL_LOAD_DEFAULTS: FullLoadConfig = {
  until: "fully-loaded",
  settleWindowMs: 1000,
  maxWaitMs: 30_000,
  // 0 = network is quiet only when there are zero blocking requests in flight (truly
  // "fully loaded"). The `network-idle-2` endpoint overrides this to 2 by definition.
  netIdleThreshold: 0,
  mutationNoiseFloor: 3,
  longLivedGraceMs: 5000,
  visual: false,
  visualIntervalMs: 100,
  visualDiffEpsilon: 0.001,
  strictNetwork: false,
};

/** A request's lifecycle, timestamps in ms from navigationStart. `endMs === null` means still open at end of observation. */
export interface NetRequest {
  readonly startMs: number;
  readonly endMs: number | null;
  readonly kind:
    | "document"
    | "script"
    | "style"
    | "image"
    | "font"
    | "xhr"
    | "fetch"
    | "websocket"
    | "eventsource"
    | "beacon"
    | "other";
}

/** A batched DOM mutation magnitude (already steady-state-down-weighted by the collector). */
export interface DomBatch {
  readonly t: number;
  readonly w: number;
}

/** A main-thread busy interval (long task / long-animation-frame), ms from navigationStart. */
export interface CpuInterval {
  readonly start: number;
  readonly end: number;
}

/** A viewport visual change sample (only emitted when the pixel diff exceeded epsilon). */
export interface VisChange {
  readonly t: number;
}

export interface FullLoadStreams {
  readonly net: readonly NetRequest[];
  readonly dom: readonly DomBatch[];
  readonly cpu: readonly CpuInterval[];
  readonly vis?: readonly VisChange[];
  readonly subTimeline: {
    readonly ttfb: number | null;
    readonly fcp: number | null;
    readonly lcp: number | null;
    readonly domContentLoaded: number | null;
    readonly loadEventEnd: number | null;
    readonly visuallyCompleteAt?: number | null;
  };
  /** Wall-clock end of observation (ms from navigationStart) — used to bound still-open requests. */
  readonly observedUntilMs: number;
}

const NON_BLOCKING_KINDS: ReadonlySet<NetRequest["kind"]> = new Set([
  "websocket",
  "eventsource",
  "beacon",
]);

const TIE_EPSILON_MS = 16;

type Signal = "network" | "main-thread" | "dom" | "paint" | "visual";

const ENABLED_BY_UNTIL: Record<FullLoadConfig["until"], readonly Signal[]> = {
  "load-event": [],
  "network-idle-2": ["network"],
  // `paint` (max of FCP/LCP) guarantees FLT is never earlier than the largest contentful paint —
  // the page is not "fully loaded" before its main content has painted.
  "fully-loaded": ["network", "main-thread", "dom", "paint"],
  "visually-complete": ["network", "main-thread", "dom", "paint", "visual"],
};

/**
 * The last instant the network had more than `netIdleThreshold` *blocking* requests in flight.
 * Returns 0 when the network was never blocking-busy.
 */
function networkBusyUntil(
  net: readonly NetRequest[],
  cfg: FullLoadConfig,
  threshold: number,
  observedUntilMs: number,
): number {
  // Build [start, blockingEnd) intervals, then sweep for the last time count > threshold.
  const edges: Array<{ t: number; delta: 1 | -1 }> = [];
  for (const r of net) {
    if (!cfg.strictNetwork && NON_BLOCKING_KINDS.has(r.kind)) continue;
    const rawEnd = r.endMs ?? observedUntilMs;
    let blockingEnd: number;
    if (cfg.strictNetwork) {
      blockingEnd = rawEnd;
    } else if (r.endMs === null || rawEnd - r.startMs > cfg.longLivedGraceMs) {
      // Long-lived / never-closed connection: stops counting as blocking after the grace window.
      blockingEnd = Math.min(rawEnd, r.startMs + cfg.longLivedGraceMs);
    } else {
      blockingEnd = rawEnd;
    }
    if (blockingEnd <= r.startMs) continue;
    edges.push({ t: r.startMs, delta: 1 });
    edges.push({ t: blockingEnd, delta: -1 });
  }
  // Sort by time; process -1 before +1 at the same timestamp so a close+open pair doesn't inflate the count.
  edges.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let count = 0;
  let lastBusy = 0;
  // busyUntil = the last instant the in-flight count transitions from >threshold down to <=threshold
  // (i.e. when the network finally goes quiet). This correctly handles a request that stays open
  // across sparse edges — the network is busy for the whole interval, not just at the edge times.
  for (const e of edges) {
    const before = count > threshold;
    count += e.delta;
    const after = count > threshold;
    if (before && !after) lastBusy = e.t;
  }
  // Still busy after all known edges (e.g. a request that never closed within observation).
  if (count > threshold) lastBusy = observedUntilMs;
  return lastBusy;
}

function domBusyUntil(dom: readonly DomBatch[], floor: number): number {
  let last = 0;
  for (const b of dom) {
    if (b.w >= floor && b.t > last) last = b.t;
  }
  return last;
}

function cpuBusyUntil(cpu: readonly CpuInterval[]): number {
  let last = 0;
  for (const i of cpu) {
    if (i.end > last) last = i.end;
  }
  return last;
}

function visBusyUntil(vis: readonly VisChange[] | undefined): number {
  if (!vis) return 0;
  let last = 0;
  for (const v of vis) {
    if (v.t > last) last = v.t;
  }
  return last;
}

const SIGNAL_PRIORITY: readonly Signal[] = ["network", "main-thread", "dom", "paint", "visual"];

/** Compute Full-Load Time from activity streams. Pure & deterministic. */
export function computeFullLoad(
  streams: FullLoadStreams,
  config?: Partial<FullLoadConfig>,
): FullLoadResult {
  const cfg: FullLoadConfig = { ...FULL_LOAD_DEFAULTS, ...config };
  const { observedUntilMs } = streams;

  // The network-idle-2 endpoint tolerates 2 in-flight by definition; other endpoints use the configured threshold (default 0).
  const effThreshold = cfg.until === "network-idle-2" ? 2 : cfg.netIdleThreshold;

  const busyUntil: Record<Signal, number> = {
    network: networkBusyUntil(streams.net, cfg, effThreshold, observedUntilMs),
    "main-thread": cpuBusyUntil(streams.cpu),
    dom: domBusyUntil(streams.dom, cfg.mutationNoiseFloor),
    paint: Math.max(streams.subTimeline.fcp ?? 0, streams.subTimeline.lcp ?? 0),
    visual: visBusyUntil(streams.vis),
  };

  const enabled = ENABLED_BY_UNTIL[cfg.until];

  // load-event endpoint: FLT is loadEventEnd, no settle needed.
  if (enabled.length === 0) {
    const flt = streams.subTimeline.loadEventEnd ?? 0;
    return {
      fltMs: flt,
      capped: false,
      gatingPhase: "none",
      gatingDistribution: {},
      subTimeline: buildSubTimeline(streams, busyUntil, cfg, flt),
    };
  }

  const busy = Math.max(0, ...enabled.map((s) => busyUntil[s]));

  let fltMs: number;
  let capped: boolean;
  // If the last busy instant is so late that a full settle window cannot fit before maxWait, cap.
  if (busy + cfg.settleWindowMs > cfg.maxWaitMs) {
    capped = true;
    fltMs = cfg.maxWaitMs;
  } else {
    capped = false;
    fltMs = busy;
  }

  const gatingDistribution: Record<string, number> = {};
  for (const s of enabled) gatingDistribution[s] = busyUntil[s];

  const gatingPhase = computeGatingPhase(enabled, busyUntil, busy);

  return {
    fltMs,
    capped,
    gatingPhase,
    gatingDistribution,
    subTimeline: buildSubTimeline(streams, busyUntil, cfg, fltMs),
  };
}

function computeGatingPhase(
  enabled: readonly Signal[],
  busyUntil: Record<Signal, number>,
  busy: number,
): GatingPhase {
  if (busy <= 0) return "none";
  // Candidates whose last-busy is within TIE_EPSILON of the max.
  const tied = enabled.filter((s) => Math.abs(busyUntil[s] - busy) <= TIE_EPSILON_MS);
  for (const s of SIGNAL_PRIORITY) {
    if (tied.includes(s)) return s;
  }
  return "none";
}

function buildSubTimeline(
  streams: FullLoadStreams,
  busyUntil: Record<Signal, number>,
  cfg: FullLoadConfig,
  fltMs: number,
): FullLoadSubTimeline {
  const base: FullLoadSubTimeline = {
    ttfb: streams.subTimeline.ttfb,
    fcp: streams.subTimeline.fcp,
    lcp: streams.subTimeline.lcp,
    domContentLoaded: streams.subTimeline.domContentLoaded,
    loadEventEnd: streams.subTimeline.loadEventEnd,
    networkIdleAt: busyUntil.network > 0 ? busyUntil.network : null,
    lastMutationAt: busyUntil.dom > 0 ? busyUntil.dom : null,
    lastLongTaskEndAt: busyUntil["main-thread"] > 0 ? busyUntil["main-thread"] : null,
    fltMs,
  };
  if (cfg.visual) {
    return {
      ...base,
      visuallyCompleteAt: busyUntil.visual > 0 ? busyUntil.visual : (streams.subTimeline.visuallyCompleteAt ?? null),
    };
  }
  return base;
}
