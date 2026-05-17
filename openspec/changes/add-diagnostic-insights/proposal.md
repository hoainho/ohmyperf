# Proposal: Diagnostic Insights — "Where is it slow + What to fix" (Track B)

## Why

After Track A lands, OhMyPerf's numbers are trustworthy — but a user looking at a Report still cannot answer the only question that matters: **"why is my page slow, and what do I fix first?"**

The post-MVP audit (Sisyphus 2026-05-17) confirmed this is a hard gap:

1. **No long-task attribution.** Long tasks are collected but stored as `{ startTime, duration, attribution: "main-thread" | "frame:<id>" }`. No JS file blame, no call stack, no function name. The user sees a 320ms blocking task and has zero idea which script caused it.
2. **No LCP element breakdown UI.** Even when Track A populates `attribution.element` and `attribution.subparts`, the SPA's `ReportViewer` doesn't render them.
3. **No render-blocking impact estimate.** The Report flags `renderBlocking: true` per resource but never computes `wastedMs` (the delay imposed on FCP by this resource), which is the actionable number Lighthouse surfaces.
4. **No third-party impact analysis.** A page can pull in Google Tag Manager + Cloudflare beacon + Hotjar and there's no callout telling the user "third parties block 500ms of your main thread."
5. **No CLS culprit list.** Even with Track A's per-shift attribution, the SPA has no UI to expand "which shift" and "what element."
6. **No long-task → script attribution.** Lighthouse's `getAttributableURLForTask()` walks the trace tree; OhMyPerf's `trace-utils` package is a 2-line stub.

This change builds the engine-side data + the SPA-side UI to surface diagnostics in the **Lighthouse 13 / WebPageTest** style. The research brief (`bg_69921028`) documented exact patterns to adopt: 4-zone report layout, metric filter pills, three-clump audit grouping, LCP/INP sub-parts bars, third-party entity table, long-task list with URL attribution.

## What changes

### Added (engine layer)

- `packages/trace-utils/src/index.ts` — promote from 2-line stub to actual implementation. **Vendor only Lighthouse 13's `core/lib/tracehouse/main-thread-tasks.js` + `getAttributableURLForTask`** (~300-500 LOC, Apache-2.0, self-contained). Do NOT vendor the full `@paulirish/trace_engine` — its import graph is fast-moving and ~150KB; the Lighthouse subset is stable and sufficient. Expose:
  - `parseTrace(traceEvents: TraceEvent[]): MainThreadTask[]`
  - `attributeTask(task, jsURLs): { url?: string, invoker?: string }`
- `packages/core/src/collectors-impl/trace-collector.ts` — NEW. **Greenfield work** (CDP `Tracing` domain is not used anywhere in the codebase today; this is not "promote a stub"). Lifecycle hooks: `create(session, ctx)` calls `Tracing.start` with category set `['devtools.timeline', 'v8.execute', 'disabled-by-default-devtools.timeline', 'loading']` BEFORE navigate; `finalize()` calls `Tracing.end` + reads via `IO.read` chunks. Hard cap: refuse traces > 100MB (emit `error: 'trace-too-large'` and fall back to PerformanceObserver-based long-tasks). Warn threshold: log at 25MB. Store raw trace as a side artifact (`Report.artifacts.traceRef`), NOT inline in Report. Parse trace synchronously in main thread (V8 handles 100MB JSON in ~1s; worker-thread is over-engineering for v1).
- `packages/core/src/collectors-impl/render-blocking-collector.ts` — NEW. Cross-references resources' `responseReceived.timing.receiveHeadersEnd` with the FCP timestamp; computes `wastedMs` per render-blocking resource as `max(0, fcp - receiveHeadersEnd)`. Surfaces in `RunReport.opportunities[]`.
- `packages/plugins-builtin/src/third-parties.ts` — NEW reference plugin. Embeds the `third-party-web` nostats-subset dataset. After `onIdle`, groups resources by `getEntity(url)`, sums `transferSize` and `mainThreadTime` per entity, emits an `audit` named `third-parties` with `details.items[]`.
- `packages/core/src/types.ts` — add `Opportunity` shape (`{ id, title, description, metric: 'lcp' | 'fcp' | 'tbt' | 'inp' | 'cls', wastedMs?, wastedBytes?, items: Array<unknown> }`) and `RunReport.opportunities[]` (optional, backward compat). Also add `LongTask.attributionRich?: { url?: string, invoker?: string, frameId: string }` as a NEW optional sibling field — DO NOT change `LongTask.attribution: string` (that would be a breaking type change to a frozen API). Reader pattern: `attributionRich ?? { invoker: attribution }`. Schema stays at `1.0.0`.

### Added (SPA layer)

- `apps/website/components/insights/metric-filter-pills.tsx` — radio row "All | LCP | INP | CLS | TBT | FCP" filtering visible diagnostic cards by `metric` field.
- `apps/website/components/insights/lcp-breakdown-card.tsx` — stacked bar of `ttfb / loadDelay / loadDuration / renderDelay` + element selector + element thumbnail (when screenshot artifact is present; fallback to text).
- `apps/website/components/insights/inp-breakdown-card.tsx` — stacked bar of `inputDelay / processing / presentation` + interaction target selector + longest-script callout.
- `apps/website/components/insights/cls-culprits-list.tsx` — collapsible list of largest shifts; each item shows element selector + visualized rect delta (SVG before/after).
- `apps/website/components/insights/long-tasks-table.tsx` — top 20 long tasks sorted by duration; columns: URL (truncated, mono) | start time (ms into load) | duration (ms with amber > 100ms, red > 300ms badge).
- `apps/website/components/insights/render-blocking-table.tsx` — render-blocking resources with `wastedMs` column.
- `apps/website/components/insights/third-parties-card.tsx` — entity table sorted by `mainThreadTime DESC`; expandable sub-rows per URL; category badge with `third-party-web` HSL color.
- `apps/website/components/insights/insights-section.tsx` — orchestrator that wraps the 4-zone Lighthouse layout: Metrics grid (existing tiles) → Filterable insights (the above) → Score gauge.
- `apps/website/components/viewer/report-viewer.tsx` — refactored to import `InsightsSection` and replace the current flat Audits + Resources blocks (now relegated to a collapsed "All resources" / "All audits" details).

### Modified
- `apps/runner/Dockerfile` — no change required; trace collection works on the existing Chromium.
- `packages/viewer/src/render.ts` (CLI HTML reporter) — mirror the SPA insights into the SSR HTML (so `ohmyperf run --format html` also surfaces the same diagnostics).
- `packages/reporter-markdown/src/index.ts` — add an "Insights" markdown section with LCP element + top 5 long tasks + top 5 third parties.

## Out of scope

- **Filmstrip** (screenshot timeline) — requires a screenshot collector at fixed intervals; deferred to v1.2 unless trivial to add via `Page.startScreencast`.
- **Performance Insights v2** (Lighthouse 13's `@paulirish/trace_engine` insights like `lcp-discovery-insight`) — we ship `lcp-breakdown` + `inp-breakdown` + `render-blocking` + `third-parties` + `cls-culprits` + `long-tasks`. Other insights deferred.
- **Trend / history sparklines** — requires share-server-side historical storage; Track C dependency.
- **i18n for new strings** — English only in this track; defer to v1.1 i18n track (consistent with `messages/vi.json` already being `__TODO_VI__`).

## Pinned design decisions (Phase 2 synthesis 2026-05-17)

- **trace-utils source**: Lighthouse 13 `core/lib/tracehouse/main-thread-tasks.js` vendored as-is. NOT `@paulirish/trace_engine`.
- **`LongTask.attribution` stays a `string`** for backward-compat; new info goes in sibling `attributionRich?` field. Schema version stays `1.0.0`.
- **Long-task attribution shape**: flat `{ url, invoker, frameId }` for v1 (NOT richer `{longestScript, contributors[≤5]}` — that's a follow-up if user demand surfaces).
- **B4.9 ReportViewer refactor MERGES with Track C's C8** into one consolidated PR at the B→C boundary. Same file, doing it serially doubles the diff.
- **B7 owns TBT parity test** (`tests/parity/tbt-parity.test.ts`) — split out from Track A's A4.3 since TBT requires trace-based long-tasks that only land in B1.

## Success criteria

1. Re-measure `https://blog.thnkandgrow.com/` (the γ.18 fixture).
2. Report screen shows:
   - LCP card with `<element-selector>` + 4-segment stacked bar
   - "13 render-blocking resources costing 240ms on FCP" callout, expandable to a table
   - "Third parties: Google Tag Manager 320ms, Cloudflare beacon 80ms" entity card
   - Long-tasks table with at least 1 row attributed to a JS URL (not "anonymous")
3. Metric filter pills work: clicking "LCP" hides INP/CLS-only insights.
4. Markdown report (`ohmyperf run --format markdown`) contains the new Insights section.

## Risks

- **Tracing adds ~500ms overhead per run.** Mitigation: enable only when `--collect-trace` flag is set (default on for SPA + extension, opt-out for CLI scripts).
- **`@paulirish/trace_engine` is a fast-moving DevTools internal library.** Mitigation: vendor a known SHA into `packages/trace-utils/vendor/`, NOTICE updated.
- **`third-party-web` nostats-subset is ~80KB.** Mitigation: lazy-load only when the third-parties plugin is registered.
- **Insights UI replaces existing flat blocks.** Mitigation: keep the flat blocks as collapsible "View all" details so power users aren't blocked.
