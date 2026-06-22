import {
  type CollectorContext,
  type CollectorFactory,
  type CollectorHandle,
  type CollectorResult,
  emptyCollectorResult,
} from "../collectors.js";
import type { CpuInterval, DomBatch, NetRequest } from "../full-load.js";
import type { CDPSessionLike } from "../types.js";

// One in-page script captures all three activity streams in the page timebase
// (performance.now() == ms from navigationStart), read back on finalize. Network
// uses the Resource Timing API (so WebSocket/EventSource never appear and thus
// never block FLT); CPU prefers Long-Animation-Frames, falling back to longtask.
const FULL_LOAD_INLINE_SCRIPT = `
(() => {
  if (window.__ohmyperfFL) return;
  const fl = { net: [], dom: [], cpu: [] };
  window.__ohmyperfFL = fl;
  function mapKind(it, name) {
    switch (it) {
      case 'img': return 'image';
      case 'script': return 'script';
      case 'css':
      case 'link': return 'style';
      case 'xmlhttprequest': return 'xhr';
      case 'fetch': return 'fetch';
      case 'beacon': return 'beacon';
      case 'navigation': return 'document';
      default:
        if (typeof name === 'string' && /\\.(woff2?|ttf|otf|eot)(\\?|$)/i.test(name)) return 'font';
        return 'other';
    }
  }
  try {
    const ro = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const end = e.responseEnd || e.startTime;
        fl.net.push({ startMs: e.startTime, endMs: end, kind: mapKind(e.initiatorType, e.name) });
      }
    });
    ro.observe({ type: 'resource', buffered: true });
    try { ro.observe({ type: 'navigation', buffered: true }); } catch (_) {}
  } catch (_) {}
  try {
    const mo = new MutationObserver((muts) => {
      let w = 0;
      for (const m of muts) {
        w += m.addedNodes.length + m.removedNodes.length;
        if (m.type === 'attributes') w += 0.25;
        else if (m.type === 'characterData') w += 0.1;
      }
      if (w > 0) fl.dom.push({ t: performance.now(), w: w });
    });
    const startObs = () => {
      try {
        mo.observe(document.documentElement || document, {
          childList: true, subtree: true, attributes: true, characterData: true,
        });
      } catch (_) {}
    };
    if (document.documentElement) startObs();
    else document.addEventListener('readystatechange', startObs, { once: true });
  } catch (_) {}
  try {
    const co = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) fl.cpu.push({ start: e.startTime, end: e.startTime + e.duration });
    });
    let usedLoaf = false;
    try { co.observe({ type: 'long-animation-frame', buffered: true }); usedLoaf = true; } catch (_) {}
    if (!usedLoaf) { try { co.observe({ type: 'longtask', buffered: true }); } catch (_) {} }
  } catch (_) {}
})();
`;

interface RawFL {
  net?: unknown;
  dom?: unknown;
  cpu?: unknown;
  nav?: { loadEventEnd?: unknown; dcl?: unknown; ttfb?: unknown };
  fcp?: unknown;
}

// Read the captured streams plus Navigation Timing + FCP in one round-trip.
const FULL_LOAD_SNAPSHOT_EXPR = `JSON.stringify((function () {
  var fl = window.__ohmyperfFL || { net: [], dom: [], cpu: [] };
  var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
  var fcpE = (performance.getEntriesByName && performance.getEntriesByName('first-contentful-paint')[0]) || null;
  return {
    net: fl.net, dom: fl.dom, cpu: fl.cpu,
    nav: { loadEventEnd: nav.loadEventEnd || null, dcl: nav.domContentLoadedEventEnd || null, ttfb: nav.responseStart || null },
    fcp: fcpE ? fcpE.startTime : null,
  };
})())`;

interface RuntimeEvaluateResult {
  result?: { value?: unknown };
  exceptionDetails?: unknown;
}

export const fullLoadCollectorFactory: CollectorFactory = {
  id: "ohmyperf.full-load",
  requires: [],
  async create(session: CDPSessionLike, ctx: CollectorContext): Promise<CollectorHandle> {
    let installed = false;
    try {
      await session.send("Runtime.enable");
      await session.send("Page.enable");
      await session.send("Page.addScriptToEvaluateOnNewDocument", {
        source: FULL_LOAD_INLINE_SCRIPT,
        runImmediately: true,
      });
      installed = true;
    } catch (err) {
      ctx.logger.debug("full-load-collector: install failed", {
        frameId: ctx.frameId,
        error: errMessage(err),
      });
    }

    return {
      id: fullLoadCollectorFactory.id,
      async finalize(): Promise<CollectorResult> {
        // Only the root frame contributes the page-level full-load signals.
        if (!installed || !ctx.isRoot) {
          return emptyCollectorResult(installed ? undefined : "full-load-injection-failed");
        }
        try {
          const result = (await session.send("Runtime.evaluate", {
            expression: FULL_LOAD_SNAPSHOT_EXPR,
            returnByValue: true,
            awaitPromise: false,
          })) as RuntimeEvaluateResult;
          if (result.exceptionDetails) return emptyCollectorResult("full-load-snapshot-unavailable");
          const value = result.result?.value;
          if (typeof value !== "string") return emptyCollectorResult("full-load-snapshot-not-string");
          const raw = JSON.parse(value) as RawFL;
          return {
            metrics: {},
            longTasks: [],
            resources: [],
            available: true,
            fullLoadSignals: {
              net: toNetRequests(raw.net),
              dom: toDomBatches(raw.dom),
              cpu: toCpuIntervals(raw.cpu),
              subTimeline: {
                ttfb: numOrNull(raw.nav?.ttfb),
                fcp: numOrNull(raw.fcp),
                domContentLoaded: numOrNull(raw.nav?.dcl),
                loadEventEnd: numOrNull(raw.nav?.loadEventEnd),
              },
            },
          };
        } catch (err) {
          return emptyCollectorResult(`full-load-finalize-error: ${errMessage(err)}`);
        }
      },
      async dispose(): Promise<void> {
        return undefined;
      },
    };
  },
};

const VALID_KINDS: ReadonlySet<string> = new Set([
  "document",
  "script",
  "style",
  "image",
  "font",
  "xhr",
  "fetch",
  "websocket",
  "eventsource",
  "beacon",
  "other",
]);

function toNetRequests(v: unknown): NetRequest[] {
  if (!Array.isArray(v)) return [];
  const out: NetRequest[] = [];
  for (const x of v) {
    if (x === null || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o["startMs"] !== "number" || typeof o["endMs"] !== "number") continue;
    const kind = typeof o["kind"] === "string" && VALID_KINDS.has(o["kind"]) ? o["kind"] : "other";
    out.push({ startMs: o["startMs"], endMs: o["endMs"], kind: kind as NetRequest["kind"] });
  }
  return out;
}

function toDomBatches(v: unknown): DomBatch[] {
  if (!Array.isArray(v)) return [];
  const out: DomBatch[] = [];
  for (const x of v) {
    if (x === null || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o["t"] !== "number" || typeof o["w"] !== "number") continue;
    out.push({ t: o["t"], w: o["w"] });
  }
  return out;
}

function toCpuIntervals(v: unknown): CpuInterval[] {
  if (!Array.isArray(v)) return [];
  const out: CpuInterval[] = [];
  for (const x of v) {
    if (x === null || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o["start"] !== "number" || typeof o["end"] !== "number") continue;
    out.push({ start: o["start"], end: o["end"] });
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
