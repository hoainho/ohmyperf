# MCP v0.3.0 — Ralph implementation progress

Branch: `feat/mcp-v0.3.0-parity`. Target: `apps/mcp-server/src/server.ts` (+ `server-v030.test.ts`).
Goal: surface the v0.2.0 engine signals (FLT/`fullLoad`, `hotspots`, Rx `recommendations`,
`visuallyCompleteAt`) via MCP and fix 2 confirmed bugs. Zero net-new tools (count stays 17).

## Stories (all implemented + unit-tested)

- **S1 — third-parties insight fix.** `extractInsight("third-parties")` now reads
  `report.audits.find(a => a.id === "third-parties")?.details` (mirrors engine `hotspots.ts:86`),
  not the never-populated `pluginData["thirdParties"]`. Graceful null when the audit is absent.
- **S3 — measure forwards diagnose/rx/fullLoad (4 layers).** `MeasureInput` interface +
  `parseMeasureInput` whitelist (the silent-drop trap) + `measure` `inputSchema` + `runEngine`
  opts spread. `parseFullLoadConfig` picks only known `FullLoadConfig` keys. Default `measure`
  carries none of them (byte-stable default path).
- **S4 — `full-load-breakdown` insight.** FLT, gatingPhase, gatingDistribution, sub-timeline
  incl. `visuallyCompleteAt`. Graceful "predates v0.2.0 — rerun measure" when `fullLoad` absent.
- **S5 — `hotspots` + `remediation` insights.** Ranked component table / Rx recs (with
  `remediationNote`). Graceful "diagnose:true" / "rx:true" hints when absent.
- **S6 — summarize() surfaces FLT/gating/hotspots/recs.** Presence-guarded lines. Golden test:
  byte-equal on a plain fixture, new lines on a diagnose fixture, no `undefined`, no trailing `\n`.
- **S7 — `measure_and_diagnose` prompt** (8th prompt, renamed from `diagnose` to avoid colliding
  with `diagnose_report`). Chains measure(diagnose+rx) → servability/trust → 3 analyze_report
  insights. No new tool.
- **S8 — enforce_budget trust/servability gate.** `BudgetVerdict.exitCode` widened `0|12|13`
  (13 = gated). New `gated`/`gateReason` fields. `force:true` bypasses. servability != real-page
  wins over trust=unreliable.
- **S9 — propose_patch / verify_fix trust gates.** `unreliableTrustWarning` prepended to
  propose_patch; `classifyVerifyFix` returns `inconclusive` when candidate trust is unreliable.

## Test evidence

`pnpm --filter @ohmyperf/mcp-server test` → 36 passed (23 new in `server-v030.test.ts` + 13 existing).
Typecheck (`tsc -b`) exit 0.

## Learnings / patterns

- `tsc -b` ⇒ composite ⇒ `declaration: true`, so every type referenced in an exported function's
  signature must itself be exported (TS4060). Exported: MeasureInput, InsightSlice, InsightName,
  PromptMessage, BudgetVerdict, BudgetMetricResult, VerifyVerdict + the 7 helper functions.
- `report.fullLoad` is present for EVERY v0.2.0+ report (computed unconditionally in the engine);
  `hotspots`/`recommendations` are gated on `opts.diagnose`/`opts.rx`. So full-load-breakdown's
  absent-hint says "predates v0.2.0", while hotspots/remediation say "re-measure with diagnose/rx".
- The engine has NO top-level `filmstrip` opt — the filmstrip/visually-complete signal is
  `fullLoad.visual: true`, forwarded via the `fullLoad` config object.
- third-parties audit shape: `details.{ items: [{ entity, mainThreadTime, transferSize, ... }] }`.
