# HN Show post draft — for anh to post when ready

**Posting account**: anh's personal HN account (which has accumulated karma — required for Show HN). New accounts get filtered.

**Best time**: Tuesday-Thursday, 9am-11am Pacific (best traction window per HN data). Avoid Friday afternoon and weekends.

**Title** (HN limit: 80 chars):

```
Show HN: OhMyPerf – LLM agents can fix your site's CWV and prove it worked
```

Alternatives (rank A/B):
- `Show HN: First perf tool an LLM agent can actually fix your site with`
- `Show HN: OhMyPerf – Core Web Vitals with a closed agent fix loop`
- `Show HN: Real-Chromium CWV + LLM agent fix loop with statistical proof`

## Post body

```
We built OhMyPerf because every Lighthouse / PageSpeed alternative still leaves the agent loop open: the LLM can read a perf report, but it can't propose a patch AND prove the patch improved metrics.

OhMyPerf closes that loop with three MCP tools:

  measure → propose_patch → verify_fix
     ↓           ↓               ↓
  real CWV    ranked,         Mann-Whitney
  on real     applicability-   U at α=0.05
  Chromium    aware fixPlan    per metric

verify_fix actually runs the candidate URL N times, runs a Mann-Whitney U significance test against the baseline, and returns a structured verdict (improvement | neutral | regression) per metric with p-values. Default runs=5 because that's the minimum n for significance at α=0.05 — below that, even perfect separation will correctly report neutral.

A few non-obvious things we shipped:

1. Cross-origin OOPIF inspection at ~99% coverage. Lighthouse goes opaque the moment a third-party iframe loads; OhMyPerf opens a per-frame CDPSession via context.newCDPSession(frame). We tested it on mdnplay.dev, example.org, openstreetmap.org and verified all the metrics emit.

2. LLM-first report signals. Every report has Report.trustScore (with sampleConfidence + effectConfidence split so agents know whether a measurement is underpowered or noisy), Report.fixPlan (ranked, deduped, ROI-scored), Report.meta.servability (detects Cloudflare bot challenges vs real pages — agents skip the former), Resource.originClass (same-origin | same-site | same-org | cross-site). No more parsing 8 nested fields to know if a measurement is trustworthy.

3. INP measurable in CI. The web-vitals attribution INP observer needs a real user interaction to land. We synthesize one via CDP Input.dispatchMouseEvent on an auto-detected click target — so INP actually shows up in CI, instead of silently being 0 or NaN.

4. Honest about variance. CoV > 20% → trustScore: low → recommendedAction: "rerun --runs 10 or --mode ci-stable". We do not pretend 3-run measurements are precise.

The project is Apache-2.0, runs locally (npx -y @ohmyperf/cli@latest run https://your-site.com), has a hosted MCP server (npm install -g @ohmyperf/mcp-server, point Claude/Cursor/OpenCode at it), an ESLint plugin (@ohmyperf/eslint-plugin) with 7 CWV-linked rules for editor-save-time catching, and a Chrome extension.

Tested against 10 production sites including tradeit.gg (18 first-party fixes identified), Wikipedia (2), GitHub.com (20 once you set OHMYPERF_ORG_DOMAINS for the org-owned CDN tier), Stack Overflow (correctly flagged as bot-challenge-suspected — Cloudflare interstitial, not the real page).

Repo: https://github.com/hoainho/ohmyperf

Happy to answer questions about:
- The Mann-Whitney U integration (why we picked it over t-test; small-sample limits)
- The trustScore decomposition (why split sampleConfidence + effectConfidence)
- The fixers archetype registry (how new patch types get added)
- OOPIF inspection via CDP (why per-frame sessions matter)
- The 17-round skepticism arc that caught 16 real bugs while waiting on a credential refresh

Not the first perf tool, won't be the last. But might be the first one your AI agent can actually use end-to-end.
```

## Pre-post checklist (anh to verify before clicking submit)

- [ ] v0.2.0 published on npm — verify `npm view @ohmyperf/cli version` shows 0.2.0
- [ ] `npx -y @ohmyperf/cli@latest run https://example.com --runs 2` works clean
- [ ] `npx -y @ohmyperf/mcp-server@latest` boots and lists 16 tools (test with `claude mcp list`)
- [ ] README hero matches the post (one-line pitch + comparison table)
- [ ] Issue #7 closed (v0.2.0 release tracker)
- [ ] PR to `punkpeye/awesome-mcp-servers` merged or at least open (em mở PR #6667)
- [ ] Repo description matches the pitch
- [ ] At least 2 reviews/feedback from trusted devs on the README before posting (avoid "this looks like it was written by an LLM" smell)

## After posting

- Reply to EVERY comment within 30 minutes — HN ranking heavily weights early engagement.
- Be honest about limits. If someone asks "does this work on Safari?", the answer is "Chromium only right now" — do not fudge.
- Track stars via: `gh repo view hoainho/ohmyperf --json stargazerCount --jq .stargazerCount`
- If post hits front page → tweet the link with the same hook, tag @web_vitals @leeerob @addyosmani @bartoszm and other perf-community accounts (don't spam — one mention is fine).
- If post does NOT hit front page → wait 2 weeks before retrying. HN penalizes resubmissions in close succession.

## Backup distribution if HN flops

- r/webdev or r/javascript (use the same body, drop the "Show HN" prefix)
- r/programming (more critical audience — emphasize the technical novel parts: OOPIF, Mann-Whitney, MCP)
- dev.to article (anh's account)
- Twitter thread (5-tweet limit): hook → demo GIF → architecture → fix loop → repo link
- LinkedIn (less effective for dev tools but harmless)

## What NOT to do

- Don't post to r/webperformance — it's a small community + posts there get classified as "promotion."
- Don't pay for sponsored posts.
- Don't star-bomb the repo from alt accounts. GitHub detects this and penalizes trending.
- Don't ping influencers in DMs at launch — let the post stand on its own.
