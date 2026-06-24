# Plan (CONSENSUS-APPROVED — Planner→Architect→Critic APPROVE): ohmyperf v0.3.0 — `perfSummary` comprehensive perf report

Goal: users/agents understand the FULL perf picture, not just the 4 CWV metrics — total page-load time, network impact, JS size/timing, main-thread cost, **errors & console warnings**, every perf-affecting signal. Surfaced by default across CLI / MCP / markdown. Additive (`schemaVersion` stays `1.0.0`). v0.3.0 minor bump.
**Rev2** folded in Architect review (seam, derived-rollup, cross-run, muted console). **Rev3** folds in Critic ITERATE — all sources VERIFIED against default-on collectors: `longtask-collector` emits `tbt` + `longTasks` every run; `loading-collector` emits `runtime.{scriptDuration,v8CompileDuration,taskDuration,layoutDuration,recalcStyleDuration}` every run; the `resources` insight uses `runs[0]`. The Critic's two Criticals (gated-hotspots vs always-on; resources-selector input) are resolved below by deriving script-blocking from always-collected `longTasks` and pinning the network selector to `runs[0]`.

## RALPLAN-DR

### Principles
1. **Surface-first** — maximize value from data the engine ALREADY collects; only add collectors for genuinely-missing signals (console, JS errors).
2. **Additive & backward-compatible** — `schemaVersion` stays `1.0.0` (LOAD-BEARING: `packages/share-server/src/app.ts:71` hard-rejects any other value); every new field additive-optional; no existing field/shape changes.
3. **Cheap-by-default** — new collectors must be *passive* CDP subscriptions; cap stored messages.
4. **Deterministic & testable** — `computePerfSummary` pure; collectors unit-tested via simulated CDP `emit()` (the `resource-collector.test.ts` pattern); no real browser for unit tests.
5. **One source of truth — at BOTH the surface AND engine level.** Surfaces (CLI/MCP/markdown) only format. AND `perfSummary` is a **derived rollup** that reuses existing engine primitives (`computeHotspots`, the shared `resources` selector, `aggregated.tbt`) — it MUST NOT re-derive a parallel "what's slow" ranking that could disagree with `hotspots`.

### Decision Drivers (top 3)
1. **User intent**: a comprehensive *default* result — new signals appear without an opt-in flag.
2. **Most groups need ZERO new collection** — Network/JS/Main-thread/Timing/Third-party derive from already-collected data; only Errors&Console need new collectors.
3. **Backward compatibility** — public report schema + MCP tool contracts + CLI output + share-server schema gate.

### Viable Options
- **A. Full `perfSummary` + 2 passive collectors default-ON, computed every run, surfaced everywhere.** Pros: meets comprehensive-default intent. Cons: (architect-identified) promotes attribution-ambiguous console/error counts to default prominence; risks `perfSummary` re-deriving rankings that already live in `hotspots`/`resources` → two-truth divergence.
- **B. `perfSummary` from EXISTING data only — no console/error collectors.** Rejected: fails the explicit console/errors ask.
- **C. New collectors + `perfSummary` behind an opt-in flag.** Steelman (architect): C's real benefit is NOT cost-avoidance (cost is ~0) — it's **signal quality**: `Log.entryAdded` surfaces CORS/CSP/deprecation/3rd-party-iframe warnings often not the author's fault; promoting those to a default top-line signal (alongside LCP/TBT) risks agents/CI treating noise as actionable. **Invalidation:** comprehensiveness in the JSON (always present in `report.perfSummary.errors`) is *separable* from prominence in the human summary — so C's concern is met by A′ (origin-attribute + mute in top-line) without a flag, preserving Driver 1.
- **A′ (CHOSEN — synthesis):** collect + compute **always** (A's comprehensiveness, consistent with always-on `trustScore`/`fixPlan`), BUT (i) `perfSummary` is a **derived rollup** reusing `hotspots`/`resources` primitives (resolves the two-truth risk + Principle 5), and (ii) console/error counts are **origin-attributed** (`classifyOrigin`, engine.ts:467-473) and shown as a **muted secondary line** in human top-line, not a verdict (neutralizes C's steelman without an opt-in flag).

## Design

### Data model (`packages/core/src/types.ts`, all additive-optional)
- `Resource` gains `status?: number`, `failed?: boolean`, `failureText?: string`.
- `ConsoleMessage { level:"error"|"warning"|"info"|"log"|"debug"; text; url?; lineNumber?; originClass?; count }`.
- `PageError { message; name?; stack?; url?; source:"exception"|"unhandledrejection"; originClass? }`.
- `RunReport` gains `consoleMessages?: readonly ConsoleMessage[]`, `pageErrors?: readonly PageError[]` (per-run, capped 25 each).
- `PerfSummary` + `Report.perfSummary?` (computed every run).

### Collector→report pipeline seam (Architect blocking #1 — mandatory, easy to miss)
The new collectors' output must actually reach `RunReport`. Extend, in order:
1. `CollectorResult` (`collectors.ts:35-47`) — add `consoleMessages?`, `pageErrors?` (mirroring `domTopology?`/`visChanges?`).
2. `mergeCollectorResults` (`collectors.ts:72-105`) — merge the new arrays (first-non-empty, like `domTopology`).
3. `buildRunReport` (`engine.ts:592-631`) — copy `consoleMessages`/`pageErrors` from `rootFinal` onto the `RunReport` (today it only copies metrics/longTasks/resources/opportunities/fullLoad/domTopology).
*Without all 3, a correctly-registered collector silently produces data that never lands in the report (S4 fixtures would pass while live runs are empty).*

### `PerfSummary` shape (6 groups) — a DERIVED ROLLUP with VERIFIED sources
```
timing:     { ttfbMs, fcpMs, lcpMs, dclMs, loadEventMs, networkIdleMs, fullLoadMs, gatingPhase }
              // from report.fullLoad (aggregated/representative — already cross-run)
network:    { totalRequests, totalTransferBytes, byType:{js,css,image,font,html,other:{count,bytes}},
              cachedRequests, cachedBytes, firstPartyBytes, thirdPartyBytes, renderBlockingCount,
              largestResources, slowestRequests,            // over runs[0].resources (see contract)
              failedRequestCount, failedRequests:[{url,status,failureText}] }
javascript: { transferBytes, requestCount,
              parseCompileMs,        // = aggregated["runtime.v8CompileDuration"]
              executionMs,           // = aggregated["runtime.scriptDuration"]
              mainThreadBlockingMs,  // = sum of topBlockingScripts blockingMs
              topBlockingScripts }   // from shared scriptBlockingFromLongTasks(longTasks) primitive
mainThread: { totalTaskMs,          // = aggregated["runtime.taskDuration"]
              longTaskCount, totalBlockingMs,   // = aggregated.tbt (VERIFIED present every run; fallback = Σ max(0,dur-50) over longTasks)
              layoutMs,              // = aggregated["runtime.layoutDuration"]
              recalcStyleMs }        // = aggregated["runtime.recalcStyleDuration"]
errors:     { jsErrorCount, jsErrors:[…capped], consoleErrorCount, consoleWarningCount,
              consoleSamples:[…capped, with originClass], firstPartyErrorCount, failedRequestCount }
stability:  { cls, thirdPartyCount, thirdPartyMainThreadMs, trust, servability }
```
- **No parallel ranking — derive from primitives, not from gated outputs (Critical #1 fix).** `computeHotspots` is GATED on `diagnose`/`rx` (`engine.ts:113,513`) so `report.hotspots` is `undefined` on a default run. Therefore `javascript.topBlockingScripts` does NOT read `report.hotspots`. Instead, extract the script-blocking logic from `hotspots.ts:65-83` into a shared pure primitive **`scriptBlockingFromLongTasks(longTasks)`** that `computeHotspots` ALSO calls. `longTasks` is always collected (`longtask-collector` is default-on), so this works on every run. Contract: on a `--diagnose` run, `topBlockingScripts` is byte-equal to `report.hotspots.filter(h=>h.cause==='script')`; on a default run it equals the same primitive over `longTasks` (hotspots absent but the script ranking is identical). One ranking, two callers.
- **Network selector pinned to `runs[0]` (Critical #2 fix).** Extract a shared `selectResources(resources)` helper in core; both `perfSummary.network.{largestResources}` AND the MCP `resources` insight (`server.ts:1381`, currently `runs[0]`) import it and feed it **`runs[0].resources`** — identical input + logic ⇒ cannot diverge. `slowestRequests` (by `responseMs`) is **net-new** (no existing counterpart). `firstPartyBytes`/`thirdPartyBytes` read each resource's `originClass` (enriched at aggregation, `engine.ts:469-471`) — the rollup reads the post-enrichment `runs[0].resources`.
- **Cross-run reduction (explicit):** **timing** = `report.fullLoad` (already aggregated). **network/js/mainThread** = `runs[0]` for resources + `aggregated[...]` for runtime/tbt (both already cross-run-reduced). **errors/console** = **union + dedupe across all runs, counts summed** (an error in ANY run is real). `representativeRun` (`hotspots.ts:7`) will be **exported** as a shared primitive (degrades to `runs[0]` on a default run — no `domTopology`), used only by `scriptBlockingFromLongTasks`'s run selection.

### New collectors (`packages/core/src/collectors-impl/`)
- `console-collector.ts` — CDP `Runtime.consoleAPICalled` + `Log.entryAdded`. Dedupe by (level+text), keep counts, cap 25.
- `error-collector.ts` — CDP `Runtime.exceptionThrown` (uncaught + unhandledrejection). Capture message/name/stack/url, cap 25.
- **Origin attribution is NEW wiring, not reuse.** Today `classifyOrigin` runs only at Report-aggregation over `resources` (`engine.ts:469-471`). Console/error `originClass` is derived by applying the same `classifyOrigin(messageUrl, primaryOrigin)` to each message's source URL during/after aggregation — a small extension, not an existing call site. State this as new code in S2/S3.
- Pattern = passive CDP subscription exactly like `resource-collector.ts` (subscribe in `create`, drain in `finalize`). Registered in `DEFAULT_COLLECTOR_FACTORIES` (engine.ts:92) → default-ON.

### Resource enrichment + failed-request handling (S1 nuance)
`buildResource` (resource-collector.ts:186) keeps `status` (from `response.status`) + `failed`/`failureText` (from `Network.loadingFailed`). **Important:** today resource-collector DROPS failed/no-response requests (`resource-collector.ts:167-168` skip canceled + skip `!response`). S1 must emit a record for genuinely-failed requests (non-canceled, has `failureText`, no response) so `perfSummary.network.failedRequests` is accurate — without resurrecting canceled/prefetch noise.

### Surfaces (format-only; one source of truth)
- **CLI** (`run.ts`): a "Comprehensive perf" block (6 compact groups); console/error counts as a **muted secondary line** with first-party vs third-party split; include `perfSummary` in the hand-built `--json` block (run.ts:416-430).
- **MCP** (`server.ts`): `summarize()` highlights (load time, total bytes, JS bytes, first-party error/warning counts — muted); new `analyze_report` insights `network`, `javascript`, `errors`, `perf-summary` (11→15), graceful-degrade when absent.
- **Markdown** (`reporter-markdown`): a "Comprehensive perf" section (present-guarded).
- HTML/deck reporters: out of scope (follow-up).

## Scope — stories (P0 data+seam → P1 aggregate → P1 surface → P2 release)
- **S1** Enrich `Resource` (status/failed/failureText) + emit failed/no-response requests (not canceled). *AC:* simulated `responseReceived`(404)+`loadingFailed` test asserts fields + a failed-no-response request appears; canceled still skipped; existing resource tests green.
- **S2** `console-collector` + `ConsoleMessage` + **pipeline seam** (CollectorResult/mergeCollectorResults/buildRunReport) + default-ON register. *AC:* simulated `Runtime.consoleAPICalled`(error/warning)+`Log.entryAdded` → `RunReport.consoleMessages` deduped+counted+originClass; cap 25; **two seam assertions: (a) data reaches `RunReport` (not just the collector), AND (b) it SURVIVES the Report-level enrichment map at `engine.ts:466`** (that map spreads `...r` and rewrites `resources` only — a test must prove `consoleMessages`/`pageErrors` aren't dropped there).
- **S3** `error-collector` + `PageError` + reuse the S2 seam + register. *AC:* simulated `Runtime.exceptionThrown` → `RunReport.pageErrors` with message/stack/originClass; cap respected; same Report-level survival assertion as S2.
- **S4** `PerfSummary` types + pure `computePerfSummary(report)` (derived rollup) + shared `scriptBlockingFromLongTasks` + shared `selectResources` + exported `representativeRun`. *AC:* (a) fixture → all 6 groups correct with the VERIFIED source keys (parseCompileMs=`runtime.v8CompileDuration`, executionMs=`runtime.scriptDuration`, totalBlockingMs=`aggregated.tbt` with the Σmax(0,dur-50) fallback when absent, layout/recalc/task from `runtime.*`); (b) **on a DEFAULT (non-diagnose) fixture, `topBlockingScripts` is non-empty and equals `scriptBlockingFromLongTasks(longTasks)`** — proving the comprehensive default isn't empty; (c) on a `--diagnose` fixture, `topBlockingScripts` is byte-equal to `report.hotspots.filter(cause==='script')`; (d) `largestResources` byte-equal to `selectResources(runs[0].resources)` AND the MCP `resources` insight output; (e) errors unioned+deduped+summed across runs; (f) **graceful when collectors return EMPTY** (live page, zero errors → `errors` group all-zero, not undefined) — distinct from old-report-absent; (g) deterministic (`toEqual` on repeat).
- **S5** Engine integration — collectors default-ON + `report.perfSummary` every run (not gated). *AC:* real measure → populated `perfSummary`; default report valid; `schemaVersion` unchanged.
- **S6** CLI surface (summary block + muted error line + `--json`). *AC:* output shows 6 groups; `--json` includes `perfSummary`; first/third-party error split shown.
- **S7** MCP surface — `summarize()` + 4 insights, graceful degrade. *AC:* fixtures with/without `perfSummary`; **golden: default `measure`/existing-11-insight/`summarize` outputs byte-unchanged when `perfSummary` absent**; insight count 11→15.
- **S8** Markdown reporter section. *AC:* present-guarded; byte-unchanged when absent.
- **S9** Release — bump 0.3.0 across published set, CHANGELOG, `turbo build typecheck test lint` green, live verify on moodtrip (console/errors/failed-requests/JS bytes visible).

## Cost / behavior impact
- console/error = passive subscriptions. `Runtime.enable` is ALREADY called every run by cwv/longtask/full-load/dom-topology collectors → **adds ZERO new domain**; only `Log.enable` is new (passive, like `Network.enable`). `computePerfSummary` = pure CPU. Net: a small `perfSummary` object + 2 capped arrays per report. Reversible (collectors independent).

## Backward-compat
- All additive-optional; `schemaVersion` `1.0.0` (share-server gate). Existing 11 insights / tool shapes / CLI sections unchanged (new content added + presence-guarded). Old reports → graceful degrade everywhere.

## Testing strategy
- **Unit (no browser):** `computePerfSummary` on fixtures (incl. the rollup-equals-hotspots assertion); collectors via simulated `emit()`; Resource status/failed via simulated events; **per-RunReport assertions that collector data crosses the seam**.
- **Integration:** real `measure` → `perfSummary` populated + capped.
- **Live:** moodtrip → console/error/failed-request counts + JS bytes/timing visible.
- **Gate:** `turbo run build typecheck test lint` green; golden tests on default CLI/MCP/markdown outputs.

## Risks & mitigations
- **`Log.entryAdded` noise / attribution-ambiguity** (replaces the dropped non-issue "Runtime.enable double-enable", which the Architect showed is already mitigated — Runtime is always enabled) → origin-attribute via `classifyOrigin`; dedupe+count; cap 25; show first-party counts prominently, third-party muted; never a verdict.
- **Two-truth divergence (perfSummary vs hotspots/resources)** → perfSummary is a derived rollup reusing those primitives (Principle 5).
- **Silent data loss at the collector→report seam** → S2 AC asserts data at the `RunReport` level, not just the collector.
- **Report bloat from console spam** → dedupe+count + hard cap.
- **Surface drift (6 groups × 3 places)** → single `computePerfSummary`; surfaces only format.

## ADR (to finalize on approval)
- **Decision:** Option **A′** — `perfSummary` (6 groups) computed every run as a **derived rollup** from VERIFIED default-on sources: script-blocking via a shared `scriptBlockingFromLongTasks(longTasks)` primitive (also called by `computeHotspots`, so no parallel ranking and works on default runs where `hotspots` is gated-absent); network via a shared `selectResources(runs[0].resources)` helper (also imported by the MCP `resources` insight → cannot diverge); JS/main-thread timing from `aggregated["runtime.*"]` + `aggregated.tbt` (fallback Σmax(0,dur-50)); + 2 new passive collectors (console, errors) with origin attribution (new wiring) + Resource status/failed enrichment. Surfaced default across CLI/MCP/markdown, console/error counts muted in human top-line. Additive, `schemaVersion` `1.0.0`, v0.3.0.
- **Drivers:** comprehensive-default-result intent; most groups derive from existing data; backward compat (incl. share-server schema gate).
- **Alternatives:** B (existing-data-only — fails console/errors ask); C (opt-in — its real benefit is signal-quality, met by A′'s mute+attribute without a flag); plain A (two-truth + noise risks, resolved by A′).
- **Consequences:** every report gains a full, non-redundant perf picture; default measure adds only `Log.enable` (Runtime already on) + a small object; 4 new MCP insights (11→15); tool/CLI contracts unchanged (additive).
- **Follow-ups:** HTML/deck "Comprehensive perf" panel; unused-JS/coverage; near-zero CLS/TTFB noise-floor fix (from 0.2.0); `subTimeline.lcp=null` polish.
