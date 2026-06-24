# `@ohmyperf/mcp-server`

[MCP](https://modelcontextprotocol.io/) server for [ohmyperf](https://github.com/hoainho/ohmyperf) — exposes real-machine, real-browser web performance measurement to AI coding agents (Claude in OpenCode, Cursor, GitHub Copilot, etc.) as **17 tools** and **8 prompts**.

[![ohmyperf MCP server](https://glama.ai/mcp/servers/hoainho/ohmyperf/badges/score.svg)](https://glama.ai/mcp/servers/hoainho/ohmyperf)
[![npm](https://img.shields.io/npm/v/@ohmyperf/mcp-server?label=%40ohmyperf%2Fmcp--server&color=cb3837)](https://www.npmjs.com/package/@ohmyperf/mcp-server)
[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Node ≥ 22](https://img.shields.io/badge/node-%E2%89%A522-339933)](https://nodejs.org)

`chrome-devtools-mcp` lets an agent inspect a live browser. `ohmyperf-mcp` lets the agent **measure**, **persist**, **diff**, and **enforce budgets** — capabilities `chrome-devtools-mcp` structurally does not have.

## Install

### From npm (recommended)

```bash
npm install -g @ohmyperf/mcp-server
# or use directly via npx
npx -y @ohmyperf/mcp-server
```

### From Glama (MCP directory)

Listed at <https://glama.ai/mcp/servers/hoainho/ohmyperf> — Glama clients can install with one click; the equivalent stdio command is:

```jsonc
{
  "mcpServers": {
    "ohmyperf": { "command": "npx", "args": ["-y", "@ohmyperf/mcp-server"] }
  }
}
```

The `glama.json` at the repo root pins the install command + maintainer metadata so the Glama listing stays in sync with this README.

Requires Node ≥ 22. Playwright Chromium is downloaded on first measurement (~150 MB).

## Wire into your AI agent

### OpenCode (`~/.config/opencode/opencode.json`)

```jsonc
{
  "mcp": {
    "ohmyperf": {
      "command": "npx",
      "args": ["-y", "@ohmyperf/mcp-server"]
    }
  }
}
```

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```jsonc
{
  "mcpServers": {
    "ohmyperf": {
      "command": "npx",
      "args": ["-y", "@ohmyperf/mcp-server"]
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```jsonc
{
  "mcpServers": {
    "ohmyperf": { "command": "npx", "args": ["-y", "@ohmyperf/mcp-server"] }
  }
}
```

## What the agent gets

### 17 MCP tools

| Tool | Purpose |
|---|---|
| `measure` | Measure a URL with Playwright + CDP. Returns full Report JSON (CWV, audits, frame tree, resources, `perfSummary`). `collectTrace=true` adds long-task / render-blocking attribution. Passive console + error CDP collectors run by default. |
| `track_url` | **Longitudinal monitoring (ohmyperf-only)**. Measure + append to local NDJSON time series; returns trend verdict per metric. |
| `find_regression_cause` | **Causal attribution (ohmyperf-only)**. Compares two reports, returns ranked hypotheses (new render-blocking, grown assets, new long-tasks, new third-parties). |
| `diff` | Mann-Whitney U significance test between two `report.json` files. |
| `diff_resources` | Same as `diff` but accepts `ohmyperf://reports/<file>.json` URIs. |
| `enforce_budget` | **Contract-as-code (ohmyperf-only)**. Measure + evaluate against budget JSON; trust-gated (exit codes 0 / 12 / 13, where 13 = gated by low trust score). |
| `analyze_report` | Drill into one of 15 insight slices from a saved report (lcp-breakdown / render-blocking / long-tasks / third-parties / opportunities / audits / resources / frames / full-load-breakdown / hotspots / remediation / perf-summary / network / javascript / errors) without dumping 50 KB JSON. |
| `list_runs` | List saved reports in `~/.ohmyperf-mcp/reports/`. |
| `list_styles` | List the 4 brand styles (calibre / linear-app / stripe / vercel) with manifest metadata. |
| `generate_html_report` | Render a saved report as a single-file HTML viewer. Writes to disk + returns path (avoids overflowing MCP response budgets). |
| `generate_deck` | Render a saved report as a multi-slide HTML presentation. |
| `generate_markdown_summary` | ~2 KB PR-comment-friendly Markdown of a saved report. |
| `propose_patch` | **Closed fix loop — step 1**. Returns structured `{ archetype, url, search, replace, rationale, expectedImpactMs, confidence }[]` patches an agent can apply directly. Trust-gated. |
| `verify_fix` | **Closed fix loop — step 2**. Re-measures a candidate URL + Mann-Whitney U diff vs baseline; verdict `✅ no regression` / `❌ REGRESSION DETECTED`. Trust-gated. |
| `get_fix_plan` | Precomputed ranked, ROI-scored `fixPlan` slice — saves the agent parsing the full 50 KB+ report. |
| `get_trust_score` | `trustScore.overall` + per-metric verdicts + `recommendedAction` so agents skip noisy measurements before acting. |
| `get_servability` | `meta.servability` classification — `real-page` / `bot-challenge-suspected` / `error-page` / `timeout-partial` / `unknown` — so agents don't gate CI on a Cloudflare interstitial. |

### 8 MCP prompts

`diagnose_report`, `compare_runs`, `suggest_fixes`, `audit_third_parties`, `check_budget`, `investigate_regression`, `monitor_trend`, `measure_and_diagnose` — guided multi-tool flows for diagnosis, regression investigation, longitudinal monitoring, and one-shot measure + triage.

## Storage

Reports are persisted at `~/.ohmyperf-mcp/reports/<measurementId>.json` (each call to `measure` writes one). They are also exposed as MCP resources via `ohmyperf://reports/<file>.json` so `ListResources` can browse them.

Time-series points (from `track_url`) live at `~/.ohmyperf-mcp/timeseries/<sha256-of-url>.ndjson` — append-only, one JSON object per line.

## Why ohmyperf MCP and not chrome-devtools-mcp?

| Capability | chrome-devtools-mcp | ohmyperf-mcp |
|---|---|---|
| Live browser inspection | ✓ | — |
| Persistent reports as MCP resources | — | ✓ |
| Time-series tracking + trend detection | — | ✓ |
| Causal regression attribution | — | ✓ |
| Budget enforcement as exit-code primitive | — | ✓ |
| Mann-Whitney U statistical diff | — | ✓ |
| OOPIF (cross-origin iframe) coverage | partial | ✓ ~99% |
| Self-contained HTML/deck artifact | — | ✓ |
| Brand-aware reporting (calibre/linear/stripe/vercel) | — | ✓ |

The two MCP servers are complementary — run both for the strongest agent loop.

## Verify locally

```bash
npx -y @ohmyperf/mcp-server <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}'
```

You should see a JSON-RPC initialize response on stdout.

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Links

- GitHub: <https://github.com/hoainho/ohmyperf>
- CLI: [`@ohmyperf/cli`](https://www.npmjs.com/package/@ohmyperf/cli)
- Docs: <https://github.com/hoainho/ohmyperf#readme>
- Glama MCP directory: <https://glama.ai/mcp/servers/hoainho/ohmyperf>
