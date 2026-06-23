# OhMyPerf — Paradigm Shift: Full-Load Diagnosis & Remediation

**Date:** 2026-06-21 · **Supersedes the *thesis* of** [`V2_IMPROVEMENT_PLAN.md`](./V2_IMPROVEMENT_PLAN.md) · **builds on the *foundation* of** [`CLI_UPGRADE_PLAN_v0.2.0.md`](./CLI_UPGRADE_PLAN_v0.2.0.md)

---

## 0. The mindset change

| | **Old thinking (today)** | **New thinking (this plan)** |
|---|---|---|
| What we measure | LCP-centric Core Web Vitals — *"largest paint happened"* | **Fully-Loaded Time (FLT)** — *"everything is actually done: network, DOM, main thread, pixels"* |
| What "loaded" means | A single element painted | The page **settled** — no more requests, no more DOM injection, no more long tasks |
| The output | A number + a 🟢/🔴 verdict | **A diagnosis + an action plan**: which component is slow, *why*, and the exact strategy to fix it |
| The job | *Describe* performance | **Diagnose causes → prescribe remediation** (lazy-load / virtualize / viewport-only / split) with estimated impact |
| Posture | Passive measurement tool | **Performance advisor** — it tells you what to change and what it will buy you |

> **LCP is not "loaded."** On `moodtrip.hoainho.info` LCP fired at 570ms, but a SPA keeps fetching chunks, hydrating, and injecting DOM long after that. The user-felt "page is ready" moment is **later** and **not** captured by any single CWV. We will measure that real moment, then explain and fix what delays it.

---

## 1. New North-Star metric — OhMyPerf **Fully-Loaded Time (FLT)** (not LCP-derived)

### Definition (multi-signal "settle" model)
FLT = the earliest timestamp `T` after `navigationStart` such that, for a **settle window** `W` (default 1000 ms), **all** of these are simultaneously quiet:

1. **Network-quiet** — in-flight requests ≤ `k` (`k=0` strict, `k=2` lenient/"network-idle-2"). Captures async/XHR/`fetch`/lazy chunks, fonts, late images.
2. **DOM-mutation-quiet** — no *significant* DOM mutations (added/removed nodes or meaningful attribute/text changes above a noise threshold). **Captures SPA client-render, hydration, infinite-scroll, skeleton→content swaps** — the things LCP and `load` completely miss.
3. **Main-thread-quiet** — no long task / long-animation-frame (>50 ms). Captures JS still executing after paint.
4. *(opt, `--filmstrip`)* **Visual-quiet** — no viewport pixel change for `W` (Speed-Index / "Visually Complete" style).

`FLT` = start of the **final persistent quiet window** that holds to end-of-trace, capped by `--max-wait` (default 30 s). If a signal never quiets (e.g. a polling timer), report `FLT = capped` + which signal kept it busy.

### The diagnosis is built into the metric
Report the **gating signal**: *"what kept the page busy until FLT?"* → `network` | `main-thread` | `dom` | `visual`. Plus the sub-timeline:
`TTFB → FCP → DOMContentLoaded → loadEventEnd → last-resource-end → last-DOM-mutation → last-long-task-end → network-idle-reached → **FLT**`.
This turns one number into a story: *"FLT was 4.2s; gated by **main-thread** — JS kept running 2.1s after `load` (hydration)."*

### Endpoint menu (you choose what "done" means)
`ohmyperf run --until load-event | network-idle-2 | fully-loaded(default) | visually-complete`

### Feasibility — grounded in existing collectors
| Signal | Status in ohmyperf | Work |
|---|---|---|
| `navigationStart`, `DOMContentLoaded`, `loadEventEnd` | ✅ `loading-collector.ts` (lifecycle) | surface as timings |
| in-flight network count | ✅ `resource-collector.ts` (`requestWillBeSent`/`loadingFinished`) | add a running counter + idle-timestamp |
| long tasks | ✅ `longtask-collector.ts` | reuse for main-thread-quiet |
| DOM mutations | ❌ | **NEW** `dom-mutation-collector` — inject `MutationObserver` via `Page.addScriptToEvaluateOnNewDocument` |
| Long-Animation-Frames (LoAF) | ⚠️ referenced in `web-vitals-attribution` | **NEW** `loaf-collector` (`PerformanceObserver('long-animation-frame')`) |
| visual filmstrip | ❌ | **NEW opt-in** `filmstrip-collector` (periodic `Page.captureScreenshot`) |

A new aggregated metric `fullLoad` + sub-signals lands in the report — which is exactly why the **schema-migration helper (P1.8 in the v0.2.0 plan) is the prerequisite**.

---

## 2. Diagnosis — *why* is a component slow? → OhMyPerf **Hotspots**

A ranked **component-cost table**. For each significant DOM region we attribute cost and name the cause:

| Source | What it tells us | Status |
|---|---|---|
| **LoAF `scripts[]`** (`sourceURL`, `sourceFunctionName`, `invoker`, `styleAndLayoutDuration`) | *The single best "which code/component is slow"* — slow frames mapped to the exact script + function | NEW collector |
| **Long task → script → sourcemap** | Long task → bundle → original function/module (ohmyperf already has `SourceLocation` + sourcemap detection) | extend |
| **Forced reflow / layout thrash** (trace: `Layout` synchronously after style mutation in one task) | "This script reads layout right after writing → thrash" | from `trace-collector` |
| **Excessive DOM size** (`runtime.nodeCount` ✅ + depth + max-children) | Flags the over-rendered container — **the signal that triggers *virtualize*** | extend `loading-collector` |
| **Off-screen-at-load heavy elements** (`getBoundingClientRect` ✅ vs viewport) | Content rendered but never visible at load — **triggers *lazy-load / viewport-only*** | NEW `dom-topology-collector` |
| **Resource waterfall + initiator** (`resource-collector` ✅) | Which script requested which late/heavy resource | extend |

**Output:** `hotspots[]` = `{ selector, label, costMs, bytes, nodeCount, offscreen, gatingPhase, cause, evidence }`, ranked by contribution to FLT.

---

## 3. Where to fix — the UI hotspot map

- **Above-the-fold vs below-the-fold split** (geometry from `getBoundingClientRect`): content *below* the fold but *eagerly* loaded/rendered = waste.
- Each hotspot maps to a **DOM selector + (with `--filmstrip`) a screenshot crop** so you literally see the region.
- Verdict per region: *"This grid (1 of viewport-height tall, 1,840 nodes, 320 KB) is 80% off-screen at load and costs 1.1s of layout/recalc → biggest win."*

---

## 4. Prescribe the fix — OhMyPerf **Rx** (every best practice, as rules)

A detector→strategy→impact engine. Each recommendation is **targeted (selector/resource)**, **estimated (FLT delta + confidence)**, and ships a **code-level how-to**.

| # | Detected pattern | Prescribed strategy | Est. impact |
|---|---|---|---|
| Rx-1 | Off-screen `<img>`/`<iframe>` loaded eagerly | **Native lazy-load** (`loading="lazy"`, `fetchpriority="low"`) / IntersectionObserver | eager off-screen bytes ÷ bandwidth |
| Rx-2 | Large homogeneous list/grid (>N similar children, big off-screen subtree) | **Windowing / virtualization** — render only visible rows (react-window/virtual, TanStack Virtual, CDK scrolling) | nodes & layout/recalc time removed |
| Rx-3 | Excessive DOM rendered, mostly off-screen | **Viewport-only render** + `content-visibility:auto` + `contain-intrinsic-size` | deferred off-screen layout/paint |
| Rx-4 | Render-blocking CSS/JS in `<head>` | **defer/async**, inline **critical CSS**, `preload` key assets | FCP/FLT shaved by blocking time |
| Rx-5 | Long tasks from one bundle / heavy hydration | **Code-split** (dynamic `import()`), **island/deferred hydration**, move work to **Web Worker** | main-thread-quiet reached earlier |
| Rx-6 | Layout thrash (read-after-write) | **Batch DOM reads/writes** (rAF), avoid forced sync layout | recalc/layout time removed |
| Rx-7 | Large unused JS/CSS | **Tree-shake, route-level split, purge CSS** | transfer + parse time |
| Rx-8 | Many 3rd-party scripts on main thread | **Web Worker (Partytown)**, **facade** for embeds, `defer` | main-thread contention removed |

Recommendations are **sorted by estimated FLT impact** and **gated on statistical trust** (don't prescribe a fix for noise — reuses the v0.2.0 quality core). This is the "turn a number into an action plan" payoff.

---

## 5. Architecture mapping (concrete, on real files)

- **New collectors** (`packages/core/src/collectors-impl/`): `dom-mutation-collector`, `loaf-collector`, `dom-topology-collector` (size/depth/off-screen), `network-idle` (extend resource-collector), opt-in `filmstrip-collector`.
- **New report fields**: `fullLoad` (FLT + sub-signals + `gatingPhase`), `hotspots[]`, `recommendations[]` → **requires the schema-version helper (v0.2.0 P1.8)**.
- **New plugins** (`packages/plugins-builtin/`): `hotspots` (component cost), `rx` (remediation rules) — emit audits/opportunities with `strategy`, `estimatedImpactMs`, `targetSelector`.
- **CLI**: `run --until <endpoint> --diagnose --rx --filmstrip`; **new** `ohmyperf diagnose <url>` (FLT + hotspots + Rx in one shot); HTML report gains a **"Hotspots & Fixes"** panel + filmstrip; **MCP** gains `analyze_report` insights `full-load-breakdown`, `hotspots`, `remediation`.
- **Reuses** the statistical trust core and the registry/resolver from the v0.2.0 plan — nothing is thrown away; the foundation is what makes this trustworthy.

---

## 6. How this reframes the v0.2.0 plan (nothing wasted)

The v0.2.0 plan stops being the destination and becomes the **foundation**:
- **Move A (one quality/verdict core)** → FLT gets the *same* aggregation + trust + CoV treatment; Rx gates on it.
- **Move B (registry + resolver)** → new collectors/plugins/reporters plug into one registry.
- **P1.8 schema-version helper** → the prerequisite for adding `fullLoad`/`hotspots`/`recommendations` without breaking 1.x readers.
- **P1.1 emulation/throttling** → FLT *must* be measured under a device/network profile to be meaningful (a fast desktop hides the very slowness we diagnose).

---

## 7. New roadmap

| Version | Theme | Ships |
|---|---|---|
| **v0.2.0** (foundation) | *Make measurement trustworthy* | the existing CLI-upgrade plan (quality core, registry/resolver, schema helper, trust-gating, emulation) |
| **v0.3.0** "Measure what's real" | **FLT** | dom-mutation + loaf + network-idle collectors; `fullLoad` metric + gating-phase breakdown; `run --until …`. ← **your #1 ask** |
| **v0.4.0** "Diagnose" | **Hotspots** | LoAF+sourcemap attribution, DOM topology, off-screen analysis, above/below-fold map, HTML panel, MCP insight |
| **v0.5.0 → v1.0** "Remediate" | **Rx** | the strategy rules engine (lazy/virtualize/viewport-only/split), impact estimates, code snippets, `ohmyperf diagnose`, filmstrip/visually-complete |

## 8. Risks & feasibility notes

- **LoAF + CDP are Chromium-only** — fine; ohmyperf is Chromium/CDP-based by design.
- **Mutation/visual settle can be fooled** by animations, carousels, polling timers → noise threshold + "ignore steady-state animation" heuristic + `--max-wait` cap + report the gating signal so the user sees *why* it didn't settle.
- **Impact estimates are heuristics** → always label as estimates, attach confidence, and gate on trust (never prescribe on `unreliable`/noise).
- **Detections are framework-agnostic, fixes are framework-specific** → Rx ships a generic strategy + framework hints (React/Vue/Svelte/vanilla); it points the way, the dev picks the library.
- **FLT raises run time** → pairs with the v0.2.0 browser-reuse / `--concurrency` performance work.

---

### One-line thesis
**OhMyPerf becomes the tool that measures when your page is *truly* done, tells you which component is dragging and why, and hands you the exact strategy — lazy-load, virtualize, render-only-what's-visible, or split — to make it fast.**
