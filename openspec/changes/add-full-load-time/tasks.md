# Tasks: Full-Load Time (FLT) — v0.3 "Measure what's real"

Author identity per commit: `Hoài Nhớ <nhoxtvt@gmail.com>` (personal workspace). Never `git config --local`.

## F0. Types & config (additive-optional only)
- [ ] **F0.1** Add to `packages/core/src/types.ts`: `GatingPhase`, `FullLoadConfig`, `FullLoadReport`, `FullLoadResult`, `Report.fullLoad?`, `MeasureOptions.fullLoad?`. Keep `schemaVersion = "1.0.0"` (additive).
- [ ] **F0.2** Add `FULL_LOAD_DEFAULTS` constant (the §3 defaults) and export from `index.ts`.

## F1. Pure FLT engine (deterministic, unit-tested first)
- [ ] **F1.1** Implement `packages/core/src/full-load.ts` `computeFullLoad(streams, opts)` per `design.md` §2–§6 (per-signal busyUntil, rolling settle, gating attribution, cap handling).
- [ ] **F1.2** Implement blocking-classification (`design.md` §1.1) incl. WebSocket/SSE/beacon/long-lived grace + `strictNetwork`.
- [ ] **F1.3** Implement DOM noise floor + steady-state down-weighting (§1.2).
- [ ] **F1.4** `full-load.test.ts` — synthetic streams for all 8 edge cases in `design.md` §7. Assert deterministic FLT + gatingPhase + capped. (TDD: write these before wiring collectors.)

## F2. Collectors
- [ ] **F2.1** `dom-mutation-collector.ts` — inject MutationObserver via `Page.addScriptToEvaluateOnNewDocument`; expose binding; emit `domMutationTimeline`.
- [ ] **F2.2** `loaf-collector.ts` — `PerformanceObserver('long-animation-frame')` with `longtask` fallback; emit busy intervals.
- [ ] **F2.3** Extend `resource-collector.ts` — running in-flight blocking counter + `networkInflightTimeline` + long-lived classification signals.
- [ ] **F2.4** `filmstrip-collector.ts` (opt-in) — periodic screenshot + viewport pixel-diff; emit `visualTimeline` + Visually-Complete + filmstrip artifact.
- [ ] **F2.5** Wire the four streams into the engine and call `computeFullLoad`; attach `report.fullLoad`.

## F3. Aggregation
- [ ] **F3.1** Aggregate `fltMs` via the existing median/p75/p95/CoV/outlier pipeline; exclude `capped` runs; force `unreliable` when ≥half cap.
- [ ] **F3.2** Aggregate `gatingPhase` as the mode; `"mixed"` when no majority; populate `gatingDistribution`.
- [ ] **F3.3** Give `fltMs` a trustScore verdict (reuse the v0.2.0 quality core).

## F4. CLI
- [ ] **F4.1** Add flags `--until`, `--settle-window`, `--max-wait`, `--net-idle-threshold`, `--mutation-noise`, `--strict-network`, `--filmstrip`; validate `--until` enum → `invalidUsage` on bad value.
- [ ] **F4.2** Surface `fltMs` + `capped` + `gatingPhase` in the human summary AND the `--json` line.

## F5. Reporters & MCP
- [ ] **F5.1** Markdown + HTML (viewer) + deck: "Load timeline" block (sub-timeline bar + FLT + gating callout).
- [ ] **F5.2** MCP `analyze_report` insight `full-load-breakdown` (sub-timeline + gatingPhase).

## F6. Verify
- [ ] **F6.1** Re-measure `https://moodtrip.hoainho.info --runs 5`; confirm FLT > LCP, gatingPhase populated, sub-timeline present (Success criterion 1).
- [ ] **F6.2** `--until network-idle-2` and `--until load-event` match their sub-timeline checkpoints (Success criterion 3).
- [ ] **F6.3** `--filmstrip` adds `visuallyCompleteAt` + artifact; default run makes zero screenshot calls (Success criterion 4).
- [ ] **F6.4** `pnpm -w build && turbo run test --continue` green.
