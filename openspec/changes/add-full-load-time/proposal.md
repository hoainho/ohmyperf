# Proposal: Full-Load Time (FLT) — measure when the page is *actually* done

## Why

Today OhMyPerf's headline timing is **LCP** (largest contentful paint) plus `domContentLoaded` / `load` from `loading-collector.ts`. None of these answer the question a user actually has: **"when is my page completely loaded?"**

- **LCP is a single paint event.** On `https://moodtrip.hoainho.info` (live, this session) LCP fired at **570ms**, but the SPA kept fetching JS chunks, hydrating, and injecting DOM long after. The user-felt "ready" moment is later — and invisible to every current metric.
- **`load` (loadEventEnd) fires too early for SPAs.** It signals the *initial* resource set finished; client-rendered content, lazy chunks, and hydration all happen *after* `load`.
- **Playwright's `networkidle` is a *wait condition*, not a *measured metric*.** `engine-adapter.ts` waits on it but never records a robust "everything settled" timestamp, and it ignores DOM-mutation and main-thread activity entirely.

The result: a page can show 🟢 across CWV yet still feel slow because content keeps streaming in after LCP. We cannot diagnose or improve what we do not measure.

This change adds **Full-Load Time (FLT)** — a single, settle-based timing that holds until **all four** activity signals are simultaneously quiet (network, DOM mutations, main thread, optionally pixels). It is explicitly **not derived from LCP**. It also records *why* the page stayed busy (the **gating signal**), which is the entry point for the diagnosis (`add-diagnostic-insights`) and remediation (`add-remediation-engine`) tracks.

## What changes

### Added (engine layer)

- `packages/core/src/collectors-impl/dom-mutation-collector.ts` — **NEW**. Installs a `MutationObserver` via `Page.addScriptToEvaluateOnNewDocument` (runs before app code) observing `{childList, subtree, attributes, characterData}`. Posts batched mutation magnitudes (`w = added + removed + 0.25·attr + 0.1·charData`) with `performance.now()` timestamps back to the collector via an exposed binding. Emits a `domMutationTimeline` side-channel.
- `packages/core/src/collectors-impl/loaf-collector.ts` — **NEW**. `PerformanceObserver('long-animation-frame')` (falls back to `longtask` when LoAF unsupported). Records busy intervals for the main-thread-quiet signal and (for the diagnosis track) per-frame `scripts[]` attribution.
- `packages/core/src/collectors-impl/resource-collector.ts` — **MODIFIED**. Maintain a running in-flight counter (`requestWillBeSent` +1 / `loadingFinished`+`loadingFailed` −1) and emit a `networkInflightTimeline`. Classify long-lived connections (`Network.webSocketCreated`, EventSource, streaming responses, requests open > `longLivedGraceMs`) as **non-blocking** so a persistent WS/SSE never prevents settle.
- `packages/core/src/collectors-impl/filmstrip-collector.ts` — **NEW, opt-in** (`--filmstrip`). Periodic `Page.captureScreenshot` at `visualIntervalMs`; viewport pixel-diff for the visual-quiet signal + Visually-Complete + Speed-Index.
- `packages/core/src/full-load.ts` — **NEW**. Pure function `computeFullLoad(streams, opts): FullLoadResult` implementing the settle algorithm (see `design.md`). No I/O — deterministic given event streams, so it is unit-testable with synthetic inputs (mirrors the `Sampler` testing pattern in `add-measurement-statistical-rigor`).
- `packages/core/src/types.ts` — additive-optional fields only:
  - `Metric` entry `fullLoad` (the FLT value, ms, aggregated like any metric).
  - `Report.fullLoad?: FullLoadReport` = `{ fltMs, capped, gatingPhase, gatingDistribution?, subTimeline, settleConfig }`.
  - `FullLoadReport.subTimeline` = `{ ttfb, fcp, domContentLoaded, loadEventEnd, networkIdleAt, lastMutationAt, lastLongTaskEndAt, visuallyCompleteAt?, fltMs }`.
  - `GatingPhase = 'network' | 'main-thread' | 'dom' | 'visual' | 'none'`.
  - `MeasureOptions.fullLoad?: FullLoadConfig` (see Pinned decisions for fields/defaults).

### Added (CLI layer)

- `apps/cli/src/commands/run.ts` — new flags: `--until <load-event|network-idle-2|fully-loaded|visually-complete>` (default `fully-loaded`), `--settle-window <ms>` (1000), `--max-wait <ms>` (30000), `--net-idle-threshold <k>` (2), `--mutation-noise <w>` (3), `--filmstrip`. Surface FLT + gatingPhase in the run summary AND `--json` (composes with the v0.2.0 P0.6 trust/json work).

### Modified (reporters)

- `packages/reporter-markdown`, `packages/viewer` (HTML), `packages/reporter-deck` — add an "Load timeline" block: the sub-timeline bar + the FLT value + the gating-phase callout.
- `apps/mcp-server/src/server.ts` — new `analyze_report` insight `full-load-breakdown` returning the sub-timeline + gatingPhase.

## Out of scope

- **Per-component / hotspot attribution** of *what* caused the gating — that is `add-diagnostic-insights` (long-task→URL) + `add-remediation-engine` (component/region cost). This change only computes FLT and the *coarse* gating signal.
- **Scroll/interaction-driven** lazy content (infinite scroll). FLT measures the **initial viewport settle**; interactive flows are a Playwright-scenario follow-up (`--interact`).
- **Speed Index full implementation** beyond Visually-Complete — ships only if `--filmstrip` is cheap; the perceptual SI weighting is deferred.

## Pinned design decisions

- **Settle model, not load-event model.** FLT = start of the final quiet window confirmed by a `settleWindow` of no new *blocking* activity across all enabled signals (rolling algorithm, `design.md`). This generalizes WebPageTest "Fully Loaded" to 4 signals and is SPA-correct.
- **`FullLoadConfig` defaults:** `{ until: 'fully-loaded', settleWindowMs: 1000, maxWaitMs: 30000, netIdleThreshold: 2, mutationNoiseFloor: 3, longLivedGraceMs: 5000, visual: false, visualIntervalMs: 100, visualDiffEpsilon: 0.001 }`.
- **Non-blocking classification is mandatory**, not optional — without it WebSocket/SSE/analytics-beacon/polling pages would never settle and FLT would always be `capped`. The classifier is conservative (reclassify only after `longLivedGraceMs` or on explicit WS/EventSource signals).
- **`gatingPhase` is the contract with the diagnosis track.** It is computed as the signal whose individual last-blocking timestamp equals the FLT timestamp. Ties → priority `network > main-thread > dom > visual`, but `gatingDistribution` records all.
- **Schema is additive.** `Report.fullLoad?` is optional; 1.x readers ignore it. (When the v0.2.0 `parseReportVersion` major-compare helper lands, FLT can become non-optional in a 2.x report.)
- **Aggregation reuses the existing pipeline** (median/p75/p95/CoV/outlier-rejection + trustScore). FLT gets a trust verdict like any metric; `capped` runs are excluded from the median with a logged reason.

## Success criteria

1. Re-measure `https://moodtrip.hoainho.info --runs 5`: report shows an `FLT` value **strictly greater than LCP** and a `gatingPhase` (expected `main-thread` or `network` for this SPA), with the full sub-timeline.
2. `computeFullLoad` unit tests: synthetic streams produce deterministic FLT for (a) a clean load, (b) a late-XHR load (network-gated), (c) a hydration load (main-thread-gated), (d) a persistent-WS page (does **not** cap — WS reclassified), (e) a polling page (caps at `maxWaitMs`, `gatingPhase` names the offender).
3. `ohmyperf run --until network-idle-2` and `--until load-event` produce FLT equal to the corresponding sub-timeline checkpoint (proves the endpoint menu).
4. `--filmstrip` adds `visuallyCompleteAt` and a filmstrip artifact; default run does not pay the screenshot cost.

## Risks

- **MutationObserver/visual settle can be fooled** by steady-state animations, carousels, clocks, or polling timers → `mutationNoiseFloor` + steady-state down-weighting + `maxWaitMs` cap + always reporting the gating signal so the user sees *why* it didn't settle.
- **Long-lived connection misclassification** could either hang settle (false negative) or settle too early (false positive). Mitigation: conservative grace window + explicit WS/SSE signals + a `--strict-network` opt-out that counts everything.
- **FLT raises wall-clock** (must observe through the settle window). The engine adds a bounded post-network-idle settle observation (≤ `settleWindowMs`, ≤ remaining `maxWaitMs` budget) before finalizing collectors so post-load main-thread/DOM activity is captured rather than truncated at network-idle. Cost: up to `settleWindowMs` per run (skipped for `--until load-event`). Mitigation: pairs with the v0.2.0 browser-reuse / `--concurrency` work; lower `--settle-window` for speed.
- **Observation window vs `maxWaitMs`**: the engine's network-idle wait (`LOAD_IDLE_TIMEOUT_MS`, currently 30s) is the ceiling for the network phase; `--max-wait > 30000` is therefore effectively bounded by that ceiling today. A follow-up should derive the load-idle ceiling from `maxWaitMs` so very slow pages are honored. Documented limitation, not a correctness bug for typical pages.
- **LoAF is Chromium-only** → fall back to `longtask`; both are already available via CDP.
- **Visual signal on animated pages (`--filmstrip` / `--until visually-complete`)**: the screencast is compositor-change-driven, so a page with a *continuous* animation (canvas/CSS loop, autoplay video) keeps changing pixels — "visually complete" therefore extends until that visual churn subsides (bounded by `--max-wait`). On `moodtrip.hoainho.info` (animated NatureScene) this measured ~21s, vs ~0.8–1.7s for the default `fully-loaded` endpoint. This is expected (WebPageTest's Visually Complete behaves the same): `visually-complete` answers "when does the viewport stop changing," not "load time." **Guidance: use the default `fully-loaded` (with the LCP paint-floor) for load time; reserve `--until visually-complete` for visually-static pages or when you specifically want visual stability.** A future steady-state-animation suppressor (periodicity detection) is deferred.
