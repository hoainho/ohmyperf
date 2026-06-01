# Good First Issues — Draft Backlog

15 issues to open in `hoainho/ohmyperf` to seed contributor onboarding.
Copy each block into a new issue. Apply labels: `good-first-issue`, the
matching `area/*`, the matching `type/*`, `priority/medium`, `status/accepted`.

---

## 1. Add `--quiet` flag to CLI to suppress INFO logs

**Labels:** `good-first-issue` `area/cli` `type/enhancement` `priority/low`

**Context.** Today `ohmyperf run <url>` always prints INFO lines. Users running
in CI sometimes want machine-only output (JSON to stdout, nothing else).

**Acceptance criteria.**
- New `--quiet` / `-q` flag on `apps/cli`.
- When set, suppresses all `[ohmyperf] INFO …` lines. WARN and ERROR still print to stderr.
- `--quiet --format json` writes pure JSON to stdout, parseable with `jq`.
- Test added in `apps/cli/tests/` that asserts no INFO output with `--quiet`.

**Hints.**
- The logger lives in `apps/cli/src/logger.ts` (search for `INFO`).
- argv parsing is `apps/cli/src/cli.ts`.

**Difficulty:** ★☆☆☆☆ (≈ 1h)

---

## 2. Print human-readable duration in `report.meta`

**Labels:** `good-first-issue` `area/reporter` `type/enhancement` `priority/low`

**Context.** `report.meta.duration` is in ms (e.g., `2430`). The markdown
reporter renders it as `2430ms`, but for 5+ minute runs `2:43.21` is clearer.

**Acceptance criteria.**
- New helper `formatDuration(ms: number): string` in `packages/reporter-markdown`.
- Returns `Xms` if < 1000, `X.YYs` if < 60000, `M:SS.ss` if ≥ 60000.
- Markdown reporter uses it for the duration field.
- Unit tests covering all three ranges.

**Hints.**
- The reporter entry point is `packages/reporter-markdown/src/index.ts`.

**Difficulty:** ★☆☆☆☆ (≈ 1h)

---

## 3. Add Node 24 to CI matrix

**Labels:** `good-first-issue` `area/ci` `type/chore` `priority/medium`

**Context.** `package.json` says `engines.node: >=22`. CI tests Node 22 only.
Node 24 is out; we should test against it before users hit issues.

**Acceptance criteria.**
- `.github/workflows/ci.yml` matrix includes Node 24 alongside 22.
- All jobs pass on Node 24 (or this issue documents which fail and why).

**Hints.**
- The matrix lives near the top of `.github/workflows/ci.yml`.

**Difficulty:** ★☆☆☆☆ (≈ 30min)

---

## 4. Document the MCP `list_reports` tool in README

**Labels:** `good-first-issue` `area/docs` `area/mcp` `type/docs` `priority/medium`

**Context.** The README lists `measure`, `propose_patch`, `verify_fix`,
`get_fix_plan`, `get_trust_score`, `get_servability`, `diff`, `list_reports`
plus "and more", but doesn't show what args `list_reports` takes or what it
returns. Add a section with one example.

**Acceptance criteria.**
- New subsection under "Use it from an AI agent" titled "Available MCP tools".
- Show 3 tools (`measure`, `verify_fix`, `list_reports`) with their JSON-schema
  args and one example response.
- Link to `apps/mcp-server/src/tools/` for the full list.

**Hints.**
- Tool definitions are in `apps/mcp-server/src/tools/*.ts`.

**Difficulty:** ★☆☆☆☆ (≈ 1h)

---

## 5. Detect missing Chromium and print install hint

**Labels:** `good-first-issue` `area/cli` `type/enhancement` `priority/medium`

**Context.** On first run, Playwright auto-downloads Chromium. If the user is
behind a corporate proxy and the download fails, our error message is a raw
stack trace. We should detect the missing-browser case and print:
`Chromium is not installed. Run: npx playwright install chromium`.

**Acceptance criteria.**
- When the engine throws because no Chromium binary is found, the CLI catches
  the specific error and prints a single-line hint to stderr.
- Exit code 13 (new, document in `apps/cli/src/exit-codes.ts`).
- Test using a mocked browser-not-found error.

**Hints.**
- Look at how `driver-playwright` resolves the binary path.
- Existing exit codes are in `apps/cli/src/exit-codes.ts`.

**Difficulty:** ★★☆☆☆ (≈ 2h)

---

## 6. Add `--config <path>` flag to CLI

**Labels:** `good-first-issue` `area/cli` `type/feature` `priority/medium`

**Context.** Users want to commit a `ohmyperf.config.json` in their repo (URL,
runs, plugins, budgets). Today flags must be passed every time.

**Acceptance criteria.**
- New `--config <path>` flag; defaults to `ohmyperf.config.json` in cwd if exists.
- Config keys: `url`, `runs`, `mode`, `plugins[]`, `format`, `out`.
- CLI flags override config values.
- JSON schema published at `apps/cli/schemas/config.schema.json`.
- Test with a fixture config file.

**Hints.**
- Use the existing argv parser; merge config → flag → default.

**Difficulty:** ★★☆☆☆ (≈ 3h)

---

## 7. ESLint plugin: detect `<img>` without `width`/`height`

**Labels:** `good-first-issue` `area/eslint` `type/feature` `priority/medium`

**Context.** Layout shifts (CLS) often come from images that don't declare
dimensions. We have other CWV-linked ESLint rules; this one's missing.

**Acceptance criteria.**
- New rule `cls/img-missing-dimensions` in `packages/eslint-plugin`.
- Flags `<img>` and `<Image>` JSX without both `width` and `height` props.
- Allows `style={{ aspectRatio: ... }}` as a valid escape hatch.
- Tests in `packages/eslint-plugin/tests/` covering 6 cases.
- Documented in the plugin README.

**Hints.**
- Existing rules in `packages/eslint-plugin/src/rules/` are a template.

**Difficulty:** ★★☆☆☆ (≈ 3h)

---

## 8. Add `--include-resources` / `--exclude-resources` glob filters

**Labels:** `good-first-issue` `area/cli` `area/core` `type/feature` `priority/medium`

**Context.** Large sites produce reports with 200+ resources. Sometimes you
want to scope analysis to first-party scripts only, or exclude analytics.

**Acceptance criteria.**
- Two new CLI flags accepting glob patterns (e.g., `--exclude-resources '**/gtag/**'`).
- Filter is applied AFTER measurement, BEFORE report write — measurement
  itself must remain unchanged so totals stay accurate.
- Test with both flags + the existing tradeit.gg fixture.

**Hints.**
- Use `micromatch` or `picomatch` (already in deps).
- Apply at the reporter input, not engine.

**Difficulty:** ★★☆☆☆ (≈ 3h)

---

## 9. Viewer: search bar to filter resources by URL

**Labels:** `good-first-issue` `area/viewer` `type/feature` `priority/medium`

**Context.** When you drop a 200-resource report onto the viewer, scrolling
the resource table is painful. Add a search input.

**Acceptance criteria.**
- Search input above the resource table.
- Filters rows live as the user types (debounced 150ms).
- Matches against `url` and `originClass`.
- Highlights the match in the URL cell.
- Works on both desktop and mobile widths.

**Hints.**
- Viewer is React + Vite at `packages/viewer/src/`.
- Resource table component: `packages/viewer/src/components/ResourceTable.tsx`.

**Difficulty:** ★★☆☆☆ (≈ 3h)

---

## 10. Markdown reporter: render `fixPlan` as a table

**Labels:** `good-first-issue` `area/reporter` `type/enhancement` `priority/medium`

**Context.** `fixPlan` currently renders as an unordered list in markdown.
A table with columns (rank, archetype, target, impact, applicability) is
more skimmable in PR comments.

**Acceptance criteria.**
- Table columns: `#`, `Archetype`, `Target URL`, `Est. Impact (ms)`, `Confidence`, `Applicability`.
- Long URLs truncated to last 60 chars with a leading ellipsis.
- Bottom row footer with totals.
- Test using the existing `report.json` fixture.

**Hints.**
- Reporter at `packages/reporter-markdown/src/sections/fix-plan.ts`.

**Difficulty:** ★★☆☆☆ (≈ 2h)

---

## 11. Add JSON-schema validation for report.json on load (viewer)

**Labels:** `good-first-issue` `area/viewer` `type/enhancement` `priority/medium`

**Context.** Today the viewer crashes silently when a malformed report.json
is dropped onto it. We should validate against the schema and show an inline
error.

**Acceptance criteria.**
- Use `ajv` (or the existing schema validator if one exists in `packages/shared-types`).
- On drop, validate before render. On failure, render a clear error message
  with the first 3 schema violations.
- Test with a fixture that's missing required fields.

**Hints.**
- Schema source-of-truth: `packages/shared-types/src/report.schema.json`.

**Difficulty:** ★★☆☆☆ (≈ 3h)

---

## 12. CLI: `--diff` flag to compare two reports

**Labels:** `good-first-issue` `area/cli` `type/feature` `priority/medium`

**Context.** We have a `diff` MCP tool but no CLI equivalent. Common workflow:
"compare main vs my branch locally". `ohmyperf diff a.json b.json` should
print the same Mann-Whitney U verdict.

**Acceptance criteria.**
- New subcommand `ohmyperf diff <baseline.json> <candidate.json>`.
- Reuses the existing `diff` logic from `packages/core` — don't duplicate it.
- Output: markdown table + exit code 0 if no regressions, 12 if regressed.
- `--format json` for machine output.
- Tests covering pass/fail/neutral.

**Hints.**
- Engine logic in `packages/core/src/diff/`.

**Difficulty:** ★★☆☆☆ (≈ 4h)

---

## 13. Document how to add a custom plugin (with example)

**Labels:** `good-first-issue` `area/docs` `area/core` `type/docs` `priority/medium`

**Context.** Plugin SDK exists but isn't documented. Need a step-by-step:
"build a hello-world plugin that logs each network response, register it,
publish it."

**Acceptance criteria.**
- New `docs/plugin-authoring.md`.
- Covers: minimum plugin interface, lifecycle hooks, how to register, how to
  test, how to publish to npm.
- Working example plugin in `examples/plugin-hello-world/`.
- Linked from README.

**Hints.**
- Plugin runtime: `packages/core/src/plugins/`.
- Existing built-ins: `packages/plugins-builtin/`.

**Difficulty:** ★★★☆☆ (≈ 4h)

---

## 14. Add Windows to CI matrix

**Labels:** `good-first-issue` `area/ci` `type/chore` `priority/medium`

**Context.** CI runs Linux + macOS but not Windows. Windows users have hit
path-handling bugs we'd catch.

**Acceptance criteria.**
- `.github/workflows/ci.yml` matrix includes `windows-latest`.
- All tests pass on Windows, OR this issue documents which ones fail with
  a follow-up issue for each.
- README note: "tested on Linux, macOS, Windows".

**Hints.**
- Watch for path separator + line ending differences.

**Difficulty:** ★★★☆☆ (≈ 4h)

---

## 15. Chrome extension: persist last-measured URL across reloads

**Labels:** `good-first-issue` `area/extension-chrome` `type/enhancement` `priority/low`

**Context.** Today clicking the extension toolbar opens the popup. User types
a URL, clicks Measure. Reloading the popup loses the URL. Persist it.

**Acceptance criteria.**
- Use `chrome.storage.local` to save the URL on every measure.
- On popup mount, prefill the input with the saved value.
- Last 5 URLs in a dropdown for quick re-measure.

**Hints.**
- Popup component: `apps/extension-chrome/src/popup/`.

**Difficulty:** ★★☆☆☆ (≈ 3h)

---

# 5 "help wanted" issues (larger scope)

Apply: `help-wanted`, matching `area/*`, `type/feature`, `priority/medium`,
`mentor-available` if you'll mentor.

## 16. Firefox driver via WebDriver BiDi

Stretch: measure on Firefox to bust the "Chromium-only" criticism.
Owner-level work; mentor commits to 2h/week of review.

## 17. GitHub Action with budget gating

Publish `ohmyperf/ohmyperf-action` to Marketplace. Composite action that
runs `ohmyperf` on a PR, fails the check on regression. Q3 roadmap item.

## 18. CrUX field-data import

`ohmyperf crux <url>` fetches Chrome UX Report data + overlays on lab numbers.
Q4 roadmap item.

## 19. OpenTelemetry tracing for the agent loop

Emit OTLP spans for `measure → propose_patch → verify_fix`. Useful for
debugging long agent sessions.

## 20. Self-hosted share-server reference deploy

Today share-server is Cloudflare Workers. Want a Dockerfile + compose + k8s
manifest for self-hosted teams. Document deploy.
