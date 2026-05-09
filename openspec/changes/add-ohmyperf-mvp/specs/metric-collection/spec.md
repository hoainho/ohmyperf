# Capability: metric-collection

Real-browser, real-machine collection of CWV and runtime/resource/coverage/audit metrics, aggregated across N runs into a versioned `Report`.

## ADDED Requirements

### Requirement: Core Web Vitals collection
The engine SHALL collect Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), Interaction to Next Paint (INP), First Contentful Paint (FCP), and Time to First Byte (TTFB) for every measurement run, using the official Google `web-vitals/attribution` library injected via CDP `Page.addScriptToEvaluateOnNewDocument` (so the injection bypasses page CSP).

#### Scenario: CWV emitted for static fixture page
- **WHEN** `measure({ url: 'http://localhost:9999/fixtures/static.html', runs: 1 })` is invoked against the local fixture server
- **THEN** the returned `Report.runs[0].metrics` contains finite numeric values for `lcp`, `cls`, `inp`, `fcp`, `ttfb`
- **AND** each metric carries `attribution` data from `web-vitals/attribution` (e.g. LCP element selector, INP target, longest layout-shift sources)
- **AND** the result is within ±10% of a Lighthouse 12.x run on the same fixture for `lcp`/`fcp`/`ttfb`

#### Scenario: CWV emitted on a page with strict CSP
- **WHEN** `measure({ url: 'http://localhost:9999/fixtures/strict-csp.html', runs: 1 })` is invoked against a fixture serving `Content-Security-Policy: default-src 'self'`
- **THEN** the run completes without CSP violation logs
- **AND** all five CWV metrics are present and finite
- **AND** the report records `meta.cspBypass: 'cdp-init-script'`

### Requirement: Loading metrics collection
The engine SHALL collect DOMContentLoaded, Load, Total Blocking Time (TBT), Time to Interactive (TTI), and Speed Index for every run, computed from `Performance.getMetrics`, `PerformanceTimeline` events, and the trace event stream.

#### Scenario: Loading metrics for a real page
- **WHEN** measurement runs against a fixture
- **THEN** the report contains finite values for `domContentLoaded`, `load`, `tbt`, `tti`, `speedIndex`
- **AND** TBT calculation matches Lighthouse's algorithm within ±5% (sum of long-task time over 50ms threshold between FCP and TTI)

### Requirement: Per-resource timing collection
The engine SHALL collect per-resource timing entries (DNS, TCP, TLS, request, response, transfer size, encoded size, decoded size, render-blocking flag, cache-hit flag) for every network request observed via CDP `Network.requestWillBeSent` + `Network.responseReceived` + `Network.loadingFinished`.

#### Scenario: Resource waterfall captured
- **WHEN** measurement runs against a fixture page that loads a stylesheet, script, and image
- **THEN** the report's `resources` array contains one entry per resource
- **AND** each entry has finite `dnsMs`, `tcpMs`, `requestMs`, `responseMs`, `transferSizeBytes`, `encodedSizeBytes`, `decodedSizeBytes`
- **AND** the stylesheet entry is flagged `renderBlocking: true`

### Requirement: Long-task collection
The engine SHALL collect long tasks (> 50ms) via `PerformanceTimeline` `longtask` events on the root frame and every attached OOPIF session.

#### Scenario: Long task in main thread
- **WHEN** measurement runs against a fixture that executes a 200ms blocking JS loop
- **THEN** the report's `longTasks` array contains at least one entry with `duration >= 50` and `attribution: 'main-thread'`

#### Scenario: Long task in worker
- **WHEN** measurement runs against a fixture that posts a 100ms blocking computation to a Web Worker
- **THEN** the report's `longTasks` array contains an entry with `attribution: 'worker:<scope>'`
- **AND** that long task is NOT counted toward main-thread TBT

### Requirement: JS runtime metrics
The engine SHALL collect JS execution time, layout time, paint time, and composite time for the run, derived from the trace event stream.

#### Scenario: Runtime breakdown emitted
- **WHEN** measurement runs against any fixture
- **THEN** the report contains `runtime: { jsExecMs, layoutMs, paintMs, compositeMs, idleMs }` with finite values

### Requirement: Memory metrics
The engine SHALL collect JS heap (used / total / limit), DOM node count, listener count, and detached-node count via CDP `Performance.getMetrics` and `Memory.getDOMCounters`.

#### Scenario: Memory snapshot at run end
- **WHEN** measurement completes a run
- **THEN** the report's `memory` field has finite `jsHeapUsedBytes`, `jsHeapTotalBytes`, `jsHeapLimitBytes`, `domNodes`, `eventListeners`, `detachedNodes`

### Requirement: Code coverage
The engine SHALL collect unused-JS-bytes and unused-CSS-bytes via CDP `Profiler.startPreciseCoverage({ detailed: true, allowTriggeredUpdates: true })` and `CSS.startRuleUsageTracking`, started BEFORE `Page.navigate` so initial parse is captured.

#### Scenario: Coverage flag enables collection
- **WHEN** `measure({ url, artifacts: { coverage: true } })` is invoked
- **THEN** the report contains `coverage.scripts[]` and `coverage.stylesheets[]`
- **AND** each script entry has `unusedBytes`, `totalBytes`, `usedRatio`
- **AND** each stylesheet entry has `unusedBytes`, `totalBytes`, `usedRatio`
- **AND** coverage values match Lighthouse's `unused-javascript` audit within ±5% on the same fixture

#### Scenario: Coverage collection ordering
- **WHEN** coverage is enabled
- **THEN** `Profiler.startPreciseCoverage` is sent before `Page.navigate`
- **AND** if the engine cannot guarantee that ordering, it logs a warning and emits `coverage: { available: false, reason: 'collector-ordering-violation' }`

### Requirement: HTTP-protocol observation
The engine SHALL record the negotiated HTTP version (HTTP/1.1, HTTP/2, HTTP/3), compression scheme (gzip, br, zstd, none), and CDN identification heuristics for every navigation response.

#### Scenario: HTTP/3 detected
- **WHEN** measurement runs against a host that serves HTTP/3
- **THEN** the report's `meta.protocol` is `'h3'`

### Requirement: N-run aggregation
The engine SHALL run `runs >= 1` measurements (default `runs: 5`), reject outliers via modified Z-score (threshold 3.5, Iglewicz-Hoaglin) for each metric independently when `runs >= 5`, and report median, p75, p95, mean, stdev, and CoV per metric. The engine SHALL NOT apply outlier rejection when `runs < 5`.

#### Scenario: Default 5-run aggregation
- **WHEN** `measure({ url, runs: 5 })` completes
- **THEN** the report's `aggregated` block contains for each metric: `{ median, p75, p95, mean, stdev, cov, runs: 5, droppedOutliers }`
- **AND** `aggregated.cov` is a finite non-negative number

#### Scenario: Unstable run flagged
- **WHEN** `aggregated.cov` for any CWV metric exceeds 0.20 after outlier rejection
- **THEN** the report carries `meta.unstable: true`
- **AND** the HTML report displays a prominent banner explaining the variance

### Requirement: Cold vs warm distinction
The engine SHALL record run 1 as cold (no cache, no warmed JIT) and runs 2..N as warm. Aggregated metrics by default reflect warm runs only; the cold run is reported separately.

#### Scenario: Cold and warm separately reported
- **WHEN** `measure({ url, runs: 5 })` completes
- **THEN** the report contains `coldRun` (the run-1 raw metrics) and `warmAggregated` (computed over runs 2–5)
- **AND** `aggregated` (the headline) equals `warmAggregated` by default

#### Scenario: Cold-only mode
- **WHEN** `measure({ url, runs: 5, cacheMode: 'cold-only' })` is invoked
- **THEN** every run uses a fresh user-data-dir and disabled cache
- **AND** `aggregated` is computed over all 5 runs

### Requirement: Report schema versioning
Every emitted `Report` SHALL include `schemaVersion: '1.0.0'` at the top level and SHALL be valid against the published JSON schema for that version. Future breaking changes SHALL bump the major version and MAY require migration tooling to view older reports.

#### Scenario: schemaVersion always present
- **WHEN** any `measure(...)` call returns a report
- **THEN** `report.schemaVersion === '1.0.0'`

#### Scenario: viewer rejects unknown major
- **WHEN** the viewer is asked to render a report with `schemaVersion: '2.0.0'`
- **THEN** the viewer displays an "unsupported schema version" message with a link to upgrade
