// evaluateRx — pure: turn a diagnosed Report (hotspots + topology + fullLoad) into ranked,
// targeted, impact-estimated remediations. Prioritized by FLT impact via gatingHeadroom, and
// trust-gated (no confident prescriptions on noise). Deterministic; no I/O.

import type {
  GatingPhase,
  Hotspot,
  Recommendation,
  Report,
  RunReport,
  RxRule,
} from "./types.js";

export interface RxResult {
  readonly recommendations: Recommendation[];
  readonly note?: string;
}

// Detection thresholds (see openspec/changes/add-remediation-engine/spec).
const VIRTUALIZE_MIN_CHILDREN = 100;
const VIRTUALIZE_MIN_NODES = 1000;
const VIRTUALIZE_MIN_OFFSCREEN = 0.5;
const VIEWPORT_ONLY_MIN_NODES = 1500;
const SPLIT_JS_MIN_MS = 350;
const OFFLOAD_3P_MIN_MS = 200;
const IMG_RE = /\.(avif|webp|jpe?g|png|gif|svg)(\?|$)/i;

interface RxTemplate {
  readonly title: string;
  readonly problem: string;
  readonly strategy: string;
  readonly alternativeStrategies: readonly string[];
  readonly howTo: { readonly generic: string; readonly frameworks: Readonly<Record<string, string>> };
}

const TEMPLATES: Record<RxRule, RxTemplate> = {
  "R1-lazy-media": {
    title: "Lazy-load off-screen media",
    problem: "Media below the fold is fetched eagerly, delaying network-idle.",
    strategy: 'Add loading="lazy" + fetchpriority="low" to off-screen images/iframes.',
    alternativeStrategies: ["IntersectionObserver-driven loading", "responsive srcset/sizes"],
    howTo: {
      generic: '<img src="…" loading="lazy" fetchpriority="low" width="…" height="…">',
      frameworks: {
        react: '<img src={src} loading="lazy" fetchPriority="low" />',
        vue: '<img :src="src" loading="lazy" fetchpriority="low" />',
        svelte: '<img {src} loading="lazy" fetchpriority="low" />',
        vanilla: 'el.loading = "lazy"; el.fetchPriority = "low";',
      },
    },
  },
  "R2-virtualize": {
    title: "Virtualize the large list/grid",
    problem: "A large, mostly off-screen homogeneous list renders every row up-front — heavy layout/recalc.",
    strategy: "Render only the visible rows (windowing); recycle nodes on scroll.",
    alternativeStrategies: ["content-visibility:auto as a zero-JS fallback"],
    howTo: {
      generic: "Render only items intersecting the viewport (+overscan); set a fixed row height.",
      frameworks: {
        react: "@tanstack/react-virtual or react-window (FixedSizeList)",
        vue: "vue-virtual-scroller (<RecycleScroller>)",
        svelte: "svelte-virtual-list",
        vanilla: "@tanstack/virtual-core, or CSS content-visibility:auto + contain-intrinsic-size",
      },
    },
  },
  "R3-viewport-only": {
    title: "Render only what's in the viewport",
    problem: "The document has an excessive node count with much of it off-screen at load.",
    strategy: "Apply content-visibility:auto + contain-intrinsic-size to below-fold sections; defer their render.",
    alternativeStrategies: ["Defer below-fold component mount until scrolled into view"],
    howTo: {
      generic: ".below-fold { content-visibility: auto; contain-intrinsic-size: 0 600px; }",
      frameworks: {
        react: "Gate below-fold sections on an IntersectionObserver hook before mounting.",
        vue: "v-if on an IntersectionObserver ref for below-fold blocks.",
        svelte: "{#if visible} … {/if} driven by an intersection action.",
        vanilla: "content-visibility:auto on section elements.",
      },
    },
  },
  "R4-unblock-render": {
    title: "Eliminate render-blocking resources",
    problem: "Render-blocking CSS/JS in <head> delays first paint and network-idle.",
    strategy: "defer/async non-critical scripts; inline critical CSS; preload key assets.",
    alternativeStrategies: ["Split CSS into critical + deferred", "preconnect to key origins"],
    howTo: {
      generic: '<script defer src="…"> + inline critical CSS in <head>.',
      frameworks: {
        react: "Code-split routes; move non-critical CSS out of the critical path.",
        vue: "Async components + critical CSS extraction (vite-plugin-critical).",
        svelte: "SvelteKit: csr/ssr + preload directives.",
        vanilla: 'Add defer/async; <link rel="preload">.',
      },
    },
  },
  "R5-split-js": {
    title: "Code-split / defer the heavy bundle",
    problem: "One script accounts for a large share of main-thread time before the page settles.",
    strategy: "Dynamic-import non-critical code; defer/island hydration; offload pure compute to a Web Worker.",
    alternativeStrategies: ["Tree-shake unused exports", "requestIdleCallback for non-urgent work"],
    howTo: {
      generic: "const mod = await import('./heavy.js') — load on interaction/idle, not at boot.",
      frameworks: {
        react: "React.lazy + Suspense; defer non-critical providers.",
        vue: "defineAsyncComponent for heavy views.",
        svelte: "Dynamic import() in onMount or on:click.",
        vanilla: "Dynamic import() gated on interaction or requestIdleCallback.",
      },
    },
  },
  "R6-defer-hydration": {
    title: "Defer / island hydration",
    problem: "Main thread stays busy hydrating after load.",
    strategy: "Use island / selective / progressive hydration.",
    alternativeStrategies: ["client:visible / client:idle", "React 18 streaming + Suspense"],
    howTo: { generic: "Hydrate only interactive islands; defer the rest.", frameworks: {} },
  },
  "R7-fix-thrash": {
    title: "Fix forced reflow / layout thrash",
    problem: "A script reads layout right after writing it, forcing synchronous reflow.",
    strategy: "Batch DOM reads then writes via requestAnimationFrame.",
    alternativeStrategies: ["ResizeObserver instead of polling offset*"],
    howTo: { generic: "Read all geometry first, then write — never interleave in a loop.", frameworks: {} },
  },
  "R8-offload-3p": {
    title: "Offload third-party scripts",
    problem: "Third-party scripts consume significant main-thread time.",
    strategy: "Move third-parties to a Web Worker (Partytown), use a facade for embeds, or defer them.",
    alternativeStrategies: ["Facade/lite embeds", "self-host critical third-parties"],
    howTo: {
      generic: 'Load analytics/tags via Partytown (type="text/partytown") or defer until idle.',
      frameworks: {
        react: "@builder.io/partytown/react or a click-to-load facade.",
        vue: "Partytown integration; lazy embed facades.",
        svelte: "Partytown; intersection-gated embeds.",
        vanilla: "Partytown; replace embeds with click-to-load facades.",
      },
    },
  },
  "R9-font-swap": {
    title: "Swap web fonts",
    problem: "A web font blocks text render.",
    strategy: "font-display: swap + preload the font.",
    alternativeStrategies: ["Subset the font", "self-host"],
    howTo: { generic: "@font-face { font-display: swap } + <link rel=preload as=font>", frameworks: {} },
  },
  "R10-trim-unused": {
    title: "Trim unused JS/CSS",
    problem: "A large fraction of shipped JS/CSS is unused at load.",
    strategy: "Route-level code-split, tree-shake, purge unused CSS.",
    alternativeStrategies: ["PurgeCSS", "import only used modules"],
    howTo: { generic: "Split by route; purge CSS; import named exports only.", frameworks: {} },
  },
};

export function evaluateRx(report: Report): RxResult {
  const hotspots = report.hotspots ?? [];
  const rep: RunReport | undefined = report.runs.find((r) => r.domTopology) ?? report.runs[0];
  const topo = rep?.domTopology;
  const fl = report.fullLoad;
  const gate: GatingPhase = fl?.gatingPhase ?? "none";
  const dist = fl?.gatingDistribution ?? {};
  const flt = fl?.fltMs ?? 0;
  const unreliable =
    report.trustScore?.overall === "unreliable" || typeof fl?.trustReason === "string";

  const headroom = (signal: GatingPhase): number => {
    const others = Object.entries(dist)
      .filter(([k]) => k !== signal)
      .map(([, v]) => v);
    const secondLatest = others.length > 0 ? Math.max(...others) : 0;
    return Math.max(0, flt - secondLatest);
  };
  // estFltDeltaMs is bounded by the headroom of the gating signal; a fix off the gating path earns ~0.
  // When the aggregate gatingPhase is "mixed" (no single dominant signal across runs) or "none",
  // we cannot single out one gate — so we fall back to each rule's own signal headroom rather than
  // zeroing every recommendation (which would wrongly mark real findings as "no impact").
  const concreteGate = gate !== "mixed" && gate !== "none";
  const estFor = (signals: readonly GatingPhase[], detectedCost: number): { gating: boolean; est: number } => {
    const h = Math.max(...signals.map((s) => headroom(s)));
    if (concreteGate) {
      if (!signals.includes(gate)) return { gating: false, est: 0 };
      return { gating: true, est: Math.round(Math.min(detectedCost, h) * 10) / 10 };
    }
    return { gating: h > 0, est: Math.round(Math.min(detectedCost, h) * 10) / 10 };
  };

  const recs: Recommendation[] = [];
  const push = (
    rule: RxRule,
    target: Recommendation["target"],
    evidence: string,
    detectedCost: number,
    signals: readonly GatingPhase[],
    confidence: Recommendation["confidence"],
  ): void => {
    const t = TEMPLATES[rule];
    const { gating, est } = estFor(signals, detectedCost);
    recs.push({
      id: `${rule}:${target.selector ?? target.resource ?? "page"}`,
      rule,
      title: t.title,
      problem: t.problem,
      strategy: t.strategy,
      alternativeStrategies: t.alternativeStrategies,
      target,
      estFltDeltaMs: est,
      gating,
      confidence: unreliable ? "low" : confidence,
      howTo: t.howTo,
      evidence,
    });
  };

  // R1 — off-screen media fetched eagerly (network-gated resource hotspot that looks like an image).
  for (const h of hotspots.filter((x) => x.cause === "resource" && IMG_RE.test(x.selector))) {
    push("R1-lazy-media", { resource: h.selector }, h.evidence ?? h.label, h.costMs, ["network"], "high");
  }

  // R2 — large, mostly-off-screen homogeneous container.
  for (const c of topo?.containers ?? []) {
    if (
      c.childCount >= VIRTUALIZE_MIN_CHILDREN &&
      c.nodeCount >= VIRTUALIZE_MIN_NODES &&
      c.offscreenFraction >= VIRTUALIZE_MIN_OFFSCREEN
    ) {
      const domHot = hotspots.find((h) => h.cause === "dom-size" && h.selector === c.selector);
      const detected = (domHot?.costMs ?? 0) * c.offscreenFraction;
      push(
        "R2-virtualize",
        { selector: c.selector },
        `container ${c.selector}: ${String(c.childCount)} children, ${String(c.nodeCount)} nodes, ${String(Math.round(c.offscreenFraction * 100))}% off-screen, ${String(Math.round(c.similarChildrenRatio * 100))}% homogeneous`,
        detected,
        ["main-thread", "dom"],
        "high",
      );
    }
  }

  // R3 — excessive DOM with significant off-screen bulk.
  if (topo && topo.totalNodes >= VIEWPORT_ONLY_MIN_NODES) {
    const offscreenContainers = topo.containers.filter((c) => c.offscreenFraction >= 0.5);
    if (offscreenContainers.length > 0) {
      const layoutMs = (rep?.runtime?.["layoutDuration"] ?? 0) + (rep?.runtime?.["recalcStyleDuration"] ?? 0);
      push(
        "R3-viewport-only",
        { selector: "document" },
        `document has ${String(topo.totalNodes)} nodes with ${String(offscreenContainers.length)} large off-screen container(s)`,
        layoutMs * 0.5,
        ["main-thread", "dom"],
        "medium",
      );
    }
  }

  // R4 — render-blocking resources.
  for (const h of hotspots.filter((x) => x.cause === "resource" && !IMG_RE.test(x.selector))) {
    push("R4-unblock-render", { resource: h.selector }, h.evidence ?? h.label, h.costMs, ["network"], "high");
  }

  // R5 — a script bundle dominating main-thread time.
  for (const h of hotspots.filter((x) => x.cause === "script" && x.costMs >= SPLIT_JS_MIN_MS)) {
    push("R5-split-js", { resource: h.selector }, h.evidence ?? h.label, h.costMs, ["main-thread"], "medium");
  }

  // R8 — heavy third-party main-thread time.
  for (const h of hotspots.filter((x) => x.cause === "third-party" && x.costMs >= OFFLOAD_3P_MIN_MS)) {
    push("R8-offload-3p", { resource: h.selector }, h.evidence ?? h.label, h.costMs, ["main-thread", "network"], "medium");
  }

  // Rank by estimated FLT impact × confidence.
  const weight = (c: Recommendation["confidence"]): number => (c === "high" ? 1 : c === "medium" ? 0.6 : 0.3);
  recs.sort((a, b) => b.estFltDeltaMs * weight(b.confidence) - a.estFltDeltaMs * weight(a.confidence));

  const result: RxResult = unreliable
    ? {
        recommendations: recs,
        note: "Measurement is statistically unreliable — re-run with more runs (e.g. --runs 10 --mode ci-stable) before acting on these recommendations.",
      }
    : { recommendations: recs };
  return result;
}
