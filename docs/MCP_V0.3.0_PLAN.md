# Plan (PENDING APPROVAL — consensus APPROVED: Planner→Architect→Critic): ohmyperf MCP server v0.3.0 — engine parity + hardening

Target: `apps/mcp-server`. Surface the v0.2.0 engine signals (FLT/`fullLoad`, component `hotspots`, Rx `recommendations`, `visuallyCompleteAt`) via MCP and fix confirmed bugs. Planning-only. **Rev2 incorporates Architect review** (S7→prompt, S2 cut, graceful-degradation ACs, gated verdict shape).

## RALPLAN-DR

### Principles
1. **Parity-first** — every v0.2.0 engine signal reachable via MCP as **compact slices**, never a forced 50 KB full-report read.
2. **Additive & backward-compatible** — existing tool names/shapes unchanged; new insights/fields additive; **schemaVersion stays `"1.0.0"`** (the new report fields are already additive-optional at 1.0.0 — no bump, no breakage).
3. **Trust-gated decisions** — `enforce_budget`, `propose_patch`, `verify_fix` refuse/downgrade on `trust=unreliable` or `servability != real-page`.
4. **Fix-before-feature** — repair the confirmed-broken `third-parties` read and the ungated budget before adding surface.
5. **Agent-first ergonomics & no tool-list bloat** — deterministic outputs, accurate descriptions, **zero net-new tools** (use a prompt for the aggregate flow, matching the existing `diagnose_report`/`compare_runs`/`suggest_fixes` prompts).

### Decision Drivers (top 3)
1. MCP is a **full version behind** the engine (exposes none of FLT/hotspots/Rx) → highest-leverage work is closing the parity gap.
2. **Confirmed bugs**: `analyze_report` `third-parties` reads `pluginData["thirdParties"]` but the plugin writes `audits[]` (`third-parties.ts:72,82` → `server.ts:1240`) → always null; `enforce_budget` (`server.ts:811-826`) ignores `report.meta.servability`/`trustScore`.
3. **Backward compatibility** — public MCP clients (Claude/Cursor/Continue, Glama listing) depend on stable tool contracts.

### Viable Options
- **A. Extend existing surface + a prompt (CHOSEN)** — add 3 `analyze_report` insights; surface FLT/hotspots/recs in `measure`+`generate_markdown_summary`; wire `measure` to accept `diagnose`/`rx`/`fullLoad`; add a **`diagnose` prompt** (not a tool) chaining measure+analyze; harden gates. **Zero net-new tools.**
- **B. New dedicated tools** (`get_full_load`, `get_hotspots`, `diagnose`, …). Pros: each shows in the tool list. Cons: bloat (17→21+), duplicates `analyze_report` slices and `measure` flags, more handlers to test.
- **C. Hybrid with one `diagnose` TOOL.** Rejected after Architect review: the one tool it adds is `measure` with two booleans flipped — its only benefit (discoverability) is delivered for free by a **prompt**, at no browser-handler/test cost. So C's "worth one net-new tool" justification evaporates → collapse to A.
  - **Why A / alternatives invalidated:** A reuses the proven 8-insight pattern and the existing prompt pattern; B bloats + duplicates; C's extra tool is redundant with `measure`+flags. A meets the discoverability driver via the `diagnose` prompt with **no** new tool surface.

## Scope — stories (P0 fix/parity → P1 surface → P1 hardening)

### P0 — Correctness & parity data
- **S1 (fix) `third-parties` insight** reads the canonical source. *AC:* `server.ts:1240` reads `report.audits.find(a => a.id === "third-parties")?.details` (the exact reader the engine uses at `hotspots.ts:86`), not `pluginData`; the insight's summary string (`server.ts:1239-1247`) is updated to match the new null/non-null paths; integration test asserts non-null when the audit exists + graceful null otherwise; **plus a regression assertion that the existing `audit_third_parties` prompt (`server.ts:1068`) now returns non-null on a third-parties run** (Critic N3).
- **S3 (parity-data) `measure` forwards `diagnose`/`rx`/`fullLoad`/`filmstrip` opts to `runEngine`** through **all four layers** (Critic DEFECT-1 — `parseMeasureInput` whitelists keys and **silently drops unknown ones**, so editing only the spread ships a `measure` that ignores `diagnose:true`):
  1. `MeasureInput` interface — `server.ts:62-69` (currently ends at `collectTrace?`);
  2. `parseMeasureInput` — `server.ts:1119-1144` (whitelist each new key; mirror `collectTrace` at 1135/1142);
  3. `measure` tool `inputSchema` — `server.ts:153` (so MCP clients can pass them);
  4. `runEngine({opts})` spread — `server.ts:1453-1463`.
  *AC:* `measure(url,{diagnose:true,rx:true})` → saved report has `fullLoad`/`hotspots`/`recommendations` (this test is the real gate — it fails if any of the 4 layers is missed); **default `measure` output byte-stable & no extra cost** (no DOM-topology capture, no screenshots) — asserted by the S6 snapshot.

### P1 — Surface the v0.2.0 signals (read-only over the stored report)
> **Compute location (Architect-confirmed):** hotspots/Rx/fullLoad are computed **at measure time in the engine** (`engine.ts:513-524`, gated on `opts.diagnose`/`rx`). MCP can only **surface stored** values — it cannot recompute them over an old non-diagnose report (the per-run DOM-topology inputs aren't in that report). Therefore every new insight MUST gracefully degrade.
- **S4 `analyze_report` + `full-load-breakdown`** (FLT, `gatingPhase`, `gatingDistribution`, sub-timeline incl. `visuallyCompleteAt`). *AC:* returns those when `report.fullLoad` present; **when absent → non-throwing slice whose summary says "re-measure with `diagnose:true`"**; documented in the enum.
- **S5 `analyze_report` + `hotspots` and `remediation`.** *AC:* `hotspots` → ranked component table; `remediation` → Rx recs (target, est FLT impact, confidence, gating); **both degrade gracefully when absent → "re-measure with `diagnose:true` (and `rx:true` for remediation)"**; tested on a fixture report that has them and one that doesn't.
- **S6 `measure` summary + `generate_markdown_summary` surface** FLT (vs LCP), `gatingPhase`, top hotspots/recs **only when those fields exist** (additive, presence-guarded on real field existence: `report.fullLoad`, `report.hotspots?.length`, `report.recommendations?.length`). *AC (Critic DEFECT-2 — golden, not smoke):* a **snapshot/golden test** asserts `summarize()` (`server.ts:1514-1564`) is **byte-equal to the pre-change output** on a non-diagnose fixture, AND a second snapshot on a diagnose fixture shows the new Full-Load + top-recommendation lines (no `undefined`, no stray trailing newline).
- **S7 `measure_and_diagnose` PROMPT** (not a tool; renamed from `diagnose` to avoid collision with the existing `diagnose_report` prompt — Critic N1): a prompt instructing the agent to call `measure(url,{diagnose:true,rx:true})`, check `get_trust_score`/`get_servability`, then `analyze_report` with `full-load-breakdown` → `hotspots` → `remediation`. *AC:* the prompt is registered (joining the existing 7 prompts) and lists those exact steps; **no new tool added** (count stays 17).

### P1 — Trust-gating & hardening
- **S8 `enforce_budget` gates on trust+servability** with a **discrete verdict field + pinned exit code** (Critic DEFECT-3). *AC:* the verdict gains `gated: boolean` + `gateReason` (`"bot-challenge-suspected"` / `"unreliable"` / `"error-page"`); `BudgetVerdict.exitCode` is **widened `0 | 12 | 13`** where **13 = gated/unmeasurable** (distinct from 12 = budget-exceeded), so CI can branch on exit code OR field; gated only when `servability != real-page` or `trust = unreliable`, unless `force:true`. `enforce_budget`'s own fresh measure stays **non-diagnose** (the gate reads `trustScore`/`servability`, which are always present — no need for diagnose cost). Test: bot-challenge fixture → `gated:true`, `exitCode:13`; over-budget real-page fixture → `gated:false`, `exitCode:12`.
- **S9 `propose_patch`/`verify_fix` trust gates.** *AC:* `propose_patch` prepends a re-measure warning on `trust=unreliable`; `verify_fix` returns `inconclusive` (not pass/fail) when candidate trust is `unreliable`; tests cover both.

## Diagnose-run cost (Architect-flagged; quantified)
`diagnose:true` adds **one `Runtime.evaluate` DOM-topology snapshot per run** (small) + `hotspots`/`recommendations` in the report (~a few KB); `rx:true` adds no browser work (pure post-processing). Observed: a default moodtrip run ≈ 3.2 s/run; a `--rx` 3-run ≈ 9.6 s total — comparable per-run. `filmstrip` (screenshots) is separate and stays opt-in. → default `measure` unchanged; agents opt in via `diagnose:true` or the `diagnose` prompt.

## Testing strategy
MCP has 3 test files. Add: unit/integration per fix (S1, S8, S9) + insight tests (S4, S5) using **fixture reports** (one with `fullLoad`/`hotspots`/`recommendations`, one without — to assert graceful degradation). **S3 + S6 use a golden/snapshot assertion** (not smoke): `summarize()` over a non-diagnose fixture is byte-equal to the pre-change output; a diagnose fixture shows the new lines (Critic DEFECT-2). Live verify against `https://moodtrip.hoainho.info` (the `measure_and_diagnose` prompt flow → FLT + hotspots + recs). Gate: `turbo run build typecheck test --continue` green; **no regression to the existing 17-tool contracts** (snapshot default `measure`/`analyze_report`/`summarize` outputs unchanged).

## Risks & mitigations
- **Output-shape compat** → all changes additive (new insight enum values; presence-guarded summary lines; a new verdict *field*, not a changed boolean). Test asserts default outputs byte-stable.
- **Stored-vs-on-demand (central tension)** → resolved: new insights **surface stored** values and degrade with an actionable re-measure hint; default stays cheap; opt-in via `diagnose:true`/prompt.
- **`enforce_budget` measures fresh** → the gate is discovered post-measure; the discrete `gated`/`gateReason` field (S8) keeps it unambiguous for CI.

## Out of scope (follow-ups)
- **schemaVersion tolerance / type-widening** — *not needed for v0.3.0* (new fields are additive-optional at `1.0.0`). Do it only when a real schema bump is required (must widen the `SchemaVersion` literal type in core, not just guard MCP).
- Viewer HTML "Hotspots & Fixes" panel; CrUX/field data; steady-state-animation suppressor for visually-complete; new reporters.

## ADR (to finalize on approval)
- **Decision:** Option A — extend `analyze_report` (+3 insights) + surface in `measure`/markdown + a `diagnose` **prompt** + harden gates. **Zero net-new tools** (count stays 17).
- **Drivers:** parity gap, confirmed correctness bugs, backward compatibility.
- **Alternatives:** B (new tools — bloat + duplication); C (one `diagnose` tool — redundant with `measure`+flags; discoverability free via prompt).
- **Why chosen:** full parity with least client disruption and **no** tool-list growth; the only "new tool" idea was `measure` with flags.
- **Consequences:** MCP reaches engine parity; tool count unchanged (17); existing clients unaffected (additive); 2 real bugs fixed; gates trustworthy.
- **Follow-ups:** schemaVersion tolerance (when bumping), viewer panel, CrUX, animation suppressor.
