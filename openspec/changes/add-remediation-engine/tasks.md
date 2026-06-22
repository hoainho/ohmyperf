# Tasks: Remediation Engine (Rx) — v0.4 "Diagnose" + v0.5 "Remediate"

Author identity per commit: `Hoài Nhớ <nhoxtvt@gmail.com>` (personal workspace). Never `git config --local`.
Depends on: `add-full-load-time` (gatingPhase/headroom) and `add-diagnostic-insights` (long-task attribution, render-blocking, third-parties).

## R0. Types (additive-optional)
- [ ] **R0.1** Add `Hotspot`, `Recommendation`, `Report.hotspots?`, `Report.recommendations?` to `packages/core/src/types.ts`.

## R1. Topology + Hotspots (v0.4 "Diagnose")
- [ ] **R1.1** `dom-topology-collector.ts` — single `Runtime.evaluate` at the FLT checkpoint; per-container signature/childCount/nodeCount/depth/rect-vs-viewport/offscreenFraction + structural-similarity; cap serialized size; sample only containers above thresholds.
- [ ] **R1.2** `hotspots.ts` plugin — join topology + attributed long-tasks/LoAF + waterfall → `report.hotspots[]` ranked by FLT contribution; `cause` enum.
- [ ] **R1.3** `hotspots.test.ts` — fixture reports assert ordering + cause classification + offscreenFraction.

## R2. Rx rule engine (v0.5 "Remediate")
- [ ] **R2.1** `rx.ts` — pure `evaluate(report): Recommendation[]`; implement rules R1–R10 (detect→diagnose→strategies→estimate) per spec; bound `estFltDeltaMs` by `gatingHeadroom`; set `gating`.
- [ ] **R2.2** Per-rule impact estimators + confidence; trust-gating (force `confidence:'low'` + banner on `unreliable`).
- [ ] **R2.3** `howTo` snippets: generic + React/Vue/Svelte/Angular/vanilla per rule; lint that snippets are valid fenced examples.
- [ ] **R2.4** `rx.test.ts` — snapshot determinism; the 5 success-criteria fixtures (off-screen list→R2, network-gated hero→R1 + R5 gating:false, unreliable→low confidence).

## R3. CLI + surfaces
- [ ] **R3.1** `run.ts` — `--diagnose` and `--rx` flags (imply diagnosis collectors); top-3 recs in summary; full arrays in `--json`.
- [ ] **R3.2** `diagnose.ts` — new `ohmyperf diagnose <url>` command (= run + diagnose + rx, focused output); register in `cli.ts`.
- [ ] **R3.3** MCP — `analyze_report` insights `hotspots` + `remediation`; ordered fix-plan keyed off gatingPhase.
- [ ] **R3.4** viewer (HTML) + reporter-markdown — "Hotspots & Fixes" panel: ranked recs, target, est FLT delta, confidence, copyable snippet + framework tabs.

## R4. Verify
- [ ] **R4.1** `ohmyperf diagnose https://moodtrip.hoainho.info` → ranked hotspots + ≥1 targeted recommendation with snippet (Success criterion 1).
- [ ] **R4.2** Off-screen-list fixture → R2 top rec; network-gated-hero fixture → R1 positive + R5 `gating:false` (criteria 2–3).
- [ ] **R4.3** Determinism snapshot + unreliable-trust downgrade (criteria 4–5).
- [ ] **R4.4** `pnpm -w build && turbo run test --continue` green.
