# v0.3.0 perfSummary — Ralph implementation progress

Branch: `feat/perf-summary (folded into v0.3.0)` (stacked on `feat/mcp-v0.3.0-parity`). Plan:
`docs/PERF_SUMMARY_V0.3.0_PLAN.md` (consensus-approved A′). Goal: every measurement surfaces the FULL
perf picture (timing/network/JS/main-thread/errors/console), not just the 4 CWV metrics.

## Stories (all implemented + tested)
- **S1** `Resource.status/failed/failureText` + resource-collector keeps them + emits failed/no-response
  (non-canceled) requests. Tests: 404 status, blocked-no-response, canceled-still-dropped. (7/7)
- **S2** `console-collector` (Runtime.consoleAPICalled + Log.entryAdded, dedupe+count, cap 25) +
  `ConsoleMessage` + pipeline seam (CollectorResult/mergeCollectorResults/buildRunReport). Seam test
  proves data reaches RunReport. (6/6)
- **S3** `error-collector` (Runtime.exceptionThrown, exception vs unhandledrejection) + `PageError`. (5/5)
- **S4** `PerfSummary` (6 groups) + pure `computePerfSummary` derived rollup. Shared
  `scriptBlockingFromLongTasks` (called by computeHotspots too) + `selectLargestResources`/`selectSlowestRequests`
  + exported `representativeRun`. Default-run topBlockingScripts == primitive; diagnose == hotspots-script
  subset; cross-run union for errors. (7/7)
- **S5** engine: collectors default-on; `report.perfSummary` computed every run (post-plugins so it sees
  the third-parties audit); console/errors origin-attributed in the enrichment map.
- **S6** CLI: "Comprehensive perf" block in both summary printers + `perfSummary` in `--json`.
- **S7** MCP: 4 new `analyze_report` insights (11→15: perf-summary/network/javascript/errors), graceful
  degrade; `summarize()` muted Network+Errors lines; `resources` insight repointed to shared selector. (5/5;
  23 v0.3.0 golden tests still green → backward-compat held)
- **S8** markdown reporter: "Comprehensive perf" section, present-guarded. (10/10)
- **S9** version 0.3.0→0.3.0 (18 packages + MCP advertised version) + CHANGELOG + full gate + live verify.

## Test evidence
- Core: 146→160+ tests (resource 7, console 6, error 5, perf-summary 7, hotspots 5 + existing).
- MCP: 41 (5 new v040 + 23 v030 golden + 13). Markdown: 10.
- Full `turbo build typecheck test lint` → exit 0 (all packages).

## Key learnings / patterns
- `tsc -b` composite ⇒ declaration emit ⇒ export every type used in an exported signature; exported
  `buildRunReport` (engine) for the seam test, `representativeRun`/`scriptBlockingFromLongTasks`/
  `extractThirdParties` (hotspots) as shared primitives.
- `computeHotspots` is GATED on diagnose/rx, but `perfSummary` is always-on → JS-blocking is derived from
  always-collected `longTasks` via the shared primitive (NOT from `report.hotspots`).
- `resources` insight + `perfSummary.network` both use `selectLargestResources(runs[0])` → no divergence.
- TBT (`aggregated.tbt`) + `runtime.*` keys are present on every default run (longtask/loading collectors
  are default-on) — verified, not assumed.
- `Runtime.enable` is already called by 4 collectors (idempotent); only `Log.enable` is new.
- console/error originClass is NEW wiring in the engine enrichment map (classifyOrigin over message URL),
  not an existing call site.
