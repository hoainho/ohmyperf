# Tasks: Diagnostic Insights (Track B)

## B1. Trace collection + long-task attribution

- [ ] B1.1 Vendor `@paulirish/trace_engine` (or equivalent — verify SHA + license) into `packages/trace-utils/vendor/`. Add NOTICE entry.
- [ ] B1.2 Implement `parseTrace(events): MainThreadTask[]` in `packages/trace-utils/src/index.ts` — bottom-up task aggregation per the DevTools algorithm.
- [ ] B1.3 Implement `attributeTask(task, jsURLs): { url?, invoker? }` — port `getAttributableURLForTask` from Lighthouse 13 (`core/lib/tracehouse/main-thread-tasks.js`).
- [ ] B1.4 Add `trace-collector.ts` to `packages/core/src/collectors-impl/`:
  - On `onSetup`: `Tracing.start({ categories: ['devtools.timeline','v8.execute','disabled-by-default-devtools.timeline','loading'] })`
  - On `onIdle`: `Tracing.end`, then receive `Tracing.tracingComplete` event with `stream` handle.
  - Read stream via `IO.read` chunks → JSON parse → hand to `parseTrace`.
  - Map each task ≥ 50ms to an enriched `LongTaskEntry` with `attribution.url`, `attribution.invoker`.
- [ ] B1.5 Update `LongTaskEntry` type in `types.ts`:
  - Add `attribution: { url?: string, invoker?: string, frameId: string }` (replacing the current string).
  - Backward-compat: keep string in legacy reports via discriminated union in viewer.
- [ ] B1.6 Gate behind `MeasureOptions.collectTrace` (default: `true` for SPA + extension, `false` for `ohmyperf run` unless `--collect-trace`).

## B2. Render-blocking opportunity computation

- [ ] B2.1 Add `render-blocking-collector.ts`:
  - Subscribe to existing resource entries (no new CDP calls).
  - For each `renderBlocking: true` resource, compute `wastedMs = max(0, fcp - resource.responseReceivedTime)`.
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
  - Color bands: duration > 100ms amber, > 300ms red
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
- [ ] B4.9 Refactor `apps/website/components/viewer/report-viewer.tsx`:
  - Replace flat `AuditsList` + `ResourcesTable` blocks with `<InsightsSection>` (new) + collapsible `<details>` for "All audits" + "All resources" + "Frame tree" (current detail level preserved but de-emphasized).

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
- [ ] B7.6 Bundle budget for `/report` route remains < 250 KB gzip (current: 126 KB; insights add ≤ 100 KB).
