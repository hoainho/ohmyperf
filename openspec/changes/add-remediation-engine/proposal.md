# Proposal: Remediation Engine (Rx) — prescribe the optimal fix, ranked by FLT impact

## Why

`add-diagnostic-insights` makes OhMyPerf able to say *what* is slow (long tasks → JS URL, render-blocking `wastedMs`, third-party main-thread time, LCP/INP/CLS breakdowns). `add-full-load-time` adds *when* the page is truly done (FLT) and *which signal* gated it. The missing third step is the one users actually act on: **what do I change, and how much will it help?**

Today there is **no prescriptive layer**. The v1 project explicitly listed *"AI-powered 'fix this' suggestions"* as a **non-goal** — this proposal deliberately reverses that for the new product direction: OhMyPerf becomes a **performance advisor**, not just a measurement tool.

Two things make this more than a generic checklist:
1. **It is grounded in the page's own measured signals** (DOM topology, off-screen geometry, gating phase, attributed long tasks) — not generic advice.
2. **It is prioritized by FLT impact using `gatingHeadroom`** (from `add-full-load-time`): a fix on a *non-gating* signal earns ≈0 FLT improvement and is labelled as such. This stops the tool from recommending work that won't move the number — the difference between "best practices" and *optimal* practices for *this* page.

## What changes

### Added (engine layer)

- `packages/core/src/collectors-impl/dom-topology-collector.ts` — **NEW**. One `Runtime.evaluate` snapshot at the FLT checkpoint capturing, per significant container: tag/class signature, `childCount`, subtree `nodeCount`, max depth, `getBoundingClientRect` vs viewport (→ `offscreenFraction`), and structural-similarity of children (for list/grid detection). Also total document `nodeCount`/depth.
- `packages/plugins-builtin/src/hotspots.ts` — **NEW plugin**. Joins the topology snapshot with attributed long tasks/LoAF (from `add-diagnostic-insights`) and the resource waterfall to emit `report.hotspots[] = { selector, label, costMs, bytes, nodeCount, offscreenFraction, gatingPhase, cause }`, ranked by contribution to FLT.
- `packages/plugins-builtin/src/rx.ts` — **NEW plugin**. A deterministic rule engine: each rule is `(detect → diagnose → strategies[] → estimateImpact → emit)`. Emits `report.recommendations[]`. Rules R1–R10 in `design`/spec. Pure given the report; unit-testable with fixture reports.
- `packages/core/src/types.ts` — additive-optional: `Report.hotspots?: Hotspot[]`, `Report.recommendations?: Recommendation[]` where `Recommendation = { id, rule, title, problem, strategy, alternativeStrategies, target: { selector?, resource? }, estFltDeltaMs, gating: boolean, confidence: 'high'|'medium'|'low', howTo: { generic, frameworks } , evidence }`.

### Added (CLI + surfaces)

- `apps/cli/src/commands/run.ts` — `--diagnose` (compute hotspots) and `--rx` (compute recommendations); both imply the diagnosis collectors. Human summary prints the top-3 recommendations with estimated FLT savings; `--json` includes the full arrays.
- **NEW** `apps/cli/src/commands/diagnose.ts` — `ohmyperf diagnose <url>` = `run` with `--diagnose --rx` on, output focused on the hotspot table + ranked Rx list (one-shot "why slow + what to fix").
- `apps/mcp-server/src/server.ts` — `analyze_report` insights `hotspots` and `remediation`; a `get_fix_plan`-style ordered plan keyed off `gatingPhase`.
- `packages/viewer` (HTML) + `reporter-markdown` — a "Hotspots & Fixes" panel: ranked recommendations with target selector, estimated FLT delta, confidence, and a copy-pasteable code snippet (+ framework tabs).

## The Rx rule catalog (detector → strategy)

| Rule | Detect (thresholds) | Primary strategy | Alternatives |
|---|---|---|---|
| **R1 Lazy media** | off-screen `<img>/<iframe>/<video>` (`rect.top > viewport.h`) loaded before FLT, no `loading="lazy"` | native `loading="lazy"` + `fetchpriority="low"` | IntersectionObserver, responsive `srcset/sizes` |
| **R2 Virtualize** | container with `childCount ≥ 100` similar children, subtree `nodeCount ≥ 1000`, `offscreenFraction ≥ 0.5` | windowing (render only visible rows) | `content-visibility:auto` fallback |
| **R3 Viewport-only / CV** | document `nodeCount ≥ 1500` (warn) / `3000` (error) with large off-screen fraction | `content-visibility:auto` + `contain-intrinsic-size` on below-fold sections | defer below-fold component render |
| **R4 Unblock render** | render-blocking head CSS/JS with `wastedMs > 50` (from diagnostic-insights) | `defer`/`async` + inline critical CSS | `preload`/`preconnect` key origins |
| **R5 Split JS** | one script URL with attributed long-task Σ ≥ 350ms before FLT on the **main-thread gate** | code-split via dynamic `import()` | move pure compute to Web Worker; tree-shake |
| **R6 Defer hydration** | main-thread gate persists after `loadEventEnd` + SSR/framework signature | island / selective / progressive hydration | `client:visible`/`client:idle`; React streaming + Suspense |
| **R7 Fix thrash** | forced reflow (trace: Layout sync after style write in one task) | batch reads→writes via `requestAnimationFrame` | `ResizeObserver`; cache layout reads |
| **R8 Offload 3p** | third-party main-thread time ≥ 200ms (from diagnostic-insights) | Web Worker (Partytown) | facade for embeds; `defer`; self-host |
| **R9 Font swap** | webfont causes LCP/FCP render-delay (no `font-display`) | `font-display: swap` + `preload` | subset; self-host |
| **R10 Trim unused** | unused JS/CSS bytes ≥ 30% (CDP coverage, when available) | route-level split + tree-shake | purge CSS |

## Out of scope

- **Auto-applying** fixes / opening PRs. Rx *prescribes*; it does not edit user code. (A future `propose_patch`-style track could, gated on trust.)
- **Coverage collector** itself (R10's input) — if CDP `Profiler`/CSS coverage is not already collected, R10 degrades to "not evaluated" rather than blocking this change.
- **Framework auto-detection beyond signatures** — Rx ships generic + per-framework snippets; precise framework/version detection is best-effort.

## Pinned design decisions

- **Prioritize by `estFltDeltaMs × confidence`, descending.** `estFltDeltaMs` is bounded by `gatingHeadroom(signal)` from `add-full-load-time` — a fix off the gating path reports `gating: false` and a near-zero FLT delta with a note "improves <metric> but not FLT now".
- **Every recommendation is targeted** (a `selector` or `resource`) and **evidence-backed** (the measured numbers that triggered it). No untargeted generic tips.
- **Confidence gates on trust.** When the FLT/metric trust verdict is `unreliable`, recommendations are emitted with `confidence: 'low'` and a "re-measure first" banner — never a confident prescription on noise (reuses v0.2.0 quality core).
- **Rx is a pure function of the Report** → deterministic, snapshot-testable; no network, no LLM call in v1 (rules are heuristic, explainable, and auditable).
- **Depends on** `add-full-load-time` (gatingPhase/headroom) and `add-diagnostic-insights` (long-task attribution, render-blocking, third-parties). Hotspots reuses those, adds topology/off-screen.

## Success criteria

1. `ohmyperf diagnose https://moodtrip.hoainho.info` prints a ranked hotspot table and ≥1 recommendation whose `target` is a real selector/resource on the page, with an `estFltDeltaMs` and a code snippet.
2. On a fixture with a 2,000-row off-screen list, Rx emits **R2 Virtualize** as a top recommendation with `gating` reflecting whether layout/recalc is on the FLT gate.
3. On a fixture whose FLT is `network`-gated by an off-screen hero image, Rx emits **R1 Lazy media** with a positive `estFltDeltaMs`, and a main-thread-only fix (e.g. R5) is reported with `gating: false` / ~0 delta.
4. Recommendations are deterministic across two runs of `rx.ts` on the same fixture report (snapshot test).
5. With `trustScore.overall = 'unreliable'`, all recommendations carry `confidence: 'low'` + the re-measure banner.

## Risks

- **Impact estimates are heuristics** → always labelled "estimated", confidence-scored, and never presented as guarantees; the `design` documents each estimator.
- **Topology snapshot cost** (one big `Runtime.evaluate`) → cap serialized size, sample only containers above thresholds, run once at FLT not per-frame.
- **Over-recommending** → hard-cap to top-N by score, collapse duplicates per target, suppress `gating:false` items behind a "also worth doing" fold.
- **Framework snippet drift** → snippets are illustrative + link to canonical docs; covered by a lint that they compile as fenced examples, not executed.
