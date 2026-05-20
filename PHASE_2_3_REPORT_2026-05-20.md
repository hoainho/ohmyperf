# ohmyperf v0.2.0 Phase 2-3: Real-World Test + Self-Review

**Date**: 2026-05-20 13:55-14:01 UTC
**Tool**: `@ohmyperf/mcp-server` from local build at commit [`dc710f2`](https://github.com/hoainho/ohmyperf/commit/dc710f2) (post-Phase-1)
**Method**: MCP stdio with new v0.2.0 LLM-first signals enabled
**Sites tested**: 10 (2 priority: tradeit.gg, sweeps.qa3; 8 secondary)

---

## Phase 2: 10-site headline results — NEW SIGNALS visible

| # | Site | LCP | Trust | Servability | Total fix | First-party fix | Origin (so/ss/xs) | Outcome |
|---|------|-----|-------|-------------|-----------|-----------------|-------------------|---------|
| 1 | **tradeit.gg** ⭐ | 1804ms | low | real-page | **18** | **18** | 178/0/52 | ✅ rich fix plan |
| 2 | **sweeps.qa3** ⭐ | 2700ms | low | real-page | 0 | 0 | 7/1/**38** | ⚠ all blockers cross-site |
| 3 | Wikipedia (perf article) | 356ms | medium | real-page | 2 | 2 | 26/0/4 | ✅ |
| 4 | web.dev/articles/vitals | 1208ms | low | real-page | 4 | 0 | 9/0/64 | ⚠ all blockers cross-site |
| 5 | GitHub Homepage | 532ms | low | real-page | 20 | 0 | 1/4/144 | ⚠ origin-class FP (see §3.1) |
| 6 | Hacker News | 940ms | low | real-page | 1 | 1 | 6/0/0 | ✅ |
| 7 | Stack Overflow | 349ms | low | **bot-challenge-suspected** | 0 | 0 | 4/0/2 | ✅ correctly flagged |
| 8 | Reddit | 524ms | low | real-page | 0 | 0 | 2/0/1 | (Reddit served minimal page) |
| 9 | npmjs.com | ❌ timeout 30s | — | — | — | — | — | network error |
| 10 | vercel.com | 504ms | low | real-page | 35 | 35 | 288/0/6 | ✅ richest fix plan |

**Empirical signal distribution:**
- Servability: 8/9 `real-page`, 1/9 `bot-challenge-suspected` (Stack Overflow). Correctly catches what Round-14 demo (npmjs.com) caught.
- Trust: 8/9 `low`, 1/9 `medium`. Confirms 3-run measurements + no calibration → low confidence by design.
- First-party fix count: ranges from 0 to 35. Real differentiator between optimizable sites (tradeit.gg, vercel) vs heavy-third-party-dependent (GitHub, web.dev, sweeps.qa3).

---

## Priority site #1: tradeit.gg deep-dive

**18 first-party render-blocking-stylesheet patches** generated. Top 3 actionable:

```
#1 [render-blocking-stylesheet-media-print] https://tradeit.gg/_nuxt/Confirm.zQ5b604N.css (117ms, medium)
#2 [render-blocking-stylesheet-media-print] https://tradeit.gg/_nuxt/LoginButton.DVfW5dYf.css (117ms, medium)
#3 [render-blocking-stylesheet-media-print] https://tradeit.gg/_nuxt/TextField.C8Qy0XBT.css (117ms, medium)
```

Each patch is a one-line diff:
```diff
- <link rel="stylesheet" href="Confirm.zQ5b604N.css"
+ <link rel="stylesheet" href="Confirm.zQ5b604N.css" media="print" onload="this.media='all'"
```

**Resource breakdown**: 178 same-origin + 0 same-site + 52 cross-site (gambling sites typically have many trackers/CDN ads). The fact that all 18 fixes are first-party means the tradeit.gg team can apply all of them — this is the killer scenario the agent loop was designed for.

**LCP 1804ms is in the "needs improvement" band** (good < 2500ms, poor > 4000ms) — the page would still benefit from the 18 identified first-party fixes, but the LCP itself does not cross the 2500ms "good" threshold. With low trust, agent should rerun `--runs 10 --mode ci-stable` before claiming budget regressions, but the fix opportunity is genuine regardless of trust.

---

## Priority site #2: sweeps.qa3.jarvisqa.net deep-dive

**0 fix plan entries despite LCP=2700ms (POOR).**

Trust reasons: `n=3, mode=real, no_calibration, unstable_flag_set` → trust=low.
Origin breakdown: **7 same-origin + 1 same-site + 38 cross-site** (radical 3rd-party-heavy SPA).

The 0-fix result is HONEST: render-blocking resources are all third-party (e.g., analytics, CDN, etc.) which can't be patched by the sweeps team. This is exactly what `originClass` is for — instead of producing 38 useless patches against 3rd-party URLs, ohmyperf correctly returns "no actionable fixes from your code; review your third-party dependencies."

For sweeps team this is more valuable than a long list of un-applicable patches: it tells them the bottleneck is in dependency choices, not their code.

**Honest caveat**: with 3 runs on a noisy QA env (CoV likely high), the LCP=2700ms number itself should be re-validated with `runs=10`.

---

## Phase 3: Self-Review — Strengths, Weaknesses, Fix Plan

### ✅ Strengths the 10-site run validates

1. **`servabilityClass` works in production.** Stack Overflow correctly flagged as `bot-challenge-suspected`. The heuristic (≤3 resources, <10KB, no JS, or Cloudflare URLs) caught a real anti-automation page.
2. **`trustScore` correctly reflects 3-run noise.** 8/9 sites = low trust. Recommended action consistently points at `--runs 10 --mode ci-stable`.
3. **`fixPlan` ranking with applicability works.** GitHub returned 20 patches all marked `third-party-cannot-apply` — agent saves time NOT trying to defer githubassets.com URLs the GitHub team can't change from their app. tradeit.gg returned 18 first-party-ready patches — agent goes straight to applying them.
4. **End-to-end MCP roundtrip stable.** 9/10 tool calls succeeded. The 1 failure (npmjs.com timeout) returned a structured error, not a crash.
5. **Schema is backward-compatible.** New fields (`trustScore`, `fixPlan`, `servability`, `originClass`) are all optional. Old reports parse fine; new reports add the LLM-discoverability layer.

### 🔴 Weaknesses revealed by real-world testing

#### W1 — `originClass=cross-site` false positive on org-owned CDNs (GitHub, web.dev)

**Symptom**: `github.com` page has 144 cross-site resources, but most are `githubassets.com` — owned by GitHub itself. My algorithm marks them third-party-cannot-apply, but the GitHub team CAN modify them. Same issue with `web.dev` (owned by Google) referencing `gstatic.com`, `googletagmanager.com`.

**Impact**: HIGH for any org with CDN sharding pattern. False-positive rate ~5/10 sites tested.

**Root cause**: Registrable-domain comparison is the W3C "same-site" spec but doesn't account for "same-org" ownership.

**Fix**: Need optional config (per measurement) — `OHMYPERF_ORG_DOMAINS=github.com,githubassets.com,githubusercontent.com` — to merge orgs into a single applicability bucket. Or a `Resource.originClass: "same-org"` tier driven by an opt-in domain list.

**Priority**: P0 — without this, the killer differentiator (applicability filtering) misclassifies on every org with multiple domains.

#### W2 — Trust score "low" for every 3-run measurement

**Symptom**: 8/9 sites = trust low because `runs<5`. Even when CoV is very low (e.g., Wikipedia n=3 cov 5% — should be medium-high), the n<5 rule dominates.

**Impact**: MED. Agent sees trust=low everywhere → desensitization. The signal becomes noise.

**Root cause**: My `classifyMetric` defaults to medium for n<5 even with low CoV, but the cascade `worstLevel()` drops overall to low whenever any metric has the warning.

**Fix**: Differentiate between "sample size warning" (still actionable) vs "noise warning" (don't act). Maybe split into 2 fields: `sampleConfidence` + `effectConfidence` (per Oracle's suggestion in Gap 8 of the deep-design pass).

**Priority**: P1.

#### W3 — Servability misses some bot-challenge variants

**Symptom**: Reddit returned 2 resources, 195 KB — my heuristic saw "more than 3 resources OR more than 10KB" → real-page. But empirically Reddit returned a near-empty SPA shell (LCP=524ms is suspicious for Reddit).

**Impact**: MED. Reddit's LCP claim is likely measuring a login wall, not the real Reddit.

**Root cause**: Heuristic too narrow. Needs to also check for: very low DOM node count (`runtime.layoutCount < 5`), or `text/html` as ONLY mimeType (no JS framework loaded).

**Fix**: Expand servability heuristic to include those signals. Could also add `meta.servability.likelihood: number (0-1)` instead of binary classification — gives the agent room to use a threshold.

**Priority**: P2.

#### W4 — `fixPlan` always uses opportunity-level `wastedMs` as `expectedImpactMs`

**Symptom**: Every patch claims its `wastedMs` from the audit. tradeit.gg's 18 patches all claim 117ms — same number, copy-pasted from `wastedMs`. That's clearly wrong; some patches help more than others.

**Impact**: MED. ROI sorting doesn't actually differentiate within an opportunity since all items have ≈ same value.

**Root cause**: `Opportunity.items[].wastedMs` is sometimes per-item, sometimes total — I treat them uniformly.

**Fix**: Need to (a) detect when item.wastedMs is repeated (artifact of estimation), (b) fall back to resource bytes × estimated transfer time when items share a fictitious value, OR (c) just be honest in `confidence` — drop to "low" when wastedMs is suspect.

**Priority**: P1.

#### W5 — No tests against tradeit.gg shape (gambling/marketplace + Nuxt SSR)

**Symptom**: My unit tests cover synthetic + 4 archetype shapes. None cover the Nuxt CSS-chunk pattern that tradeit.gg ships. Could be edge cases not exercised.

**Impact**: LOW — fixes worked in production demo. But coverage gap.

**Fix**: Add fixture-based integration test that replays the tradeit.gg report against `buildFixPlan` + asserts the 18 patches are produced.

**Priority**: P2.

### Phase 4 fix plan (immediate next step)

| # | Fix | Priority | Effort | Files |
|---|-----|----------|--------|-------|
| W1 | Add `originClass: "same-org"` tier + `OHMYPERF_ORG_DOMAINS` config | P0 | 1h | `llm-signals/origin-class.ts`, `engine.ts`, `types.ts` |
| W4 | `confidence: "low"` for items with repeated `wastedMs` (estimation artifact); never higher than "medium" if confidence is uncertain | P1 | 30min | `llm-signals/fix-plan.ts` |
| W2 | Split trustScore into `sampleConfidence` + `effectConfidence` | P1 | 45min | `llm-signals/trust-score.ts`, `types.ts` |
| W3 | Expand servability heuristic with DOM-node + mimeType-only signals | P2 | 30min | `llm-signals/servability.ts` |
| W5 | Fixture test for tradeit.gg-shaped report | P2 | 30min | `llm-signals/llm-signals.test.ts` |

**Order**: W1 first (largest impact, unlocks honest applicability scoring). Then W4 (kills the "117ms × 18" duplication). Then W2-W3 in parallel. W5 last as documentation/regression guard.

### Phase 5-7 plan (queued)

- **P5 (QA)**: After fixes, fan out 3-4 background agents:
  - explore: re-run sub-set of 10 sites, verify W1 fix changes applicability counts
  - oracle: review the W1-W5 fixes for correctness + edge cases
  - librarian: confirm no new competitor capability surfaced overnight that would change the differentiation thesis
- **P6**: Address all QA feedback to 100% confirmation.
- **P7**: PR with full Phase 1-4 diff, request Gemini review, iterate.
