# GitHub Release draft — v0.2.0

**Status**: ready to publish the moment npm publish succeeds. Do NOT publish this release before npm — it would mean install instructions in the release notes 404 for the first cohort of viewers.

## Title

```
ohmyperf v0.2.0 — agent fix loop + LLM-first report signals
```

## Tag

`v0.2.0` (cut from `main` at the commit `publish-stable.yml` produces — the workflow handles tag + release atomically)

## Body

```markdown
> The first perf tool where an AI agent can fix a CWV regression AND statistically prove the fix improved metrics — in one conversation turn.

OhMyPerf 0.2.0 is the **agent fix loop** release. Three new MCP tools close the gap between "measurement" and "shipped patch":

```
measure → propose_patch → verify_fix
   ↓           ↓               ↓
 trust       ranked      Mann-Whitney
 score       fixPlan     U at α=0.05
```

## Install

```bash
# CLI
npm install -g @ohmyperf/cli
ohmyperf run https://your-site.com

# MCP server (Claude, OpenCode, Cursor, Cline)
npm install -g @ohmyperf/mcp-server

# ESLint plugin (new in v0.2.0)
npm install --save-dev @ohmyperf/eslint-plugin @typescript-eslint/parser
```

## Headline features

### Agent fix loop

- **`propose_patch`** — given a report's `fixPlan`, returns ranked patches with `applicability: first-party | third-party-cannot-apply` so agents skip un-fixable third-party URLs.
- **`verify_fix`** — measures candidate URL, runs Mann-Whitney U vs baseline, returns `verdict: improvement | neutral | regression` with p-values per metric. Default `runs=5` (the minimum n for significance at α=0.05).

### LLM-first report signals

| Field | What it answers | Replaces |
|---|---|---|
| `Report.trustScore` | Can I trust this measurement? | Reading `meta.unstable` + `aggregated.X.cov` + `meta.calibration` separately |
| `Report.fixPlan` | Highest-ROI patch I can apply? | Manually ranking 13+ patches by impact × confidence × applicability |
| `Report.meta.servability` | Did I measure the real page or a bot challenge? | Parsing resource counts + bytes + page title manually |
| `Resource.originClass` | First-party or someone else's CDN? | Comparing URLs to registrable domain |

3 new MCP tools expose these as precomputed slices: `get_fix_plan`, `get_trust_score`, `get_servability`.

### Real cross-origin OOPIF inspection

Every cross-origin iframe gets its own CDP session via `context.newCDPSession(frame)` (Playwright #8157). Verified on real-world MDN pages with embedded mdnplay.dev, example.org, openstreetmap.org.

### INP measurable in CI

`--synthetic-interaction=auto-click` fires a CDP `Input.dispatchMouseEvent` trusted-event pipeline so the `web-vitals/attribution` INP observer lands a sample. Honest fallback if no click target found — does NOT silently emit INP=0.

### `@ohmyperf/eslint-plugin` v0.2.0

7 CWV-linked ESLint rules — catch CWV anti-patterns at editor-save time:

- `no-document-write` — blocks main thread
- `no-sync-xhr` — synchronous XHR jank
- `prefer-loading-lazy` — defer offscreen images
- `prefer-fetchpriority` — hint LCP image priority
- `no-render-blocking-script-in-head` — defer scripts
- `no-large-inline-data-url` — bloat critical path
- `no-passive-event-violation` — touch event jank

### `@ohmyperf/fixers` v0.2.0

Archetype registry + `proposePatches()` engine. 4 archetypes covering ~80% of typical opportunities (defer-script, media-print-stylesheet, fetchpriority-image, preload-image).

## Real-world validation

Tested against 10 production sites including high-traffic targets. Highlights:

| Site | LCP | Trust | Servability | First-party fixes |
|---|---|---|---|---|
| tradeit.gg | 1804ms | low | real-page | **18** |
| Wikipedia | 356ms | medium | real-page | 2 |
| GitHub (with `OHMYPERF_ORG_DOMAINS`) | 532ms | low | real-page | 20 |
| Stack Overflow | 349ms | low | **bot-challenge-suspected** | 0 (correctly flagged) |
| vercel.com | 504ms | low | real-page | 35 |

Stack Overflow correctly flagged as `bot-challenge-suspected` — the tool refused to treat a Cloudflare interstitial as a real measurement. This is the kind of honesty MCP-driven agents need from their tools.

## Breaking changes (additive, for constructors only)

These are additive for READERS but require updates for code that CONSTRUCTS these types (test fixtures, mock data, downstream JSON producers):

- `OriginClass` union gained `"same-org"` member. Exhaustive `switch` statements need a new `case`.
- `MetricTrustVerdict` gained two required fields `sampleConfidence` + `effectConfidence`. Test mocks must populate them. The existing `level` field is preserved.

## Stats

- **17 npm packages** (15 existing + new `@ohmyperf/eslint-plugin` + `@ohmyperf/fixers`)
- **387 tests** across 18 workspaces, all green
- **94/94 core tests** (was 41 in v0.1.0 — +53 for new features + QA fixes)
- **3-agent QA pass** caught 14 issues, all addressed
- **17 rounds of self-skepticism** caught real defects each round

## Full changelog

See [CHANGELOG.md](./CHANGELOG.md#020---2026-05-XX) for the categorized log.

## Contributors

@hoainho (sole author this cycle). [Contributions welcome](./CONTRIBUTING.md).

## What's next (v0.3)

- VLQ source-map decode (lift script URLs to repo paths)
- Public share URL (paste-and-share reports)
- Vite/Next.js build plugins
- evidence_bundle JSON pointers
- Cross-browser CWV
```

## Publish recipe

After `gh workflow run publish-stable.yml --field bump=minor -R hoainho/ohmyperf` succeeds and the 17 packages are live:

```bash
# Tag is auto-created by workflow. Just create the release from this body:
gh release create v0.2.0 -R hoainho/ohmyperf \
  --title "ohmyperf v0.2.0 — agent fix loop + LLM-first report signals" \
  --notes-file docs/launch/RELEASE-v0.2.0-DRAFT.md  # (paste the body section only)
```

Or use the workflow's auto-release — `publish-stable.yml` already creates the GitHub release. Use this draft to override the auto-generated body if it's lower quality.
