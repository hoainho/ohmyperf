# Tasks: Metric Accuracy + Validation (Track A)

## A1. INP correctness fix

- [ ] A1.1 Add `web-vitals` to `packages/plugins-builtin` `dependencies` (already declared but verify version matches `^4.2.4` from workspace catalog).
- [ ] A1.2 Bundle `web-vitals/attribution` entry into the inline script via esbuild side-load. Output the bundled UMD blob as a string constant `WEB_VITALS_ATTRIBUTION_SRC` in `cwv-inline-script.ts`.
- [ ] A1.3 In `cwv-inline-script.ts`, replace the custom INP `PerformanceObserver('event')` with `onINP(callback, { reportAllChanges: true })` from web-vitals/attribution. Same for `onLCP`, `onCLS`, `onFCP`, `onTTFB` (replacing the existing custom PerformanceObservers).
- [ ] A1.4 Bridge web-vitals callbacks → existing `Runtime.addBinding` channel. Each callback emits `{ name, value, rating, attribution }` as JSON.
- [ ] A1.5 Update `cwv-collector.ts` to deserialize the new payload shape and map to `Metric` + populate `Metric.attribution`.

## A2. Attribution population

- [ ] A2.1 Extend `MetricAttribution` type in `packages/core/src/types.ts`:
  - `subparts?: Record<string, number>` (e.g. `{ ttfb: 380, loadDelay: 60, loadDuration: 540, renderDelay: 420 }` for LCP)
  - `interactionType?: 'pointer' | 'keyboard'` (INP only)
  - `longestScript?: { url?: string, invoker?: string, duration: number, subpart: 'input-delay' | 'processing' | 'presentation' }` (INP only)
  - `previousRect?: { x: number, y: number, width: number, height: number }` (CLS only)
  - `currentRect?: { x: number, y: number, width: number, height: number }` (CLS only)
- [ ] A2.2 Map LCP `LCPAttribution` → `MetricAttribution`:
  - `element` ← `target` (CSS selector)
  - `url` ← `url`
  - `subparts` ← `{ ttfb: timeToFirstByte, loadDelay: resourceLoadDelay, loadDuration: resourceLoadDuration, renderDelay: elementRenderDelay }`
- [ ] A2.3 Map INP `INPAttribution` → `MetricAttribution`:
  - `element` ← `interactionTarget`
  - `interactionType` ← `interactionType`
  - `subparts` ← `{ inputDelay, processing: processingDuration, presentation: presentationDelay }`
  - `longestScript` ← `{ url: longestScript.entry.invoker, invoker: longestScript.entry.invokerType, duration: longestScript.intersectingDuration, subpart: longestScript.subpart }` (when present)
- [ ] A2.4 Map CLS `CLSAttribution` → `MetricAttribution`:
  - `element` ← `largestShiftTarget`
  - `previousRect` ← `largestShiftSource.previousRect` (DOMRectReadOnly → plain object)
  - `currentRect` ← `largestShiftSource.currentRect`
  - `cause` ← derive from `loadState` ('dom-interactive' | 'dom-content-loaded' | 'load' → mapped strings)
- [ ] A2.5 Wire CLS frame-resize attribution: subscribe to `Page.frameResized` on the root session; pair the event by `frameId` + nearest layout-shift timestamp; populate `attribution.cause = "frame-resize"` and `attribution.frameId`.
- [ ] A2.6 Update `packages/viewer/src/render.ts` (HTML reporter) to surface `attribution.element`, `attribution.subparts`, `attribution.longestScript` when present — backward compatible (existing reports without attribution still render).

## A3. Runtime breakdown from Performance.getMetrics

- [ ] A3.1 In `loading-collector.ts`, replace the discarded call with `const metrics = await session.send("Performance.getMetrics")`. Filter to the canonical set: `ScriptDuration`, `TaskDuration`, `LayoutDuration`, `RecalcStyleDuration`, `V8CompileDuration`, `LayoutCount`, `RecalcStyleCount`, `NodeCount`.
- [ ] A3.2 Emit each as a `Metric` with name prefix `runtime.` (e.g. `runtime.scriptDuration`).
- [ ] A3.3 Add `RunReport.runtime?: Record<string, number>` for the aggregated view (keep raw entries in `metrics[]` as well).
- [ ] A3.4 Update `MetricTiles` in `apps/website/components/viewer/report-viewer.tsx` to NOT render `runtime.*` metrics in the headline grid (they're for the Diagnostics section in Track B; only add the data here).

## A4. Lighthouse parity test harness

- [ ] A4.1 Add `lighthouse@^13.3.0` to root `devDependencies`. Add `puppeteer-core` if not pulled transitively.
- [ ] A4.2 Create `tests/parity/fixtures/` with 3 self-hosted HTML fixtures: (a) simple-static (no JS), (b) image-heavy-lcp (one large `<img>`), (c) long-task-bomb (5×200ms blocking JS).
- [ ] A4.3 Create `tests/parity/lighthouse-parity.test.ts`:
  - Start the runner against each fixture URL (use `apps/runner` programmatic entry).
  - In parallel, run `lighthouse(url, { port: <runner's CDP port>, output: 'json', onlyCategories: ['performance'] })`.
  - Assert: `|ohmyperfLcp - lighthouseLcp| / lighthouseLcp < 0.10`.
  - Same for FCP, TTFB.
  - For TBT: tighter `< 0.05`.
  - Document acceptable ranges in `tests/parity/README.md`.
- [ ] A4.4 Add `pnpm test:parity` script to root `package.json` (NOT in default `pnpm test` because of ~30s runtime).
- [ ] A4.5 Add `parity` matrix entry to CI (`.github/workflows/ci.yml`) — runs only on `main` push, not on every PR.

## A5. OOPIF corpus expansion (9 new fixtures + metric assertions)

- [ ] A5.1 Add `tests/oopif-corpus/fixtures/bfcache.html` — page that navigates away and back via `history.back()` after 500ms. Expect: same metrics on restore (RestoreEvent attribution).
- [ ] A5.2 Add `tests/oopif-corpus/fixtures/prerender.html` — `<script type="speculationrules">{"prerender":[{"source":"list","urls":["/target.html"]}]}</script>` + manual navigation trigger.
- [ ] A5.3 Add `tests/oopif-corpus/fixtures/sw-precache.html` — registers a Service Worker that precaches via `caches.addAll`. Assert second-visit metrics differ.
- [ ] A5.4 Add `tests/oopif-corpus/fixtures/spa-soft-nav.html` — uses `history.pushState` after first paint; assert engine collects metrics for both navigations OR documents that soft-nav is out of scope.
- [ ] A5.5 Add `tests/oopif-corpus/fixtures/popup.html` — `window.open(target, '_blank')`; assert the popup is or is not attached per the engine's `attachPopups` flag.
- [ ] A5.6 Add `tests/oopif-corpus/fixtures/worker.html` — dedicated worker with a 100ms busy loop; assert long-tasks on main thread DO NOT include the worker's task.
- [ ] A5.7 Add `tests/oopif-corpus/fixtures/iframe-resize-causes-parent-shift.html` — iframe that changes its own height after 500ms; assert CLS attribution emits `cause: "frame-resize"` with the iframe's frameId.
- [ ] A5.8 Add `tests/oopif-corpus/fixtures/fenced-frame.html` — `<fencedframe src="...">`; assert engine does NOT attempt to attach (FF target is gated) and emits `frameNode.tags` including `"fenced-frame"`.
- [ ] A5.9 Add `tests/oopif-corpus/fixtures/5xx-error.html` — fixture whose server returns 503; assert engine still emits a Report with a known `error` field shape (graceful degradation).
- [ ] A5.10 Add metric-availability assertions to each fixture's `expectations.ts`: which metrics MUST be present, which CAN be missing, which MUST have attribution populated.
- [ ] A5.11 Acceptance: `pnpm test --filter @ohmyperf/oopif-corpus` green with 13 fixtures.

## A6. API freeze + docs

- [ ] A6.1 Run `pnpm api:check` on `@ohmyperf/core`. The `MetricAttribution` extension is additive; api-extractor should pass without breakage.
- [ ] A6.2 Update `packages/core/etc/core.api.md` snapshot.
- [ ] A6.3 Update `README.md` "Accuracy" section: replace marketing claims with concrete "TBT within ±5% of Lighthouse on fixtures X/Y/Z" + link to parity test.
- [ ] A6.4 Add `docs/accuracy.md` explaining the parity methodology, known deltas (e.g. headless vs headed paint timing), and how to reproduce locally.

## A7. Acceptance

- [ ] A7.1 INP regression test: known fixture with 3 button clicks at 250ms each → assert INP value matches `web-vitals/attribution` reference within ±2ms.
- [ ] A7.2 Lighthouse parity test green on all 3 fixtures.
- [ ] A7.3 OOPIF corpus 13/13 green.
- [ ] A7.4 Real-page smoke: re-measure `https://blog.thnkandgrow.com/` (the γ.18 fixture) and verify Report now contains: LCP `attribution.element` (CSS selector), LCP `attribution.subparts.{ttfb,loadDelay,loadDuration,renderDelay}`, third-party attribution stays empty (Track B).
- [ ] A7.5 `pnpm typecheck && pnpm lint && pnpm test && pnpm test:parity` all green.
