# Capability: reproducibility-and-calibration

The two-mode runtime (Real / CI Stable), pre-flight CPU calibration, network throttle profiles, variance reporting.

## ADDED Requirements

### Requirement: Two-mode runtime
The engine SHALL expose two modes: `real` (default in CLI/IDE/extension) and `ci-stable` (default in CI templates). The mode is recorded in `report.meta.mode`. Each report SHALL also carry `report.meta.parity` describing headless/headful and known deltas.

#### Scenario: Mode recorded
- **WHEN** `measure({ url, mode: 'real' })` returns a report
- **THEN** `report.meta.mode === 'real'`
- **AND** `report.meta.parity` includes `{ mode: 'headful' | 'headless', knownDeltas: { ... } }`

#### Scenario: Default modes per surface
- **WHEN** the user runs `ohmyperf <url>` (CLI default) on a TTY
- **THEN** the resulting report has `meta.mode === 'real'`
- **AND** when the same URL is measured via the GitHub Actions template (which sets `--mode ci-stable`), the report has `meta.mode === 'ci-stable'`

### Requirement: Real mode
In `real` mode the engine SHALL NOT apply CPU throttling, network throttling, or device emulation. The browser launches with the user's actual hardware, the actual network, and (default) headful. The engine SHALL surface CoV per metric prominently in any report produced in this mode.

#### Scenario: No throttling applied in real mode
- **WHEN** measurement runs in `real` mode
- **THEN** no CDP `Emulation.setCPUThrottlingRate` call occurs (verified by request log)
- **AND** no `Network.emulateNetworkConditions` call occurs
- **AND** the report records `emulation: false`

### Requirement: CI Stable mode
In `ci-stable` mode the engine SHALL:
1. Run a calibration micro-benchmark (per requirement below) at the start of the measurement.
2. Apply CDP `Emulation.setCPUThrottlingRate({ rate })` to bring the runner's CPU score within ±10% of the reference score.
3. Apply CDP `Network.emulateNetworkConditions` with the configured profile (default `Fast 4G` per Lighthouse).
4. Default to headless (changeable via `--headful`).
5. Record the calibration result in `report.meta.calibration: { reference, observedScore, throttleRate, networkProfile }`.

#### Scenario: Calibration block in report
- **WHEN** a CI Stable run completes
- **THEN** `report.meta.calibration` is non-null
- **AND** contains `reference`, `observedScore`, `throttleRate`, `networkProfile`

### Requirement: Calibration micro-benchmark
The engine SHALL maintain a fixed-source JS micro-benchmark in `packages/core/src/calibration/` (deterministic CPU loop, ~2-second budget, no I/O dependencies). The benchmark SHALL run inside a fresh isolated Chromium context with throttling disabled. The result SHALL be cached on disk per host fingerprint (CPU model + OS + Node version + benchmark version) for 24 hours; subsequent CI Stable runs within that window SHALL reuse the cached calibration unless `--recalibrate` is passed.

#### Scenario: Calibration produces a stable score
- **WHEN** the micro-benchmark runs 10 times on the same idle machine within 1 minute
- **THEN** the resulting score's CoV across the 10 runs is < 0.05
- **AND** the median is recorded as the host's calibration score

#### Scenario: Calibration cache reused
- **WHEN** a CI Stable run is invoked and the on-disk cache has a fresh entry for the same host fingerprint
- **THEN** the engine reuses the cached score without re-running the benchmark
- **AND** `report.meta.calibration.cacheHit === true`

#### Scenario: Stale cache invalidated
- **WHEN** the cached entry is > 24 hours old or the benchmark version differs
- **THEN** the engine recomputes the score and updates the cache

### Requirement: Reference CPU
The engine SHALL ship one default reference CPU score corresponding to a documented 2024 mid-range laptop benchmark (selection recorded in P0). Users MAY supply a custom reference via `ohmyperf.config.ts`:

```ts
export default defineConfig({
  ciStable: { referenceScore: 1234, networkProfile: 'fast4g' }
});
```

#### Scenario: Default reference applied
- **WHEN** `ohmyperf.config.ts` does not specify `ciStable.referenceScore`
- **THEN** the calibration uses the default reference shipped with the engine version
- **AND** `report.meta.calibration.reference` carries the version string of that reference

### Requirement: Calibration failure handling
If calibration fails (e.g. micro-benchmark cannot complete, the host is too slow to reach throttle 1×), the CLI SHALL exit 12 with a clear diagnostic. CI Stable runs SHALL NOT silently fall back to no-throttle.

#### Scenario: Calibration failure exits 12
- **WHEN** the runner's host is so slow that even with `Emulation.setCPUThrottlingRate(1)` (no throttle) the observed score is below `0.5 × reference`
- **THEN** the CLI exits 12 and stderr suggests using `real` mode instead

### Requirement: Variance reporting
Every report SHALL include `aggregated.<metric>.cov` as a finite non-negative number. The HTML reporter SHALL surface CoV next to the median for every CWV. When `cov > 0.20` for any CWV, the report SHALL display a prominent "unstable run" banner.

#### Scenario: CoV next to median
- **WHEN** a multi-run report is rendered as HTML
- **THEN** each CWV tile shows: `LCP: 1800 ms (CoV: 4.2%, n=5)` (or equivalent visual)

#### Scenario: Unstable banner on noisy run
- **WHEN** a report's `aggregated.inp.cov === 0.30`
- **THEN** the rendered HTML report displays a banner with the "unstable" classification
- **AND** the banner explains the threshold (`CoV > 20%`) and recommends increasing `runs` or switching to `ci-stable`

### Requirement: Headless vs headful parity disclosure
Each report SHALL include `meta.parity = { mode: 'headless' | 'headful', knownDeltas }`. The `knownDeltas` field SHALL document any metrics where headless/headful are known to diverge (initially: `inp` flagged as `synthetic-input`).

#### Scenario: Parity block populated
- **WHEN** any measurement completes
- **THEN** `report.meta.parity.mode` is one of `'headless' | 'headful'`
- **AND** `report.meta.parity.knownDeltas` is an object (possibly empty) documenting differences

### Requirement: Cross-mode comparison guard
The diff subcommand SHALL refuse to compare a `real` report against a `ci-stable` report (or vice versa) unless `--allow-cross-mode` is provided.

#### Scenario: Cross-mode diff refused
- **WHEN** `ohmyperf diff <real-report> <ci-stable-report>` is invoked
- **THEN** the CLI exits 2 with a message explaining the modes are not directly comparable

### Requirement: Honest variance documentation
The repository SHALL ship a documentation page `docs/variance.md` that explains expected variance bands per mode, per metric, with empirical data from the OOPIF corpus. Users encountering "unstable" banners SHALL be linked to this page.

#### Scenario: Variance docs exist
- **WHEN** the repository builds documentation
- **THEN** `docs/variance.md` is reachable from the navigation
- **AND** it includes per-mode CoV bands for at least LCP, CLS, INP, FCP, TTFB
