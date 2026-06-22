# OhMyPerf v2 — Improvement Plan (brand-new version)

**Date:** 2026-06-21 · **Baseline:** v0.1.1 (report schemaVersion 1.0.0) · **Grounding:** [FLOW_TEST_REPORT_2026-06-21.md](./FLOW_TEST_REPORT_2026-06-21.md)

> This plan is grounded in a full-flow test pass: 39/39 test tasks green (~423 tests), all 8 CLI commands, 8 core MCP tools, and 6 reporter formats verified — plus the concrete gaps found along the way (no-test packages, library-only reporters, undeployed share endpoint, platform-mismatch fragility).

---

## 1. Executive summary

v0.1.1 is a **technically strong, statistically honest** performance platform: real-machine/real-browser CWV via Playwright + CDP with OOPIF iframe coverage, a Mann-Whitney U regression `diff`, and two genuinely differentiating trust signals — `trustScore` (sample + effect confidence) and `servability` (real-page vs bot-challenge/error/timeout). It is also **MCP-native**, which is rare and valuable. Its weaknesses are not in the engine but at the **edges**: brittle packaging/resolution, coverage holes in peripheral packages, no persistent regression history, lab-only data (no field/CrUX), and an undeployed hosted share service.

**v2 thesis:** keep the trustworthy engine, and turn OhMyPerf into the **trustworthy, AI-native performance platform that remembers** — unifying lab + field data, making regression *history* a first-class store (not loose `report.json` files), hardening the agent fix-loop behind trust gates, and shipping hosted/self-host parity. The bet vs Lighthouse (one-shot, no stats), Calibre/SpeedCurve (hosted-only, closed), and WebPageTest (lab-only): **open, statistically honest, agent-first, with history**.

---

## 2. Current-state architecture assessment

| Subsystem | Strengths | Weaknesses (evidence) |
|---|---|---|
| `packages/core` (engine) | 94 tests; clean aggregation, trust/servability scoring | Single-run UX: `get_trust_score` correctly flags n=1 as `unreliable` but the CLI default still allows low-n runs without nudging calibration |
| `packages/driver-playwright` / `driver-extension` | Real-browser + OOPIF; parity-tested | Playwright CLI resolution was brittle (`ERR_PACKAGE_PATH_NOT_EXPORTED`, fixed this session in `apps/cli/src/commands/install-browser.ts`) |
| `apps/cli` | citty-based, 8 commands, 6 formats | Packaging fragility: `init` template resolution + bundling was broken (fixed); HAR/trace/lh-compat reporters not exposed as `--format` |
| `apps/mcp-server` | 17 tools, AI-fix-loop (`propose_patch`/`verify_fix`/`get_fix_plan`) | Fix-loop tools unexercised end-to-end; no persistence of runs across sessions (`list_runs` reads a single dir) |
| reporters | json/html/deck/md/junit/csv all emit | `reporter-csv/har/junit/lh-compat`, `trace-utils` have **no tests**; `reporter-json/html` have no test files |
| `packages/share-client` / `share-server` | server tested (10 tests), secret-scrubbing, Workers deploy path | `https://ohmyperf.dev` **not deployed**; client has no unit tests |
| `apps/website` / `viewer` | viewer 98 tests; builds green | website has no unit tests (e2e/a11y/smoke only) |
| `apps/extension-chrome` | E2E spec exists | vitest had no config and collected the Playwright spec (fixed this session via `vitest.config.ts`); no CI E2E gate |
| Monorepo infra | turbo + pnpm catalog, 28/28 build | `node_modules` platform-mismatch (Linux binaries on macOS) silently broke vitest/builds — no install guard |

**Cross-cutting observations**
- Resolution/packaging code is hand-rolled and brittle (two CLI bugs in one session). v2 needs a single, tested asset/binary-resolution module.
- Each run is an island: no run IDs in a store, no trend, `diff` requires the user to manage two files by hand.
- Trust signals are excellent but **advisory only** — they don't yet gate the AI fix-loop or CI by default.

---

## 3. v2 vision & North Star

**North Star:** *"Measure on real hardware, prove it statistically, remember it over time, and let an agent fix it — all open and self-hostable."*

Positioning:
- **vs Lighthouse:** statistical confidence + servability + history (Lighthouse is one-shot, no stats, no memory).
- **vs Calibre/SpeedCurve:** open-source, self-hostable, MCP-native; no vendor lock-in.
- **vs WebPageTest:** lab **and** field (CrUX/RUM), agent-driven remediation, modern report schema.

Three pillars: **(A) Trustworthy** (stats gate everything), **(B) Continuous** (history + trends + CI), **(C) Agentic** (hardened fix-loop).

---

## 4. Prioritized roadmap

### P0 — Correctness & foundations (must-have for a credible v2)

| Item | Problem | Proposed change | Packages | Effort | Acceptance |
|---|---|---|---|---|---|
| **P0.1 Unified asset/binary resolver** | Two CLI resolution bugs in one session (init templates, playwright cli) | One tested `@ohmyperf/resolve` module: package-relative + monorepo-root + published-package strategies, with `existsSync` checks | new pkg, `apps/cli` | M | Resolver has unit tests for dev + published layouts; `init`/`install-browser` consume it |
| **P0.2 Install-platform guard** | Linux native binaries on macOS broke vitest/builds silently | `preinstall`/`doctor` check that native deps (`@rollup`, `@esbuild`, `playwright`) match `process.platform/arch`; `doctor` reports mismatch with fix | root scripts, `apps/cli doctor` | S | `doctor` exits non-zero + prints `pnpm install` fix when binaries mismatch platform |
| **P0.3 Close reporter test gaps** | csv/har/junit/lh-compat, trace-utils untested | Golden-file (snapshot) contract tests per reporter from a shared fixture report | all `reporter-*`, `trace-utils` | M | Every reporter package has ≥1 test; `turbo run test` covers all reporters |
| **P0.4 Report schema v2 + versioning** | schema 1.0.0 ad hoc; trust/servability bolted on | Formalize `@ohmyperf/shared-types` schema 2.0.0 (zod) with explicit `trust`, `servability`, `field` blocks + a 1.x→2.x adapter | `shared-types`, `core` | M | zod-validated schema; round-trip adapter test 1.0.0→2.0.0 |
| **P0.5 Trust gates by default** | trust/servability are advisory | CLI/MCP refuse to emit a CI pass/budget verdict when `servability!=real-page` or `trust=unreliable` unless `--force` | `core`, `cli`, `mcp-server` | S | `run --format junit` on n=1 yields non-pass + clear reason; documented exit code |

### P1 — High-value features

| Item | Problem | Proposed change | Packages | Effort | Acceptance |
|---|---|---|---|---|---|
| **P1.1 Run history store** | Runs are isolated files | Local store (SQLite/JSON-lines) of runs keyed by URL+commit+timestamp; `list_runs`/`diff` read it; `ohmyperf trend <url>` | new `@ohmyperf/store`, `cli`, `mcp-server` | L | `trend` shows last N runs per URL; `diff` can auto-pick baseline=last-green |
| **P1.2 Hosted share service (parity)** | `ohmyperf.dev` undeployed | Deploy `share-server` (Cloudflare Workers path already exists) + provision the default endpoint; document self-host as first-class equal | `share-server`, infra | M | `ohmyperf share <file>` works against default endpoint OR prints exact self-host one-liner (already does) |
| **P1.3 First-class GitHub Action** | `init` scaffolds YAML, but no published action | Publish `ohmyperf/action@v2`: run → diff vs base branch (from store) → PR comment (markdown reporter) → fail on regression | new action, `reporter-markdown` | M | Action posts a CWV table PR comment and fails on significant regression |
| **P1.4 Field data (CrUX/RUM)** | Lab-only | Optional CrUX API fetch + RUM ingest endpoint; report `field` block alongside lab; flag lab/field divergence | `core`, `shared-types`, `mcp-server` | L | Report shows lab vs field p75 for LCP/INP/CLS when CrUX key present |
| **P1.5 Device & network profiles in CLI** | profiles not surfaced | `--profile mobile-4g\|desktop-cable\|…` mapping to CDP throttling | `cli`, `driver-playwright` | S | `run --profile mobile-4g` applies CPU+network throttle; recorded in report meta |
| **P1.6 Expose all reporters** | har/trace/lh-compat library-only | Add to `--format` enum + MCP `generate_*` tools | `cli`, `mcp-server` | S | `run --format har,trace,lh` emits files; help lists them |

### P2 — Polish & ecosystem

| Item | Change | Effort |
|---|---|---|
| **P2.1 Dashboard** | Web dashboard over the history store (trends, sparklines) on `apps/website` + `viewer` charts | L |
| **P2.2 Multi-URL crawl** | `run --urls urls.txt` / sitemap crawl with per-URL reports + summary | M |
| **P2.3 AI fix-loop hardening** | Gate `propose_patch`/`verify_fix` on `trust!=unreliable`; require post-fix re-measure to beat baseline by significant margin | M |
| **P2.4 CI E2E gate for extension** | Wire `playwright.config.ts` e2e into CI with fixtures (`prepare-e2e-fixtures.mjs`) | M |
| **P2.5 Plugin SDK + registry** | Stable plugin API v2 + `list-plugins` from a registry, not just built-ins | M |

---

## 5. New features (tied to user needs)

1. **Regression history (`trend`)** — *"Is this PR slower than last week?"* needs memory, not loose files. (P1.1)
2. **GitHub Action with PR comments** — *"Block merges that regress LCP"* is the #1 CI ask. (P1.3)
3. **Hosted share with self-host parity** — *"Send my boss a link"* without standing up infra. (P1.2)
4. **Field data (CrUX/RUM)** — *"Do my lab numbers match real users?"* lab-only tools can't answer. (P1.4)
5. **Device/network profiles** — *"How slow is this on mobile-4G?"* one flag, not config archaeology. (P1.5)
6. **Trust-gated AI fix-loop** — *"Don't let the agent 'fix' noise"* — only act on statistically real regressions. (P2.3)

---

## 6. Testing & quality strategy for v2

- **Close the gaps from the flow report:** golden-file tests for every reporter (P0.3); unit tests for `share-client`, `trace-utils`, `plugins-builtin`.
- **Schema contract tests:** zod validation + 1.x→2.x adapter round-trip (P0.4).
- **Trust gate tests:** assert n=1 / bot-challenge reports cannot produce a CI pass (P0.5).
- **E2E lane in CI:** extension + website Playwright behind a tagged job with fixtures (P2.4); keep it OUT of the vitest unit lane (the bug fixed this session — `vitest.config.ts` excludes `tests/playwright-e2e/**`).
- **Install integrity:** platform-mismatch guard test (P0.2); `turbo run test --continue` mandated in CI (so one failure doesn't mask others — a real false-negative trap found this session).
- **Coverage target:** every package has ≥1 test; CI fails on a package with `test` script but 0 collected tests (except declared `passWithNoTests`).

---

## 7. Migration path (v0.1.x → v2)

1. **Schema:** bump report `schemaVersion` 1.0.0 → 2.0.0. Ship `@ohmyperf/shared-types` adapter so `diff`/`share`/viewer accept 1.0.0 reports (auto-upgrade in memory). `diff` already guards cross-source/cross-mode — extend to cross-schema with `--allow-cross-schema`.
2. **CLI:** keep all v1 commands/flags; add new ones additively. New trust-gate default is the one behavior change — gate it behind a `v2` major and document `--force` / `--allow-single-run` escape hatches (the latter already exists).
3. **Reporters:** v1 outputs remain byte-compatible; new `field` block is additive and optional.
4. **MCP:** tool names stable; add fields, don't rename. New tools (`trend`, `crux`) are additive.
5. **Deprecation:** one minor cycle of warnings for any removed flag; `doctor` prints migration notes.

---

## 8. Risks & open questions

- **Scope:** P1.1 (store) + P1.4 (field) + P2.1 (dashboard) is a large surface — sequence them; ship the store first (everything else builds on it).
- **Hosted service:** cost, abuse, and secret-leak risk on `share-server` — the existing env-secret scrubber must stay mandatory; rate-limit + expiry already modeled.
- **CrUX limits:** API quotas + only popular origins have field data — must degrade gracefully to lab-only.
- **Breaking schema:** a 2.0.0 schema risks ecosystem breakage — the adapter (P0.4) is the mitigation and must land first.
- **Open questions:** SQLite vs JSON-lines for the store (portability vs query power)? Bundle a hosted dashboard or keep it self-host only? Do we adopt INP field thresholds now that INP is the INP-era CWV?

---

### Suggested sequencing (first cut)
**Milestone A (foundations):** P0.1–P0.5 → **Milestone B (continuous):** P1.1, P1.3, P1.6 → **Milestone C (field+profiles):** P1.4, P1.5, P1.2 → **Milestone D (ecosystem):** P2.*.
