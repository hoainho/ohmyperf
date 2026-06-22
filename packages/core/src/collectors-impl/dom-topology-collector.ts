import {
  type CollectorContext,
  type CollectorFactory,
  type CollectorHandle,
  type CollectorResult,
  emptyCollectorResult,
} from "../collectors.js";
import type { CDPSessionLike, DomContainer, DomTopology } from "../types.js";

// One Runtime.evaluate at finalize snapshots the live DOM: total nodes, max depth, and the
// significant containers (>= MIN_CHILDREN element children), with subtree size, off-screen
// fraction (getBoundingClientRect vs viewport), and child-signature homogeneity — the inputs
// the Rx engine needs to recommend lazy-load / virtualize / viewport-only.
const TOPOLOGY_EXPR = `JSON.stringify((function () {
  var MIN_CHILDREN = 30, MAX_CONTAINERS = 20, MAX_NODES_FOR_DEPTH = 8000;
  var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
  function sel(el) {
    if (el.id) return '#' + el.id;
    var s = el.tagName.toLowerCase();
    if (typeof el.className === 'string' && el.className.trim()) {
      var c = el.className.trim().split(/\\s+/)[0];
      if (c) s += '.' + c;
    }
    return s;
  }
  function sig(el) {
    var s = el.tagName;
    if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\\s+/)[0];
    return s;
  }
  var all = document.getElementsByTagName('*');
  var totalNodes = all.length;
  var maxDepth = 0;
  if (totalNodes <= MAX_NODES_FOR_DEPTH) {
    for (var i = 0; i < all.length; i++) {
      var d = 0, n = all[i];
      while (n && n.parentElement) { n = n.parentElement; d++; }
      if (d > maxDepth) maxDepth = d;
    }
  }
  var containers = [];
  var scope = document.body ? document.body.getElementsByTagName('*') : [];
  for (var j = 0; j < scope.length; j++) {
    var el = scope[j];
    var kids = el.children;
    if (!kids || kids.length < MIN_CHILDREN) continue;
    var sub = el.getElementsByTagName('*').length + 1;
    var sigCount = {}, maxSig = 0, off = 0;
    for (var k = 0; k < kids.length; k++) {
      var sg = sig(kids[k]);
      sigCount[sg] = (sigCount[sg] || 0) + 1;
      if (sigCount[sg] > maxSig) maxSig = sigCount[sg];
      var r = kids[k].getBoundingClientRect();
      if (r.top >= vh) off++;
    }
    containers.push({
      selector: sel(el),
      signature: sig(el) + '>' + (kids[0] ? sig(kids[0]) : ''),
      childCount: kids.length,
      nodeCount: sub,
      offscreenFraction: kids.length ? off / kids.length : 0,
      similarChildrenRatio: kids.length ? maxSig / kids.length : 0,
    });
  }
  containers.sort(function (a, b) { return b.nodeCount - a.nodeCount; });
  return { totalNodes: totalNodes, maxDepth: maxDepth, viewport: { width: vw, height: vh }, containers: containers.slice(0, MAX_CONTAINERS) };
})())`;

interface RuntimeEvaluateResult {
  result?: { value?: unknown };
  exceptionDetails?: unknown;
}

export const domTopologyCollectorFactory: CollectorFactory = {
  id: "ohmyperf.dom-topology",
  requires: [],
  async create(session: CDPSessionLike, ctx: CollectorContext): Promise<CollectorHandle> {
    let installed = false;
    try {
      await session.send("Runtime.enable");
      installed = true;
    } catch (err) {
      ctx.logger.debug("dom-topology-collector: install failed", {
        frameId: ctx.frameId,
        error: errMessage(err),
      });
    }
    return {
      id: domTopologyCollectorFactory.id,
      async finalize(): Promise<CollectorResult> {
        if (!installed || !ctx.isRoot) {
          return emptyCollectorResult(installed ? undefined : "dom-topology-install-failed");
        }
        try {
          const result = (await session.send("Runtime.evaluate", {
            expression: TOPOLOGY_EXPR,
            returnByValue: true,
            awaitPromise: false,
          })) as RuntimeEvaluateResult;
          if (result.exceptionDetails) return emptyCollectorResult("dom-topology-eval-failed");
          const value = result.result?.value;
          if (typeof value !== "string") return emptyCollectorResult("dom-topology-not-string");
          const topology = parseTopology(JSON.parse(value));
          if (!topology) return emptyCollectorResult("dom-topology-parse-failed");
          return { metrics: {}, longTasks: [], resources: [], available: true, domTopology: topology };
        } catch (err) {
          return emptyCollectorResult(`dom-topology-finalize-error: ${errMessage(err)}`);
        }
      },
      async dispose(): Promise<void> {
        return undefined;
      },
    };
  },
};

function parseTopology(v: unknown): DomTopology | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o["totalNodes"] !== "number") return null;
  const vp = o["viewport"] as Record<string, unknown> | undefined;
  const containersRaw = Array.isArray(o["containers"]) ? o["containers"] : [];
  const containers: DomContainer[] = [];
  for (const c of containersRaw) {
    if (c === null || typeof c !== "object") continue;
    const co = c as Record<string, unknown>;
    if (typeof co["selector"] !== "string" || typeof co["childCount"] !== "number") continue;
    containers.push({
      selector: co["selector"],
      signature: typeof co["signature"] === "string" ? co["signature"] : "",
      childCount: co["childCount"],
      nodeCount: numOr(co["nodeCount"], 0),
      offscreenFraction: clamp01(numOr(co["offscreenFraction"], 0)),
      similarChildrenRatio: clamp01(numOr(co["similarChildrenRatio"], 0)),
    });
  }
  return {
    totalNodes: o["totalNodes"],
    maxDepth: numOr(o["maxDepth"], 0),
    viewport: { width: numOr(vp?.["width"], 0), height: numOr(vp?.["height"], 0) },
    containers,
  };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
