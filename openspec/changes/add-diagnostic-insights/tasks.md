# Tasks: Diagnostic Insights (Track B)

## B1. Trace collection + long-task attribution

- [ ] B1.1 Vendor Lighthouse 13's `core/lib/tracehouse/main-thread-tasks.js` + `getAttributableURLForTask` into `packages/trace-utils/vendor/`. Pin a specific SHA from `googlechrome/lighthouse` and record it. Update root `NOTICE` file with Apache-2.0 attribution. Do NOT vendor `@paulirish/trace_engine` — too large, too fast-moving.
- [ ] B1.2 Implement `parseTrace(events): MainThreadTask[]` in `packages/trace-utils/src/index.ts` by re-exporting / lightly adapting the vendored Lighthouse code.
- [ ] B1.3 Implement `attributeTask(task, jsURLs): { url?, invoker? }` — port `getAttributableURLForTask` from the vendored Lighthouse source.
- [ ] B1.4 Add `trace-collector.ts` to `packages/core/src/collectors-impl/` using the collector framework's `create`/`finalize` lifecycle (NOT plugin `onSetup`/`onIdle` hooks — those are for plugins, this is engine-built-in):
  - In `create(session, ctx)`: `await session.send('Tracing.start', { categories: '...', transferMode: 'ReturnAsStream' })` BEFORE the engine's navigate.
  - In `finalize()`: `await session.send('Tracing.end')`, listen for `Tracing.tracingComplete` event with `stream` handle.
  - Read stream via `IO.read` chunks; track cumulative bytes. Warn-log at 25MB; HARD REFUSE at 100MB (emit `error: 'trace-too-large'`, fall back to existing PerformanceObserver-based long-tasks for this run).
  - JSON parse synchronously (V8 handles 100MB in ~1s — no worker thread needed).
  - Hand parsed events to `parseTrace`. Map each task ≥ 50ms to a `LongTaskEntry` with `attributionRich: { url, invoker, frameId }`.
- [ ] B1.5 Update `LongTaskEntry` type in `types.ts`:
  - **ADD** sibling field `attributionRich?: { url?: string, invoker?: string, frameId: string }` (optional).
  - **DO NOT MODIFY** the existing `attribution: string` field (that would break the frozen 1.0 API).
  - Reader pattern in viewer: `const a = lt.attributionRich ?? { invoker: lt.attribution }; const url = a.url; const invoker = a.invoker;`
- [ ] B1.6 Gate behind `MeasureOptions.collectTrace` (default: `true` for SPA + extension, `false` for `ohmyperf run` unless `--collect-trace`).
- [ ] B1.7 Thread `collectTrace` flag through: `apps/runner/src/runner.ts` (request → engine), `apps/cli/src/commands/run.ts` (CLI `--collect-trace`), `apps/extension-chrome/src/background.ts` (bridge), `apps/mcp-server/src/tools/measure.ts` (MCP arg), `packages/driver-playwright/src/index.ts` + `packages/driver-extension/src/index.ts` (driver capability flag). Each one is a 1-2 line plumbing change but they're easy to miss.
- [ ] B1.8 Bypass tracing entirely when `mode: "ci-stable"` is active in the engine's calibration phase — calibration measures a fixed-source JS loop and trace overhead would pollute the throttle-rate computation.

## B2. Render-blocking opportunity computation

- [ ] B2.1 Add `render-blocking-collector.ts`:
  - Subscribe to existing resource entries (no new CDP calls).
  - **Time-base alignment**: `cwv-collector` returns FCP as `DOMHighResTimeStamp` (ms since navStart). `resource-collector` returns `responseAt` as CDP `MonotonicTime` (seconds since arbitrary epoch). These DO NOT subtract directly. Capture `Network.requestWillBeSent.timestamp` for the main document as the nav-start anchor; convert FCP into CDP-seconds via `navStartCdp + fcpDomHr/1000`; then `wastedMs = max(0, (fcpCdp - resource.responseAt) * 1000)`.
  - For each `renderBlocking: true` resource, compute `wastedMs` per the formula above.
  - Emit a single `Opportunity` named `render-blocking-resources` with `details.items[]` sorted by `wastedMs DESC`.
- [ ] B2.2 Add `Opportunity` type to `types.ts`:
  ```ts
  interface Opportunity {
    id: string;
    title: string;
    description?: string;
    metric: 'lcp' | 'fcp' | 'tbt' | 'inp' | 'cls';
    wastedMs?: number;
    wastedBytes?: number;
    items: ReadonlyArray<{ url: string; wastedMs?: number; wastedBytes?: number }>;
  }
  ```
- [ ] B2.3 Add `RunReport.opportunities: ReadonlyArray<Opportunity>` and `Report.opportunities` (aggregated across runs by `id`).

## B3. Third-party impact plugin

- [ ] B3.1 Add `packages/plugins-builtin/src/third-parties.ts` reference plugin.
- [ ] B3.2 Bundle the `third-party-web/nostats-subset.js` dataset (vendored) — DO NOT load the full `entities.json` (~2MB).
- [ ] B3.3 In `onIdle`, group resources by `getEntity(url).name`. Sum `transferSize` and aggregate `mainThreadTime` per entity using the long-tasks data from B1.
- [ ] B3.4 Skip the page's own entity (first-party).
- [ ] B3.5 Emit `audit` of id `third-parties` with `details.items: Array<{ entity, category, transferSize, mainThreadTime, urls: Array<{ url, transferSize, mainThreadTime }> }>`.
- [ ] B3.6 Register the plugin in `packages/plugins-builtin/src/index.ts` exports.

## B4. SPA insights components (visual-engineering)

- [ ] B4.1 Create `apps/website/components/insights/metric-filter-pills.tsx` — shadcn `RadioGroup` with options `["all", "lcp", "inp", "cls", "tbt", "fcp"]`. State via zustand or local. Emits `selectedMetric: string | "all"`.
- [ ] B4.2 Create `apps/website/components/insights/lcp-breakdown-card.tsx`:
  - Stacked horizontal bar with 4 segments colored by sub-part
  - Sub-part legend below (labels + ms values)
  - Element selector in mono font + (when present) image thumbnail via `attribution.url`
  - shadcn `Card` + `CardHeader` + `CardContent`
- [ ] B4.3 Create `apps/website/components/insights/inp-breakdown-card.tsx`:
  - Stacked horizontal bar with 3 segments (inputDelay / processing / presentation)
  - Interaction target selector + interaction type badge
  - Longest-script callout (if present): "Top script: checkout.js:handleClick (120ms)"
- [ ] B4.4 Create `apps/website/components/insights/cls-culprits-list.tsx`:
  - Collapsible list of shifts sorted by score
  - Each item: element selector + score + SVG before/after rect overlay
- [ ] B4.5 Create `apps/website/components/insights/long-tasks-table.tsx`:
  - Sortable table: URL (truncated, mono) | Start (ms) | Duration (ms)
  - Color bands: duration > 100ms amber, > 300ms red — **AND** text labels ("amber", "red", or icon w/ aria-label) so a11y doesn't depend solely on color (WCAG 1.4.1)
  - Top 20 only; "View all (N)" expand button
- [ ] B4.6 Create `apps/website/components/insights/render-blocking-table.tsx`:
  - Columns: URL | Transfer Size | Wasted ms
  - Sorted by wastedMs DESC
- [ ] B4.7 Create `apps/website/components/insights/third-parties-card.tsx`:
  - Entity-grouped table with category badges (use HSL color from `third-party-web` `categories.json`)
  - Sortable by mainThreadTime / transferSize
  - Expand row → per-URL sub-rows
- [ ] B4.8 Create `apps/website/components/insights/insights-section.tsx`:
  - Orchestrates: filter pills → conditional render of B4.2–B4.7 based on `selectedMetric` and data presence
  - "Flagged / Informational / Passed" three-clump layout per Lighthouse pattern
- [ ] B4.9 (MERGED with Track C's C8) Refactor `apps/website/components/viewer/report-viewer.tsx` as a single consolidated PR landing at the B→C boundary:
  - Replace flat `AuditsList` + `ResourcesTable` blocks with `<InsightsSection>` (new) + collapsible `<details>` for "All audits" + "All resources" + "Frame tree" (current detail level preserved but de-emphasized).
  - Wire 3 orphan components from `components/metrics/` (`VarianceBanner`, `FrameTree`, `Waterfall`) with their existing signatures (do NOT refactor them to take `report`). Delete `MetricRow` if unused after merge.
  - Wrap sections in shadcn `Card`/`CardHeader`/`CardContent`. Use shadcn `Table` for tabular data. (Both Track B's insight components AND Track C's existing-section refactor land here.)
  - Why merged: both B and C edit the same 286-line file; doing serially doubles diff + introduces merge hell.

## B5. Reporter parity

- [ ] B5.1 Update `packages/viewer/src/render.ts` (CLI HTML reporter):
  - Mirror `InsightsSection` as static HTML.
  - Same data; no interactivity (no filter pills); render everything visible.
- [ ] B5.2 Update `packages/reporter-markdown/src/index.ts`:
  - Add `## Insights` section after `## Metrics`.
  - Sub-sections: LCP breakdown, INP breakdown, CLS culprits, Long tasks (top 5), Render-blocking (top 5), Third parties (top 5 by main-thread time).
- [ ] B5.3 `pnpm test --filter @ohmyperf/reporter-markdown` covering the new sections.

## B6. Documentation

- [ ] B6.1 Add `docs/diagnostics.md` — what each insight means, how to act on it.
- [ ] B6.2 Update README "Why OhMyPerf" table with a "Diagnostics" row.
- [ ] B6.3 Update `apps/website/app/page.tsx` "Why OhMyPerf" section to highlight diagnostic insights.

## B7. Acceptance

- [ ] B7.1 Re-measure `https://blog.thnkandgrow.com/` (the γ.18 fixture).
- [ ] B7.2 Report screen contains:
  - LCP card showing `<img.hero-N-768x403>` element + 4-segment bar
  - Render-blocking callout with ≥ 1 resource + wastedMs > 0
  - Third-parties card showing at least Google Tag Manager + Cloudflare entities
  - Long-tasks table with ≥ 1 row attributed to a JS URL (not "anonymous")
- [ ] B7.3 Metric filter pills: click "LCP" → only LCP-affecting insights remain visible.
- [ ] B7.4 Markdown report contains `## Insights` with same data.
- [ ] B7.5 `pnpm test:smoke` and `pnpm test:a11y` still green (no regression in Playwright).
- [ ] B7.6 Bundle budget for `/report` route remains < 250 KB gzip (current: 126 KB; insights add ≤ 100 KB). **Baseline measurement was captured during C-prep day 1**; this acceptance is the final gate.
- [ ] B7.7 TBT parity test `tests/parity/tbt-parity.test.ts` (split out from Track A's A4.3): asserts `|ohmyperfTbt - lighthouseTbt| / lighthouseTbt < 0.05` on the `long-task-bomb` fixture, using Track B's trace-based long-tasks. Adds `tbt-parity` to the gated `pnpm test:parity` matrix.
- [ ] B7.8 A→B integration test: re-run Track A's parity fixture report through B's `InsightsSection`, assert the LCP-breakdown-card renders 4 sub-part bars from `metrics.lcp.attribution.subparts` (validates A→B data contract).
