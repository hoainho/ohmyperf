# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-05-19

### Fixed

- `@nhonh/cli` and `@nhonh/mcp-server` failed to install with `404 @nhonh/trace-utils@0.0.0-pre not in registry` because `@nhonh/core` had a runtime dependency on `@nhonh/trace-utils`, which was inadvertently marked `private: true` in v0.1.0 (and therefore never published). Publish `@nhonh/trace-utils` as a public package and bump all 15 packages to 0.1.1.
- `@nhonh/core@0.1.1` now resolves transitive deps cleanly from npm.

### Verified

- `npx --yes @nhonh/cli@0.1.1 --help` succeeds from clean cache (this was the regression that exposed the trace-utils gap).

## [0.1.0] - 2026-05-19

First public release. 14 `@nhonh/*` packages published to npm.

### Added

- **`@nhonh/cli`** — CLI binary `ohmyperf` with 8 subcommands (`run`, `diff`, `share`, `doctor`, `init`, `list-plugins`, `list-styles`, `install-browser`). Interactive `@clack/prompts` TUI walk-through when no URL is provided in a TTY. 13 typed exit codes.
- **`@nhonh/mcp-server`** — MCP server binary `ohmyperf-mcp` exposing 12 tools + 7 prompts for AI coding agents (Claude in OpenCode, Cursor, GitHub Copilot, Claude Desktop). Reports persisted at `~/.ohmyperf-mcp/reports/` and exposed as `ohmyperf://reports/<id>.json` resources.
- **`@nhonh/core`** — Measurement engine, plugin runtime, pre-flight CPU calibration, Mann-Whitney U non-parametric diff with per-metric noise floors. Schema 1.0.0 frozen.
- **`@nhonh/driver-playwright`** — Playwright + CDP driver with `Target.setAutoAttach({ flatten: true })` for OOPIF (cross-origin iframe) deep-inspection. ~99% iframe metric coverage.
- **`@nhonh/plugins-builtin`** — Built-in plugin set: `cwvPlugin` (LCP/INP/CLS subpart attribution), `axePlugin` (accessibility), `thirdPartiesPlugin` (third-party-web v0.29.2 vendor classification), `customMetricExamplePlugin`.
- **`@nhonh/design-tokens`** — OKLCH-based design tokens + 4 brand systems: `calibre` (default), `linear-app` (dark canvas), `stripe` (light, multi-layer shadows), `vercel` (4-layer shadow + border:none). WCAG-AA contrast gate enforced via `scripts/check-contrast.mjs` in CI.
- **`@nhonh/viewer`** — Self-contained single-file HTML viewer. Zero CDN, zero external network requests. Embeds report JSON as `<script type="application/json">`, parsed into `window.__OHMYPERF_REPORT__`.
- **`@nhonh/reporter-{json,html,deck,markdown,junit,csv}`** — 6 reporters: canonical JSON (schema source of truth), self-contained HTML, multi-slide deck (⌘P → PDF first-class), PR-comment-friendly Markdown, JUnit XML (one `<testcase>` per budget threshold), long-format CSV.
- **`@nhonh/share-client`** — Upload + fetch shareable reports with env-secret redaction before upload. Throws `ShareSecretLeakError` listing leaked env key names if any secret values appear in URLs/headers/query.

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

- 5 GitHub Actions workflows: `ci.yml` (multi-OS matrix: macOS 13/15, Ubuntu 22.04/24.04, Windows 2022; Node 22.x + 24.x), `dogfood.yml` (weekly self-measurement on perf changes), `website-budgets.yml` (bundle budget gate), `publish-beta.yml` (push to `beta` branch → `@nhonh/*@beta`), `publish-stable.yml` (manual workflow_dispatch with conventional-commit semver detection → `@nhonh/*@latest`).
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
