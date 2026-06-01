# README hero rewrite — drop-in replacement

Replace lines 1–60 of the current `README.md` with this. Everything below
the "Why this exists" section stays untouched.

---

<!-- ==== BEGIN HERO ==== -->

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/logo-dark.svg">
    <img alt="OhMyPerf" src="./docs/assets/logo-light.svg" height="80">
  </picture>
</h1>

<p align="center">
  <b>The first web-perf tool an AI agent can actually fix your site with.</b><br>
  Real machine. Real Chromium. Statistical proof of improvement.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ohmyperf/cli"><img alt="npm" src="https://img.shields.io/npm/v/@ohmyperf/cli?label=%40ohmyperf%2Fcli&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/@ohmyperf/cli"><img alt="downloads" src="https://img.shields.io/npm/dw/@ohmyperf/cli?color=cb3837"></a>
  <a href="https://modelcontextprotocol.io"><img alt="MCP compatible" src="https://img.shields.io/badge/MCP-compatible-7c3aed"></a>
  <a href="https://github.com/hoainho/ohmyperf/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/hoainho/ohmyperf/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="https://github.com/hoainho/ohmyperf/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/hoainho/ohmyperf?style=social"></a>
</p>

<p align="center">
  <a href="https://hoainho.github.io/ohmyperf/viewer/"><b>🌐 Live viewer</b></a> ·
  <a href="#-install-in-10-seconds"><b>Install</b></a> ·
  <a href="#-use-it-from-claude--cursor--cline"><b>Use from Claude</b></a> ·
  <a href="./ROADMAP.md"><b>Roadmap</b></a> ·
  <a href="./CONTRIBUTING.md"><b>Contribute</b></a>
</p>

<p align="center">
  <!-- TODO_GIF: replace with a 45-sec terminal cast recorded with charmbracelet/vhs -->
  <img src="./docs/assets/demo.gif" alt="OhMyPerf CLI demo" width="720">
</p>

---

## ⚡ What this is

Lighthouse measures your site on Google's CPU. PSI gives you one flaky number.
Neither lets an AI agent actually **fix** your perf problems and prove the fix
worked.

**OhMyPerf does.** Three things, all open-source, all today:

1. **Measures Core Web Vitals on YOUR hardware**, with a real bundled Chromium,
   and reaches into cross-origin iframes via per-frame CDP sessions (~99%
   coverage where Lighthouse sees only network).
2. **Exposes an MCP server** so Claude, Cursor, Cline, and OpenCode can call
   `measure → propose_patch → verify_fix` in one conversation turn.
3. **Proves the fix actually worked** with a Mann-Whitney U test (α=0.05) per
   metric — not "looks better to me, maybe?"

```
┌──────────┐    ┌───────────────┐    ┌──────────────┐
│ measure  │ →  │ propose_patch │ →  │  verify_fix  │
│ real CWV │    │ ranked, ROI   │    │  p-value per │
│ + trust  │    │ first-party   │    │   metric     │
└──────────┘    └───────────────┘    └──────────────┘
     ↓                  ↓                    ↓
 trustScore         fixPlan             verdict:
 servability       (deduped,           improvement |
 originClass        ROI-scored)         neutral |
                                        regression
```

## 🚀 Install in 10 seconds

```bash
# Zero install — try it now
npx -y @ohmyperf/cli@latest run https://your-site.com

# Or install globally
npm install -g @ohmyperf/cli
ohmyperf run https://your-site.com
```

Requires Node ≥ 22. Playwright Chromium auto-downloads on first run (~150 MB).

## 🤖 Use it from Claude / Cursor / Cline

Add to your MCP client config. Claude Desktop example:

```json
{
  "mcpServers": {
    "ohmyperf": {
      "command": "npx",
      "args": ["-y", "@ohmyperf/mcp-server@latest"]
    }
  }
}
```

Your LLM now has 16 tools available:

| Tool | What it does |
|---|---|
| `measure` | Run N measurement passes on a URL, return full report |
| `propose_patch` | Get ranked, deduped, ROI-scored patches the agent can apply |
| `verify_fix` | Measure again after applying — return p-value per metric |
| `get_fix_plan` | The pre-computed top-N fixes for a given report |
| `get_trust_score` | Per-metric coefficient of variation vs noise floor |
| `get_servability` | Detect bot-challenges, error pages, timeouts |
| `diff` | Compare any two reports with Mann-Whitney U |
| `list_reports` | Browse local measurement history |

Tested with **Claude**, **OpenCode**, **Cursor**, **Cline**.

## 📊 30-second CLI demo

Real output, no editing:

```bash
$ npx -y @ohmyperf/cli@latest run https://example.com --runs 2 --format json
[ohmyperf] INFO OhMyPerf v1.0.0 report
[ohmyperf] INFO url:     https://example.com
[ohmyperf] INFO browser: chromium 148.0.7778.0 (bundled)
[ohmyperf] INFO mode:    real; runs=2; duration=2430ms
[ohmyperf] INFO aggregated:
[ohmyperf] INFO   lcp        median=  256.0  cov=25.0%  n=2
[ohmyperf] INFO   cls        median=  0.000  cov= 0.0%  n=2
[ohmyperf] INFO   fcp        median=  256.0  cov=25.0%  n=2
[ohmyperf] INFO   ttfb       median=  224.5  cov=25.5%  n=2
[ohmyperf] INFO   tbt        median=    0.0  cov= 0.0%  n=2
[ohmyperf] INFO wrote /path/to/ohmyperf-out/report.json
```

The full `report.json` is what LLM agents see — including:

- `report.trustScore` — overall + per-metric `{level, sampleConfidence, effectConfidence, recommendedAction}`
- `report.fixPlan` — ranked, deduped, ROI-scored patches with `applicability: first-party | third-party-cannot-apply`
- `report.meta.servability` — `real-page | bot-challenge-suspected | error-page | timeout-partial | unknown`
- Every `Resource` tagged with `originClass: same-origin | same-site | same-org | cross-site`

CoV 25% on 2 runs → `trustScore: low` → agent gets told `"rerun with --runs 10
or --mode ci-stable before drawing budget conclusions"`. Honest about its own
variance, not vibes.

## 🆚 vs. Lighthouse / PSI

|  | Lighthouse / PSI | OhMyPerf |
|---|---|---|
| **Runs on** | Synthetic CPU in a Google datacenter | Your actual hardware |
| **Cross-origin iframes** | Network-only (opaque inside) | Per-frame CDPSession (~99% coverage) |
| **Agent-callable** | None | MCP server, 16 tools |
| **Statistical proof of fix** | Threshold gates (flake-prone) | Mann-Whitney U, α=0.05, per-metric noise floors |
| **First-party vs CDN** | Manual eyeballing | `originClass` + `same-org` tier |
| **Bot challenge detection** | Treats Cloudflare interstitials as real | `servability: bot-challenge-suspected` |
| **Honest about variance** | One number, take it | `trustScore` + CoV + `recommendedAction` |

<!-- ==== END HERO ==== -->

---

## How to apply

1. Copy this file's content (between `BEGIN HERO` and `END HERO`) into the
   top of `README.md`.
2. Drop your demo GIF at `./docs/assets/demo.gif` (use [charmbracelet/vhs](https://github.com/charmbracelet/vhs)
   to record a 45-sec terminal cast).
3. Drop a 256x256 SVG logo at `./docs/assets/logo-light.svg` and `logo-dark.svg`.
   If you don't have one yet, comment out the `<picture>` block and use the
   text title until you do.
4. Keep everything below "Why this exists" in your existing README.

Result: same content, MCP angle is now in the first 15 lines (where it
belongs as the differentiator), badges show downloads + stars (social proof),
GIF gives visitors a 5-second answer to "what is this?".
