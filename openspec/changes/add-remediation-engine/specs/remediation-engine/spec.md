# Spec: Remediation Engine (Rx)

## ADDED Requirements

### Requirement: Recommendations are prioritized by FLT impact via gating headroom
The Rx engine SHALL compute, for each emitted recommendation, `estFltDeltaMs` bounded by `gatingHeadroom(signal) = FLT − max over other signals of busyUntil`. A recommendation whose target signal is not the FLT gate SHALL set `gating = false` and `estFltDeltaMs` near zero, with a note identifying the metric it *does* improve. Recommendations SHALL be ordered by `estFltDeltaMs × confidenceWeight` descending.

#### Scenario: A non-gating fix is reported as ~0 FLT impact
- **GIVEN** a report where `gatingPhase = "network"` and a main-thread long-task hotspot exists off the gate
- **WHEN** Rx evaluates rule R5 (Split JS)
- **THEN** the R5 recommendation has `gating = false`
- **AND** `estFltDeltaMs` is ≤ the main-thread `gatingHeadroom` (near zero when network dominates)
- **AND** the recommendation note states it improves main-thread/TBT, not FLT now

#### Scenario: The gating fix ranks first
- **GIVEN** the same report where an off-screen hero image gates the `network` signal
- **WHEN** Rx ranks recommendations
- **THEN** the R1 (Lazy media) recommendation targeting that image has `gating = true` and a positive `estFltDeltaMs`
- **AND** it is ordered above the `gating = false` R5 recommendation

### Requirement: Every recommendation is targeted and evidence-backed
Each `Recommendation` SHALL include a concrete `target` (`selector` for DOM, `resource` URL for network) and an `evidence` object containing the measured values that triggered the rule. The engine SHALL NOT emit untargeted generic advice.

#### Scenario: Recommendation names a real target
- **WHEN** Rx emits any recommendation
- **THEN** `target.selector` or `target.resource` is a non-empty string present in the report
- **AND** `evidence` contains the threshold value and the measured value that crossed it

### Requirement: R2 Virtualize fires on large, mostly-off-screen homogeneous containers
The engine SHALL emit recommendation **R2 (virtualize/windowing)** when a container has `childCount ≥ 100` structurally-similar children, subtree `nodeCount ≥ 1000`, and `offscreenFraction ≥ 0.5`. The primary strategy SHALL be windowing with `content-visibility:auto` as the documented fallback.

#### Scenario: A 2,000-row off-screen list triggers virtualization
- **GIVEN** a report whose topology snapshot has a `<ul>` with 2,000 similar `<li>` children, subtree nodeCount 8,200, offscreenFraction 0.92
- **WHEN** Rx runs
- **THEN** an R2 recommendation targets that `<ul>` selector
- **AND** `strategy` references windowing / render-only-visible
- **AND** `alternativeStrategies` includes `content-visibility:auto`
- **AND** `howTo.frameworks` contains React, Vue, Svelte, and vanilla variants

#### Scenario: A small list does not trigger virtualization
- **GIVEN** a container with 20 children
- **THEN** no R2 recommendation is emitted for it

### Requirement: R1 Lazy media fires on eager off-screen media
The engine SHALL emit **R1 (lazy-load)** for `<img>/<iframe>/<video>` whose bounding rect is entirely below the viewport at the FLT checkpoint, that loaded before FLT, and that lacks `loading="lazy"` or IntersectionObserver gating.

#### Scenario: Below-fold image without lazy attribute
- **GIVEN** an `<img>` at `rect.top = 2400` with `viewport.height = 900`, loaded at 800ms, FLT 1500ms, no `loading` attribute
- **WHEN** Rx runs
- **THEN** an R1 recommendation targets that image's selector/resource
- **AND** `strategy` is native `loading="lazy"` (+ `fetchpriority`)

### Requirement: R3 viewport-only fires on excessive DOM
The engine SHALL emit **R3** when document `nodeCount ≥ 1500` and a large fraction of nodes are off-screen at FLT, recommending `content-visibility:auto` + `contain-intrinsic-size` on below-fold sections.

#### Scenario: Excessive DOM with off-screen bulk
- **GIVEN** a report with document nodeCount 4,100 and ≥ 60% of nodes off-screen at FLT
- **THEN** an R3 recommendation is emitted referencing `content-visibility:auto`

### Requirement: Rx is deterministic and trust-gated
For a given Report, the Rx engine SHALL produce byte-identical `recommendations[]` across repeated invocations. When the report's FLT/metric trust verdict is `unreliable`, every recommendation SHALL carry `confidence: 'low'` and a re-measure banner, and no recommendation SHALL claim `confidence: 'high'`.

#### Scenario: Same report yields same recommendations
- **WHEN** `rx.ts` runs twice on the same fixture report
- **THEN** the two `recommendations[]` arrays are deeply equal (including order)

#### Scenario: Unreliable trust downgrades confidence
- **GIVEN** a report with `trustScore.overall = 'unreliable'`
- **WHEN** Rx runs
- **THEN** every recommendation has `confidence = 'low'`
- **AND** the output includes a "re-measure with more runs before acting" banner

### Requirement: Hotspots rank component cost contribution to FLT
The Report SHALL include `hotspots[]`, each `{ selector, label, costMs, bytes, nodeCount, offscreenFraction, gatingPhase, cause }`, sorted by descending contribution to FLT. `cause` SHALL be one of `script | layout | resource | dom-size | third-party`.

#### Scenario: Hotspot table is ordered by cost
- **WHEN** a report with `--diagnose` is produced
- **THEN** `hotspots` is sorted by `costMs` descending
- **AND** each hotspot's `cause` is one of the allowed enum values

### Requirement: `ohmyperf diagnose` is a one-shot why-slow + what-to-fix command
The CLI SHALL provide `ohmyperf diagnose <url>` equivalent to `run` with `--diagnose --rx` enabled, whose output focuses on the hotspot table and the ranked recommendation list. `run --diagnose` and `run --rx` SHALL also expose the same data, and `--json` SHALL include the full `hotspots[]` and `recommendations[]` arrays.

#### Scenario: diagnose prints ranked fixes
- **WHEN** `ohmyperf diagnose <url>` completes on a page with at least one detectable issue
- **THEN** stdout contains a ranked recommendation list with target + estimated FLT delta + a code snippet
- **AND** exit code is `0` on a successful measurement

#### Scenario: diagnose --json carries arrays
- **WHEN** `ohmyperf diagnose <url> --json` completes
- **THEN** the JSON contains `hotspots` and `recommendations` arrays
