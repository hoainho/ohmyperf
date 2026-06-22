# OhMyPerf — Full-Flow Test Report

**Date:** 2026-06-21 · **Version under test:** v0.1.1 · **Platform:** macOS (darwin arm64), Node v26, pnpm 10.33.3

This report documents end-to-end verification of **every** OhMyPerf subsystem/flow. Coverage is explicit: each flow is marked **tested-passing**, **failing**, or **not-covered**, with no silent omissions.

---

## 1. Headline results

| Gate | Result |
|---|---|
| Full automated test suite (`turbo run test --continue`) | ✅ **39/39 tasks, ~423 unit tests, 0 failures** |
| Full monorepo build (`turbo run build`) | ✅ **28/28 tasks** (after platform repair, see §6) |
| CLI commands (8) | ✅ **8/8 run successfully** |
| MCP server core tools | ✅ **8/8 exercised live & verified** |
| CLI reporter formats (6) | ✅ **6/6 produce artifacts** |

> One real defect was found **and fixed** during this session (extension-chrome vitest collected a Playwright spec — see §2). After the fix the suite is fully green.

---

## 2. Automated test suite — per package

Command: `npx turbo run test --continue --force`. Using `--continue` is essential — without it turbo aborts on the first failure and reports *false* failures for in-flight tasks.

### ✅ Passing (with unit tests)

| Package | Test files | Tests |
|---|---:|---:|
| `@ohmyperf/core` | 6 | 94 |
| `@ohmyperf/viewer` | 8 | 98 |
| `@ohmyperf/reporter-deck` | 3 | 59 |
| `@ohmyperf/design-tokens` | 3 | 38 |
| `@ohmyperf/cli` | 1 | 10 |
| `@ohmyperf/share-server` | 1 | 10 |
| `@ohmyperf/fixers` | 1 | 9 |
| `@ohmyperf/reporter-markdown` | 1 | 8 |
| `@ohmyperf/eslint-plugin` | 1 | 7 |
| `@ohmyperf/driver-extension` | 1 | 6 |
| `@ohmyperf/mcp-server` | 3 | ✓ |
| `@ohmyperf/runner` | 2 | ✓ |
| `@ohmyperf/driver-playwright` | 1 | ✓ |
| `@ohmyperf/tests-oopif-corpus` | 4 | ✓ |
| `ohmyperf-vscode` (ide) | 1 | 2 |
| `@ohmyperf/extension-chrome` | 1 passed / 1 skipped (files) | 1 passed / 4 skipped (after fix) |

### ⚠️ No automated unit tests (gap — flow still exercised manually where applicable)

- **`passWithNoTests` / no test files:** `shared-types`, `share-client`, `reporter-json`, `reporter-html`, `plugins-builtin`, `website` (website has e2e/a11y/smoke scripts instead, not unit).
- **No `test` script at all:** `reporter-csv`, `reporter-har`, `reporter-junit`, `reporter-lh-compat`, `trace-utils`.

> `reporter-csv`/`reporter-junit` are nonetheless exercised functionally via the CLI (§4). `reporter-har`/`reporter-trace`/`reporter-lh-compat` are library-only and **not** reachable from the CLI (§4 gap).

### 🐞 Defect found & fixed this session

- **`@ohmyperf/extension-chrome`** — vitest had **no config**, so its default glob collected `tests/playwright-e2e/extension-load.spec.ts` (a `@playwright/test` spec), throwing `Playwright Test did not expect test.beforeAll() to be called here`.
- **Fix:** added `apps/extension-chrome/vitest.config.ts` scoping `include` to `*.test.ts` and excluding `tests/playwright-e2e/**` (owned by `playwright.config.ts`, `testDir: ./tests/playwright-e2e`). Mirrors the convention in `apps/website/vitest.config.ts` and `apps/runner/vitest.config.ts`.
- **Result:** `extension-chrome` test → Test Files `1 passed | 1 skipped`, Tests `1 passed | 4 skipped`, exit 0; full suite → 39/39.

---

## 3. CLI flows — `apps/cli` (8 commands)

| Command | Result | Notes |
|---|---|---|
| `run <url>` | ✅ exit 0 | Default `--format json,html,deck`; emits JSON status line. Verified producing json+html+md (with `--format markdown`) and all 6 formats together |
| `diff <a> <b>` | ✅ exit 0 | Mann-Whitney U; human table + `--json`; "no regressions" verdict |
| `doctor` | ✅ exit 0 | Node/OS/browser/plugin diagnostics; status OK |
| `init --ci github\|gitlab\|circle` | ✅ exit 0 | All 3 providers scaffold correctly |
| `list-plugins` | ✅ exit 0 | 3 built-in plugins (cwv, axe, example) + `--json` |
| `list-styles` | ✅ exit 0 | 4 brands (calibre, linear-app, stripe, vercel) + `--json` |
| `install-browser` | ✅ exit 0 | Resolves bundled Playwright Chromium cleanly |
| `share <file>` | ✅ exit 2 (graceful) | Non-zero on unreachable endpoint **by design**; prints self-host guidance. `https://ohmyperf.dev` is not deployed yet (gap, §7) |

---

## 4. Reporters, viewer & web build flows

### CLI `--format` (all produce artifacts from a live `run`)

| Format | File | Status |
|---|---|---|
| json | `report.json` (12.7 KB) | ✅ |
| html | `report.html` (53 KB, self-contained) | ✅ |
| deck | `report-deck.html` (45 KB) | ✅ |
| markdown | `report.md` (1.3 KB) | ✅ |
| junit | `report.junit.xml` | ✅ |
| csv | `report.csv` | ✅ |

### Library-only reporters (gap)

`reporter-har`, `reporter-trace`, `reporter-lh-compat` exist as packages but are **not wired into the CLI `--format` enum** (json,html,deck,markdown,junit,csv). Not exercisable from the CLI; v2 should either expose or document them.

### Build flows

- `viewer` + `website` build: ✅ part of the green **28/28** monorepo build.

---

## 5. MCP server flows — `apps/mcp-server`

The live MCP server (`mcp__ohmyperf__*`) is connected. 8 core tools exercised against a real report and a baseline/candidate pair:

| Tool | Result |
|---|---|
| `list_styles` | ✅ 4 brands + manifest JSON |
| `list_runs` | ✅ (0 reports in server's own dir — works, empty) |
| `analyze_report` (audits) | ✅ returns audit slice |
| `generate_markdown_summary` | ✅ full CWV markdown |
| `get_trust_score` | ✅ correctly flags n=1 → **unreliable** |
| `get_servability` | ✅ correctly flags tiny page → **bot-challenge-suspected** |
| `diff` | ✅ Mann-Whitney per-metric, `hasRegressions:false` |
| `generate_html_report` | ✅ wrote 53 KB viewer (style=linear-app) |

**Remaining 9 tools** (`measure`, `generate_deck`, `diff_resources`, `enforce_budget`, `find_regression_cause`, `get_fix_plan`, `propose_patch`, `verify_fix`, `track_url`): schema-verified and available. `measure` shares the same engine exercised via CLI `run`. `propose_patch`/`verify_fix`/`get_fix_plan` require an LLM-fix context and a target codebase; `find_regression_cause`/`diff_resources` require two resource-rich reports. Documented as available, not exercised in this pass.

---

## 6. Systemic environment defect (found & fixed)

`node_modules` contained **Linux** native binaries (`@rollup/rollup-linux-arm64-gnu`, `@esbuild/linux-arm64`) on a **darwin arm64** host — a node_modules tree installed for the wrong platform. This silently broke:

- `vitest` (rollup native) → all vitest suites failed to start
- `ide-vscode` build (esbuild), plus rollup-based package builds

**Fix:** `CI=true pnpm install` purged and recreated `node_modules` with correct `@rollup/rollup-darwin-arm64` + `@esbuild/darwin-arm64`. `pnpm-lock.yaml` unchanged. Post-fix: build 28/28, tests 39/39.

---

## 7. Coverage summary & gap list

**Overall: all user-facing flows pass.** Subsystem coverage:

| Subsystem | Status |
|---|---|
| CLI (8 cmds) | ✅ tested-passing |
| MCP server (core) | ✅ tested-passing |
| Reporters (json/html/deck/md/junit/csv) | ✅ tested-passing |
| core engine / drivers / plugins | ✅ unit + integration passing |
| viewer / website / ide-vscode / runner / extension | ✅ build + tests passing |
| share-server / share-client | ✅ server tested; client no unit tests |

**Explicit gaps (feed into v2 plan):**
1. No unit tests: `reporter-csv`, `reporter-har`, `reporter-junit`, `reporter-lh-compat`, `trace-utils`, `share-client`, `plugins-builtin`, `reporter-json`, `reporter-html`.
2. `reporter-har`/`reporter-trace`/`reporter-lh-compat` not reachable from CLI.
3. Hosted share endpoint `https://ohmyperf.dev` not deployed (share works only self-hosted).
4. `extension-chrome` Playwright E2E requires a running website + fixtures (skipped in unit lane) — no CI E2E gate.
5. No guard against platform-mismatched `node_modules` installs.

---

## 8. Reproduction commands

```bash
# Full suite (use --continue to avoid false failures)
npx turbo run test --continue
# Full build
pnpm -w build
# CLI smoke
node apps/cli/bin/ohmyperf.mjs run https://example.com --runs 1 --allow-single-run \
  --format json,html,deck,markdown,junit,csv --output /tmp/omp-out
```
