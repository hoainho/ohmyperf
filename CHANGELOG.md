# Changelog

All notable changes to this project will be documented in this file.


## [0.3.0] - 2026-06-23

MCP server parity + hardening release. Surfaces the v0.2.0 engine signals (Full-Load Time,
component hotspots, prescriptive remediations) through the MCP server and fixes two confirmed
bugs. Fully additive — `schemaVersion` stays `1.0.0`, the 17 tools keep their names/shapes, and
default `measure`/`analyze_report` outputs are unchanged. Scope, design, and acceptance criteria
in [`docs/MCP_V0.3.0_PLAN.md`](docs/MCP_V0.3.0_PLAN.md); per-story notes in
[`docs/MCP_V0.3.0_PROGRESS.md`](docs/MCP_V0.3.0_PROGRESS.md).

### Added (MCP)
- feat(mcp): `analyze_report` gains 3 insights (8 → 11): `full-load-breakdown` (settle-based Full-Load Time, gating phase + distribution, sub-timeline incl. `visuallyCompleteAt`), `hotspots` (ranked component/region cost table), `remediation` (prescriptive Rx fixes with est. FLT impact + gating). All degrade gracefully on reports that lack the data.
- feat(mcp): `measure` now forwards `diagnose` / `rx` / `fullLoad` to the engine, so the v0.2.0 diagnostic signals are reachable via MCP (default `measure` unchanged).
- feat(mcp): `measure` / `generate_markdown_summary` summary surfaces Full-Load Time, gating phase, and the top hotspots/recommendations (presence-guarded).
- feat(mcp): new `measure_and_diagnose` prompt (7 → 8) — measure(diagnose+rx) → trust/servability → full-load-breakdown → hotspots → remediation, in one flow. No new tool (count stays 17).

### Fixed (MCP)
- fix(mcp): `analyze_report` insight `third-parties` read the never-populated `pluginData["thirdParties"]` (always null); now reads the `third-parties` audit (`report.audits[…].details`), the same source the engine uses. Also unblocks the `audit_third_parties` prompt.
- fix(mcp): `enforce_budget` ignored measurement quality; now trust/servability-gated — `exitCode` widened `0|12|13` (13 = gated/unmeasurable), with `gated`/`gateReason` and a `force` override. A bot-challenge / error / `unreliable` measurement no longer gates CI on meaningless numbers.
- fix(mcp): `propose_patch` prepends a re-measure warning when `trustScore=unreliable`; `verify_fix` returns `inconclusive` (not pass/fail) when the candidate's trust is unreliable.

### Changed
- chore(mcp): server now advertises version `0.3.0` (was `0.0.0-pre`).
- chore: version bump 0.2.0 → 0.3.0 across the published package set.


## [0.2.0] - 2026-06-23

CLI-upgrade release. Full scope, severity, and `file:line` targets are tracked in
[`docs/CLI_UPGRADE_PLAN_v0.2.0.md`](docs/CLI_UPGRADE_PLAN_v0.2.0.md) — grounded in a 20-agent
analysis + 4-agent cross-review and live testing against https://moodtrip.hoainho.info.

### Planned (P0 — correctness/trust)
- fix(core): decouple outlier rejection from the n≥5 trust gate; default runs 5→7 so a single dropped outlier no longer forces trust=`unreliable`.
- fix(core): metric-aware noise floor for near-zero CLS (absolute stdev, not relative CoV); unify the trust scorer and `isReportUnstable` thresholds.
- fix(plugins/mcp): third-parties data key — producer writes `audits[]` but consumers read `pluginData["thirdParties"]` (always null); align producer/consumer.
- fix(cli): surface `trustScore`/`servability` in the run summary AND `--json`; gate CI verdicts on trust+servability (`--force` to override).
- fix(cli): implement the parsed-but-never-evaluated `--budget` gate (exit code on breach).
- fix(cli): `list-plugins` omits `third-parties`; `SUPPORTED_FORMATS` omits shipped reporters — drive both from one source-of-truth registry.

### Planned (P1/P2)
- feat(cli): `--emulation`/`--network-profile`/`--viewport`/`--cpu-throttle` (engine already supports it); `ohmyperf trend`/`budget`; baseline-history for `diff`.
- fix(cli): unified, tested resolver module (init templates + browser binary); `doctor` platform-mismatch guard.
- test: golden-file tests for reporter-csv/junit/har/lh-compat, trace-utils, share-client/redact.
- chore: version bump 0.1.1 → 0.2.0 across the published package set.


## [0.1.1] - 2026-05-30

### Added
- feat(extension): real Chromium E2E test harness + handshake race fix [skip ci]
- feat(extension): auto-discover extension ID via postMessage handshake
- feat(website): redesign landing page + add HARNESS landing-self-measure layer
- feat(deploy): zero-credential GitHub Pages mirror of website
- feat(launch): repo-public polish — README hero, share UX, launch drafts [skip ci]
- feat(core,llm-signals): fixes W1-W5 from real-world Phase 2 demo [skip ci]
- feat(core,mcp): LLM-first report signals — trustScore, fixPlan, servability, originClass (Phase 1) [skip ci]
- feat(distribution): credential-ready deploy configs + listing prep (Wave 3 #14, #15, #16) [skip ci]
- feat(cli): top-of-output PASS/FAIL verdict banner (Wave 3 #21) [skip ci]
- feat(viewer): SVG status dots replace ASCII icons + fix W2-#10 stale test (Wave 3 #22) [skip ci]
- feat(viewer,reporter-deck): print-color-adjust: exact preserves CWV traffic-light colors on PDF (Wave 3 #24) [skip ci]
- feat(reporter-markdown): top-of-PR CWV verdict block + status emojis (Wave 3 #25) [skip ci]
- feat(mcp): verify_fix MCP tool — close the agent fix loop (Wave 2 #19) [skip ci]
- feat(fixers,mcp): propose_patch MCP tool + @ohmyperf/fixers package (Wave 2 #18) [skip ci]
- feat(eslint-plugin): @ohmyperf/eslint-plugin with 7 CWV-linked rules (Wave 2 #20) [skip ci]
- feat(driver-playwright): real per-frame CDPSession for OOPIFs (Wave 2 #11) [skip ci]
- feat(core): SourceLocation type + sourcemap detection MVP (Wave 2 #17 stage 1) [skip ci]
- feat(viewer): implement CWV per-run sparkline (Wave 2 #10) [skip ci]
- feat(core): wire measure() programmatic API to runEngine (Wave 2 #7) [skip ci]
- feat(core,driver): syntheticInteraction option + nested iframe coverage (Wave 2 #12 + #13) [skip ci]

### Fixed
- fix(review): address 3-Angle review findings on PR #21 [skip ci]
- fix(engine): batch 4 report-quality bugs from session weakness analysis [skip ci]
- fix(review): address 3-Angle review findings on PR #13 [skip ci]
- fix(smoke-test): landing hero text changed after fb46810 rewrite [skip ci]
- fix(extension): 'process is not defined' — 4 Node-only API leaks [skip ci]
- fix(spa): SW idle race + extension ID resolution [skip ci]
- fix: defer backend detection until submit
- fix(website): NEXT_PUBLIC_EXTENSION_ID missing from production build [skip ci]
- fix(extension-chrome): runtime origin allowlist missed hoainho.github.io
- fix: 2 user-reported issues — Chrome ext download + axe-core spam [skip ci]
- fix(website): real-browser audit caught 6 production bugs [skip ci]
- fix: address Gemini PR #8 review feedback (4 findings) [skip ci]
- fix(mcp,core,test): Phase 6 — address all 14 QA findings from 3-agent review [skip ci]
- fix(core,mcp): honest small-sample stats in diff + verify_fix runs default 3→5 [skip ci]
- fix(fixers): meaningful skipped entries + mimeType classification (real-world bug from npmjs.com) [skip ci]
- fix(ci,mcp): retire macos-13 runner + expose savedPath in measure() summary [skip ci]
- fix(core): extract measure() Node-only path to measure-node.ts (extension build fix)
- fix: 8 BLOCKER+BUG fixes from Wave 1 of v0.2.0 audit

### Documentation
- docs: migrate harness to workspace symlinks
- docs(harness): optimize Implement + Review + Test stages [skip ci]
- docs(harness): Forbidden #19 — Node-only globals leaking into browser bundle [skip ci]
- docs(harness): Forbidden #18 — MV3 SW connect-first pattern [skip ci]
- docs(harness): Forbidden #17 — Chrome extension 4-layer allowlist + ID architecture [skip ci]
- docs(harness): add test:landing-real-browser layer + Forbidden #16 [skip ci]
- docs(readme): retarget remaining ohmyperf.dev links to live Pages site
- docs(harness): 7 amendments from v0.2.0 session retrospective [skip ci]
- docs(eslint-plugin,readme): document @typescript-eslint/parser requirement for TS/TSX projects [skip ci]
- docs(changelog,ci): purge phantom v0.1.1 entry + drop chore [skip ci] filter [skip ci]
- docs(readme): surface v0.2.0 features — agent fix loop, eslint-plugin, OOPIF, INP [skip ci]
- docs(harness): add Distribution Runbook section linking the 4 deploy docs [skip ci]
- docs: NPM_TOKEN failure is E404 (read-only token), not E401 — correct anh's fix [skip ci]

### Other
- chore(self-measure): landing CWV + click-test proof after ext-zip fix [skip ci]
- chore(self-measure): post-fix landing CWV proof per Forbidden #15 [skip ci]
- chore(self-measure): landing page CWV proof per HARNESS Forbidden #15 [skip ci]The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The next release will ship as **v0.2.0** (not v0.1.1 — Wave 1 fixes were rolled forward into v0.2.0). Will land when [issue #7](https://github.com/hoainho/ohmyperf/issues/7) clears the npm credential gate. The `publish-stable.yml` workflow auto-generates the categorised changelog from conventional-commit titles in `git log v0.1.0..HEAD`.

Highlights staged for v0.2.0 (see [issue #7](https://github.com/hoainho/ohmyperf/issues/7) for full inventory):

- **Glama MCP directory approval** (claim-enabled): the `@ohmyperf/mcp-server` listing at <https://glama.ai/mcp/servers/hoainho/ohmyperf> is now active. A new `glama.json` at the repo root pins the install command, schema, maintainer (`hoainho`), category (`performance`), and tag set so Glama's auto-fetcher keeps the listing in sync. Claim flow (edit description, configure Docker build, receive review notifications) is unlocked via the **"Login with GitHub to claim"** button on the listing. Main README and `apps/mcp-server/README.md` now include the Glama badge + an "Install from Glama" subsection.
- **Agent fix loop**: new MCP tools `propose_patch` + `verify_fix` (issue #6). The only perf tool where an AI agent can both fix a CWV regression and statistically prove the fix improved metrics, in one conversation turn.
- **LLM-first report signals** (Phase 1-6 of the v0.2.0 session):
  - `Report.trustScore` — overall + per-metric verdict (high|medium|low|unreliable) with `sampleConfidence` + `effectConfidence` decomposition and `recommendedAction` for noisy measurements.
  - `Report.fixPlan` — ranked, deduped, ROI-scored list of actionable patches. Each entry has `applicability: first-party | third-party-cannot-apply | unknown`.
  - `Report.meta.servability` — heuristic classification (real-page | bot-challenge-suspected | error-page | timeout-partial | unknown) so agents skip un-actionable measurements.
  - `Resource.originClass` — same-origin | same-site | same-org | cross-site | unknown. New `MeasureOptions.orgDomains` (+ `OHMYPERF_ORG_DOMAINS` env var) marks org-owned CDNs as first-party.
- **3 new MCP tools** (precomputed slices for LLM agents): `get_fix_plan`, `get_trust_score`, `get_servability`.
- **`@ohmyperf/eslint-plugin`** v0.2.0 — 7 CWV-linked ESLint rules.
- **`@ohmyperf/fixers`** v0.2.0 — Archetype registry + `proposePatches()` engine.
- **Real cross-origin OOPIF inspection** — each cross-origin iframe gets a per-frame CDP session.
- **INP measurable in CI** — `--synthetic-interaction=auto-click` fires a trusted-event pipeline.
- **Source-map detection** — `longestScript.sourceLocation` schema slot (stage 1; full VLQ decode deferred to v0.3, issue #4).
- **8 Wave-1 CLI/MCP/Core fixes** rolled forward — see commit [`415ad60`](https://github.com/hoainho/ohmyperf/commit/415ad60) for the per-fix list.

### Type-level additive-but-breaking-for-constructors changes (v0.2.0)

These are additive for READERS but require updates for code that CONSTRUCTS these types (test fixtures, mock data, downstream JSON producers):

- `OriginClass` union gained `"same-org"` member. Exhaustive `switch` statements over `OriginClass` need a new `case`. In this workspace: no consumers affected.
- `MetricTrustVerdict` gained two required fields `sampleConfidence` + `effectConfidence`. Code that constructs `MetricTrustVerdict` literals (e.g. test mocks) must populate them. The existing `level` field is preserved and still equals `worstLevel(sample, effect)` for backward-compat readers.

## [0.1.0] - 2026-05-19

First public release. **15 `@ohmyperf/*` packages** published to npm.

> **Scope-decision history (informational):** an interim release was briefly published as `@nhonh/*` (v0.1.0 + v0.1.1, ~30 minutes live) because the `@ohmyperf` npm organization had not yet been created. Both `@nhonh/*` versions were unpublished within the 72-hour window per npm policy; `@ohmyperf` is the canonical scope going forward. `@ohmyperf/trace-utils` (the package whose missing publish caused the @nhonh/v0.1.1 patch) ships as a public dependency from v0.1.0 of `@ohmyperf`.

### Added

- **`@ohmyperf/cli`** — CLI binary `ohmyperf` with 8 subcommands (`run`, `diff`, `share`, `doctor`, `init`, `list-plugins`, `list-styles`, `install-browser`). Interactive `@clack/prompts` TUI walk-through when no URL is provided in a TTY. 13 typed exit codes.
- **`@ohmyperf/mcp-server`** — MCP server binary `ohmyperf-mcp` exposing 12 tools + 7 prompts for AI coding agents (Claude in OpenCode, Cursor, GitHub Copilot, Claude Desktop). Reports persisted at `~/.ohmyperf-mcp/reports/` and exposed as `ohmyperf://reports/<id>.json` resources.
- **`@ohmyperf/core`** — Measurement engine, plugin runtime, pre-flight CPU calibration, Mann-Whitney U non-parametric diff with per-metric noise floors. Schema 1.0.0 frozen.
- **`@ohmyperf/driver-playwright`** — Playwright + CDP driver with `Target.setAutoAttach({ flatten: true })` for OOPIF (cross-origin iframe) deep-inspection. ~99% iframe metric coverage.
- **`@ohmyperf/plugins-builtin`** — Built-in plugin set: `cwvPlugin` (LCP/INP/CLS subpart attribution), `axePlugin` (accessibility), `thirdPartiesPlugin` (third-party-web v0.29.2 vendor classification), `customMetricExamplePlugin`.
- **`@ohmyperf/design-tokens`** — OKLCH-based design tokens + 4 brand systems: `calibre` (default), `linear-app` (dark canvas), `stripe` (light, multi-layer shadows), `vercel` (4-layer shadow + border:none). WCAG-AA contrast gate enforced via `scripts/check-contrast.mjs` in CI.
- **`@ohmyperf/viewer`** — Self-contained single-file HTML viewer. Zero CDN, zero external network requests. Embeds report JSON as `<script type="application/json">`, parsed into `window.__OHMYPERF_REPORT__`.
- **`@ohmyperf/reporter-{json,html,deck,markdown,junit,csv}`** — 6 reporters: canonical JSON (schema source of truth), self-contained HTML, multi-slide deck (⌘P → PDF first-class), PR-comment-friendly Markdown, JUnit XML (one `<testcase>` per budget threshold), long-format CSV.
- **`@ohmyperf/share-client`** — Upload + fetch shareable reports with env-secret redaction before upload. Throws `ShareSecretLeakError` listing leaked env key names if any secret values appear in URLs/headers/query.

### Measurement features

- Real-machine, real Chromium (not synthetic cloud, not Lighthouse's simulated lantern model).
- `Target.setAutoAttach({ flatten: true })` OOPIF auto-attach → per-frame `FrameTree` with `isOOPIF`, `isCrossOrigin`, `isSrcdoc`, `isFenced`, `detachedAt`.
- Pre-flight CPU calibration benchmark (200k Math.sin/cos in browser) normalized to mid-range-2024-laptop reference (250 ms). Cached 24h by machine fingerprint.
- Network: Fast 4G profile (12 Mbps DL / 5 Mbps UL / 70 ms RTT) for `--mode=ci-stable`.
- Mann-Whitney U significance test with per-metric noise floors (TTFB/INP 10%, LCP/FCP/CLS 5%).
- N runs default 5, configurable up to 30.
- LCP/INP/CLS subpart attribution: `MetricAttribution` includes `element`, `url`, `longestScript.{url, invoker, subpart}`, layout-shift `previousRect`/`currentRect`.
- Long-task collection via `PerformanceObserver` + trace-event attribution via vendored `tracium`.

### MCP differentiators (vs `chrome-devtools-mcp`)

- **`track_url`** — longitudinal monitoring with NDJSON time-series at `~/.ohmyperf-mcp/timeseries/<sha256-url>.ndjson` + OLS slope + windowed median trend (improving/stable/regressing + confidence).
- **`find_regression_cause`** — ranked causal-attribution hypotheses (grown resources, new long-tasks, new third-party vendors).
- **`enforce_budget`** — contract-as-code with structured PASS/FAIL + exit-code-style verdict. Defaults: lcp ≤ 2500ms, inp ≤ 200ms, cls ≤ 0.1, tbt ≤ 200ms.

### CI / release infrastructure

- 5 GitHub Actions workflows: `ci.yml` (multi-OS matrix: macOS 13/15, Ubuntu 22.04/24.04, Windows 2022; Node 22.x + 24.x), `dogfood.yml` (weekly self-measurement on perf changes), `website-budgets.yml` (bundle budget gate), `publish-beta.yml` (push to `beta` branch → `@ohmyperf/*@beta`), `publish-stable.yml` (manual workflow_dispatch with conventional-commit semver detection → `@ohmyperf/*@latest`).
- `pnpm@10.33.3` + Turbo monorepo. Apache-2.0 license + NOTICE in every published package.

### Acknowledgments

OhMyPerf integrates and acknowledges:
- [Playwright](https://playwright.dev/) (Apache-2.0)
- [web-vitals](https://github.com/GoogleChrome/web-vitals) (Apache-2.0)
- [third-party-web](https://github.com/patrickhulce/third-party-web) (Apache-2.0)
- [tracium](https://github.com/aslushnikov/tracium) (vendored, Apache-2.0)
- [axe-core](https://github.com/dequelabs/axe-core) (MPL-2.0)
- [Open Design Library](https://github.com/nexu-io/open-design) (Apache-2.0) — linear-app, stripe, vercel brand tokens
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk) (MIT)

See [NOTICE](./NOTICE) for full attribution.

[Unreleased]: https://github.com/hoainho/ohmyperf/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hoainho/ohmyperf/releases/tag/v0.1.0
