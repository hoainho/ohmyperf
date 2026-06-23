# Spec: Full-Load Time

## ADDED Requirements

### Requirement: FLT is computed from a multi-signal settle model, not from LCP
The engine SHALL compute Full-Load Time (FLT) as the start of the final quiet window of length `settleWindowMs` during which no enabled activity signal (network, DOM mutation, main thread, and optionally visual) is blocking-busy, measured from `navigationStart`. FLT SHALL NOT be derived from, or clamped to, LCP. The set of enabled signals SHALL be selected by `FullLoadConfig.until`.

#### Scenario: Default fully-loaded uses network + DOM + main thread
- **GIVEN** `until = 'fully-loaded'` (the default)
- **WHEN** `computeFullLoad` runs over event streams where the last blocking network end is at 900ms, the last significant DOM mutation is at 1400ms, and the last long task ends at 2100ms
- **THEN** `gatingPhase` equals `"main-thread"`
- **AND** `fltMs` equals `2100` (± the merge resolution of 16ms)
- **AND** `capped` is `false`

#### Scenario: FLT exceeds LCP on a hydrating SPA
- **WHEN** a report is produced for a SPA whose LCP aggregated median is `L` and whose main thread stays busy after `loadEventEnd`
- **THEN** `report.fullLoad.fltMs` is strictly greater than `L`
- **AND** `report.fullLoad.subTimeline.loadEventEnd` is less than `report.fullLoad.fltMs`

#### Scenario: load-event endpoint short-circuits
- **WHEN** `until = 'load-event'`
- **THEN** `fltMs` equals `subTimeline.loadEventEnd`
- **AND** no settle window is required

#### Scenario: network-idle-2 endpoint matches the network checkpoint
- **WHEN** `until = 'network-idle-2'` and `netIdleThreshold = 2`
- **THEN** `fltMs` equals `subTimeline.networkIdleAt` for `k = 2`
- **AND** `gatingPhase` equals `"network"`

### Requirement: Long-lived connections must not prevent settle
The network signal SHALL classify WebSocket, EventSource/`text/event-stream`, keepalive beacons, and any request still open after `longLivedGraceMs` as **non-blocking**, so that a persistent connection does not force `capped`. `--strict-network` SHALL disable this reclassification.

#### Scenario: Persistent WebSocket does not cap FLT
- **GIVEN** a stream where real content settles at 1500ms but a WebSocket opened at 300ms never closes
- **WHEN** `computeFullLoad` runs with default config
- **THEN** `capped` is `false`
- **AND** `fltMs` equals `1500` (± settle resolution)

#### Scenario: strict-network counts the open connection
- **GIVEN** the same stream
- **WHEN** `strictNetwork = true`
- **THEN** `capped` is `true`
- **AND** `gatingPhase` equals `"network"`

### Requirement: A page that never quiets is reported as capped with the offending signal
When no quiet window of length `settleWindowMs` occurs before `maxWaitMs`, the engine SHALL set `capped = true`, `fltMs = maxWaitMs`, and `gatingPhase` to the signal whose blocking activity recurred latest.

#### Scenario: Polling timer caps and names the gate
- **GIVEN** a stream with a blocking XHR firing every 800ms indefinitely and `maxWaitMs = 30000`, `settleWindowMs = 1000`
- **WHEN** `computeFullLoad` runs
- **THEN** `capped` is `true`
- **AND** `fltMs` equals `30000`
- **AND** `gatingPhase` equals `"network"`

#### Scenario: Capped runs are excluded from the aggregate
- **GIVEN** 5 runs where 1 run is `capped`
- **WHEN** the engine aggregates `fullLoad`
- **THEN** the aggregated `fltMs` median is computed over the 4 non-capped runs
- **AND** an INFO log records the excluded capped run
- **WHEN** 3 of 5 runs are `capped`
- **THEN** the aggregate `capped` is `true` and the FLT trust verdict is `"unreliable"` with reason `"never-settled"`

### Requirement: DOM-mutation noise floor filters steady-state churn
A DOM mutation batch SHALL count as blocking-busy only when its weighted magnitude `w = added + 0.25·attr + 0.1·charData + removed` is greater than or equal to `mutationNoiseFloor`. Mutations confined to animated/`<video>`/steady-state nodes SHALL be down-weighted.

#### Scenario: A blinking cursor does not delay FLT
- **GIVEN** a stream whose only post-1000ms DOM activity is single-attribute toggles (`w = 0.25`) every 500ms and `mutationNoiseFloor = 3`
- **WHEN** `computeFullLoad` runs
- **THEN** those batches are ignored for the DOM signal
- **AND** `fltMs` is determined by the other signals, not the cursor

### Requirement: The report carries the FLT value, gating phase, and full sub-timeline
The Report SHALL include `report.fullLoad = { fltMs, capped, gatingPhase, gatingDistribution?, subTimeline, settleConfig }` where `subTimeline` contains `ttfb, fcp, domContentLoaded, loadEventEnd, networkIdleAt, lastMutationAt, lastLongTaskEndAt, visuallyCompleteAt?, fltMs`. `gatingPhase` SHALL be one of `network | main-thread | dom | visual | none | mixed`. The field SHALL be additive-optional so existing 1.x readers are unaffected.

#### Scenario: gatingPhase is the last-quiet signal
- **WHEN** `gatingDistribution = { network: 900, dom: 1400, "main-thread": 2100 }`
- **THEN** `gatingPhase` equals `"main-thread"`

#### Scenario: Sub-timeline is monotonic and present
- **WHEN** a non-capped report is produced
- **THEN** `subTimeline.ttfb ≤ subTimeline.fcp ≤ subTimeline.fltMs`
- **AND** every sub-timeline field is a finite non-negative number or explicitly `null`

### Requirement: CLI exposes the endpoint menu and settle parameters
`ohmyperf run` SHALL accept `--until <load-event|network-idle-2|fully-loaded|visually-complete>` (default `fully-loaded`), `--settle-window <ms>`, `--max-wait <ms>`, `--net-idle-threshold <k>`, `--mutation-noise <w>`, `--strict-network`, and `--filmstrip`. The run summary and `--json` output SHALL include `fltMs`, `capped`, and `gatingPhase`.

#### Scenario: --json includes FLT for CI consumers
- **WHEN** `ohmyperf run <url> --json` completes
- **THEN** the emitted JSON line contains `fullLoad.fltMs`, `fullLoad.capped`, and `fullLoad.gatingPhase`

#### Scenario: Unknown --until value is rejected
- **WHEN** `ohmyperf run <url> --until forever` is invoked
- **THEN** the command exits with `EXIT_CODES.invalidUsage`
- **AND** the error names the four valid endpoint values

### Requirement: Visual signal and filmstrip are opt-in
The visual-quiet signal, Visually-Complete, and the filmstrip artifact SHALL only be collected when `--filmstrip` (`FullLoadConfig.visual = true`) is set. A default run SHALL NOT capture screenshots.

#### Scenario: Default run pays no screenshot cost
- **WHEN** `ohmyperf run <url>` runs without `--filmstrip`
- **THEN** no `Page.captureScreenshot` calls are made for FLT
- **AND** `subTimeline.visuallyCompleteAt` is `null` or absent

#### Scenario: --filmstrip adds visually-complete
- **WHEN** `ohmyperf run <url> --until visually-complete --filmstrip` runs
- **THEN** `subTimeline.visuallyCompleteAt` is a finite number
- **AND** a filmstrip artifact is referenced from the report
