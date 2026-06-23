# OhMyPerf CLI Upgrade Plan → v0.2.0

**Date:** 2026-06-21 · **From:** 0.1.1 · **To:** 0.2.0 (minor — adds features) · **Method:** deep-design pipeline (20 specialist analysts + 4 adversarial cross-reviewers) grounded in live testing against `https://moodtrip.hoainho.info`.

Companion: [`FLOW_TEST_REPORT_2026-06-21.md`](./FLOW_TEST_REPORT_2026-06-21.md), [`V2_IMPROVEMENT_PLAN.md`](./V2_IMPROVEMENT_PLAN.md).

---

## 0. Current state — do the CLIs work?

**Yes — all 8 commands run successfully** (run, diff, share, doctor, init, list-plugins, list-styles, install-browser; verified live against moodtrip). The real gap is **measurement trustworthiness, output completeness, and CI-gating** — the engine is strong but the CLI doesn't *expose* its best signals and silently no-ops several gates.

Live moodtrip result: 🟢 LCP/FCP 570ms · TTFB 207ms · CLS 0 · TBT 0 (PASS), 13 resources / 689 KB, but overall **trustScore = unreliable** (the headline finding below).

---

## 1. Settled decisions (HIGH confidence — multiple analysts + reviewer-confirmed in code)

These are confirmed against `file:line` and survived adversarial review.

### The unifying insight (from the reviewers' optimality notes)
Almost every P0/P1 defect collapses into **two root-cause architectural moves**. Do these first; most individual findings fall out as consequences:

- **Move A — One quality/verdict core.** Noise & sample-size classification is computed in 2–3 places with *divergent* thresholds (`trust-score.ts` HIGH_COV=0.10/MED=0.25 vs `engine.ts:587` `UNSTABLE_COV_THRESHOLD=0.2`), outlier rejection lives apart from the trust gate, and budget/servability gates don't talk to each other. Consolidate into **one `@ohmyperf/core` quality module + one `evaluateVerdict(report, budget)`** used by `run`, `diff`, `enforce_budget`, JUnit, and MCP. Fixes F1, F2, the `isReportUnstable` inconsistency, the phantom `--budget`, and the ungated CI verdict in one stroke.
- **Move B — One source-of-truth registry + one resolver.** `list-plugins`, `SUPPORTED_FORMATS`, the `--format`/`--style` help text, and the interactive menu drift independently (→ `list-plugins` omits `third-parties`; `har/trace/lh-compat` hidden). And resolution logic is hand-rolled in 4 sites (2 already caused shipped bugs). Consolidate into **one capability registry** (plugins + format→writer map) and **one tested `apps/cli/src/lib/resolve.ts`**.

---

## 2. Roadmap

### P0 — Correctness & trust (the run *looks* green but isn't *trustworthy*)

| ID | Issue (finding) | Fix | Target | Effort |
|----|-----------------|-----|--------|--------|
| P0.1 | **F1**: `--runs 5` + outlier rejection (n≥5 floor) + trust gate (n≥5) self-defeating → one dropped run gives n=4 → `unreliable`. Confirmed live (droppedOutliers:1). | Add `originalRuns` to `AggregatedMetric`; use **pre-rejection n** for `sampleConfidence`, post-drop only for `effectConfidence`. Raise `DEFAULT_RUNS` 5→7. | `core/engine.ts:~567-600`, `llm-signals/trust-score.ts:34`, `cli/run.ts:35` | M |
| P0.2 | **F2**: near-zero CLS → structurally `unreliable` via relative CoV on a zero-bounded metric (122.5% live). Also poisons the `⚠ unstable run` banner. | CLS-specific branch: when `median<0.05`, classify by **absolute stdev** (not CoV). Unify `isReportUnstable` threshold with the trust scorer. | `trust-score.ts:classifyMetric`, `engine.ts:587` | S |
| P0.3 | **F3**: `third-parties` plugin writes `report.audits[]` but 4 consumers read `pluginData["thirdParties"]` → permanently `null` (MCP insight returns "no data" though the markdown reporter renders it). | Align producer/consumer on one key (plugin sets `pluginData.thirdParties` via the documented path; point all consumers there). | `plugins-builtin/third-parties.ts`, `mcp-server/server.ts:1239`, schema readers | S |
| P0.4 | **`--budget` is a phantom gate**: parsed, validated, guarded against runs=1 — but **never evaluated**. CI gating silently always passes. (found by 4 agents) | Evaluate `report.aggregated` vs thresholds after `runEngine`; PASS/FAIL banner; exit on breach. Reuse `evaluateBudget`/`parseBudget` from MCP via a shared core fn (Move A). | `cli/run.ts`, `core` (extract budget eval) | M |
| P0.5 | **CI gate ignores trust/servability**: `enforce_budget` (and the CLI verdict) returns green even for bot-challenge or `unreliable` reports. | In the shared verdict fn: if `servability!=real-page` or `trust=unreliable` → non-pass + reason, `--force` to override. | `core` verdict fn, `cli/run.ts`, `mcp-server/server.ts:~819` | S |
| P0.6 | **trustScore/servability invisible from the CLI** in TTY *and* `--json` — the headline feature can't gate CI. | Print trust+servability in `printHumanSummary`; add `trustScore`, `trustRecommendedAction`, `droppedOutliers`, `auditsFailed`, CWV `verdict` to the `--json` line. | `cli/run.ts:343-355,476-501` | S |
| P0.7 | **Discoverability lies**: `list-plugins` omits `third-parties`; `SUPPORTED_FORMATS` omits shipped reporters. | Drive from one registry (Move B); add drift guard test. | `cli/list-plugins.ts`, `cli/run.ts:32` | S |

### P1 — High-value coverage & robustness

| ID | Issue | Fix | Effort |
|----|-------|-----|--------|
| P1.1 | Engine supports emulation/network/viewport/cpu but CLI exposes none → **mobile simulation impossible**. | `--emulation mobile-slow-4g`, `--network-profile`, `--viewport`, `--cpu-throttle`; surface in interactive prompt. | M |
| P1.2 | `diff` requires manual two-file juggling; no URL-equality guard (cross-page diffs pass silently). | `--allow-cross-url` guard + **baseline history**: `ohmyperf baseline save/diff` from `.ohmyperf/baselines/`. | M |
| P1.3 | Monitoring/history is MCP-only. | `ohmyperf trend <url>` + `ohmyperf budget <url>` thin CLI wrappers over existing `timeseries.ts`/`evaluateBudget`. | M |
| P1.4 | Resolver duplicated in 4 sites (2 shipped bugs), no tests; `init` returns a non-existent path on miss; `install-browser` hard-exits before fallbacks. | One tested `cli/src/lib/resolve.ts` (Move B); throw typed error on total miss; ordered runner list. | M |
| P1.5 | `doctor` has no platform-mismatch check (the Linux-binaries-on-macOS class), collapses all issues to exit 2. | Native-binary platform check + `scripts/check-platform.mjs` preinstall; categorized exit codes. | M |
| P1.6 | Non-uniform error→exit-code mapping; brittle English-substring matching of browser errors. | Typed error classes in driver/core; `mapErrorToExitCode` on `instanceof`. | M |
| P1.7 | `reporter-har/trace/lh-compat` are **empty stubs** but listed as `ReporterName` (silent no-op for programmatic callers). | Implement writers + wire to `--format`, or hard-guard + document "reserved". | L |
| P1.8 | **schemaVersion** enforced by exact `!== "1.0.0"` throws in 4 readers — no migration tolerance. | One `parseReportVersion()` (major-compare) used by all readers. | M |

### P2 — Polish & ecosystem

- P2.1 **Audit de-dup** at source: idempotent audits accumulate N× (one per run) — upsert by `(pluginId, audit.id)` in `plugin-runtime.ts` (fixes F5 in every reporter at once).
- P2.2 **Dedup servability signals** (F6, `Set`); reconcile **LCP attribution vs aggregate** (F4 — pick representative run nearest median, label it).
- P2.3 Report footer shows "OhMyPerf v1.0.0" = schemaVersion conflated with product version (F9).
- P2.4 Publish a **GitHub Action** (`uses: hoainho/ohmyperf@v0`); pin CLI install in templates; bump CI templates `--runs` 5→7.
- P2.5 Docs: MCP tool count stated 4 inconsistent ways; `--runs 5` self-defeating in quickstart; `install-browser --quiet` blank `--help`; document exit 130.
- P2.6 Statistical polish (reviewer-found): sample-variance (n-1) not population (÷n) for tiny n; Mann-Whitney continuity/tie correction; trust verdict for non-CWV metrics.

---

## 3. Conflict log — disputed / de-prioritized (adversarial reviewers pushed back; recorded for transparency)

| Claim | Reviewer verdict | Resolution |
|-------|------------------|------------|
| `diff collectRunValues` uses raw (outlier-inclusive) runs → "divergence" | Real but **severity-inflated** — median is robust to one dropped outlier | Downgrade to P2; emit a `logger.warn` only |
| "adaptive top-up" / "ci-stable clamp runs to ≥8" | **Speculative scope creep** | Cut from v0.2.0; minimal F1 fix is pre-rejection n + default 7 |
| `authorization/cookie` headers never scrubbed (share/security) | **Dead path** — `Resource` type carries no headers today | Add TODO; not an active leak |
| `reporter-har/trace/lh-compat` `private:true` "will never publish" | **Mis-prioritized** — they're intentional stubs | Don't publish empty stubs; implement first (P1.7) |
| `cli.ts void runMain` "loses exit codes" | **Partially overblown** — `run.ts:284` already try/catches | Add a top-level `.catch` guard only (cheap) |
| `list-styles`/`run --style` "no flag" | **Wrong** — `run.ts:78-82` has `--style` | Real issue is silent theme-fallback warning (P2) |

## 4. Missed-by-analysts (surfaced only in cross-review — net-new)

- **`apps/runner` is an entire unauthenticated HTTP measurement service no analyst examined** — `ssrf-guard.ts` resolves the host once then `measure.ts` refetches → **DNS-rebinding/TOCTOU SSRF**; no CSP on rendered report HTML. *Out of CLI scope but a real security item — track separately.*
- `isReportUnstable` uses a different CoV threshold (0.2) than the trust scorer → contradictory "unstable" banners.
- `install-browser` spawns bare `pnpm`/`npx` with no shell → on Windows these are `.cmd` shims that `spawn` can't exec (the documented fallback is broken on Windows).
- `printBeautifulSummary` (TTY) and `printHumanSummary` (non-TTY) diverge in what they show.

---

## 5. Version bump (done)

`0.1.1 → 0.2.0` (minor — new features) applied to the cohesive published set (**18 packages**: root `ohmyperf`, `@ohmyperf/cli`, core, mcp-server, driver-playwright, design-tokens, eslint-plugin, fixers, plugins-builtin, viewer, share-client, trace-utils, reporter-csv/deck/html/json/junit/markdown). `0.0.0-pre` internal packages and `ohmyperf-vscode` (0.1.0) left untouched. CLI `--version` now reports `0.2.0`. CHANGELOG `[0.2.0] - Unreleased` added. For release, the analysts note `publish-stable.yml` should use `workflow_dispatch` with `bump: minor` explicitly (the auto-detector may emit 0.1.2 if no `feat:` commit is in range).

## 6. Suggested execution order

1. **Move A** (quality/verdict core) → unlocks P0.1, P0.2, P0.4, P0.5, P0.6.
2. **Move B** (registry + resolver) → unlocks P0.7, P1.4.
3. P0.3 (third-parties key), P2.1 (audit de-dup) — small, high-clarity wins.
4. P1.1 (emulation), P1.3 (trend/budget CLI), P1.2 (baseline history).
5. Tests (P2/P1.4 coverage), docs, GitHub Action.

## 7. Risks & open questions

- **Trust-gate-by-default (P0.5/P0.6) is a behavior change** — correct for a minor bump but gate behind `--force` and document loudly; CI users relying on green-always will see new failures (that's the point).
- Default `--runs 7` raises wall-clock ~40% — pairs well with P1 browser-reuse/`--concurrency` (performance findings) to offset.
- `apps/runner` SSRF is the highest-severity *security* item found but is out of CLI scope — recommend a separate hardening pass.
