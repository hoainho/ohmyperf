# OhMyPerf Roadmap

Living document. Updated when shipped, when scope changes, or quarterly.
Last updated: **2026-06-01**.

The roadmap reflects current maintainer + community priorities. Open a
[feature request](https://github.com/hoainho/ohmyperf/issues/new?template=feature_request.yml)
to suggest changes. Items move out of "Considering" into a quarter only after
an OpenSpec change proposal is accepted.

---

## Now — 2026 Q2 (Apr-Jun)

**Theme: Statistical rigor + agent ergonomics.**

- [x] CLI v1.0 with frozen `core` API surface (api-extractor enforced)
- [x] MCP server with 16 tools
- [x] Hosted viewer SPA
- [x] Chrome + VSCode extensions
- [ ] `trustScore` GA (currently `meta.trustScore`, promote to top-level)
- [ ] `fixPlan` GA — ranked, deduped, ROI-scored, `applicability`-tagged
- [ ] `servability` classification (real-page / bot-challenge / error / timeout)
- [ ] `originClass` on every `Resource` (same-origin / same-site / same-org / cross-site)
- [ ] `--mode ci-stable` with pre-flight CPU calibration + Fast 4G throttle
- [ ] Mann-Whitney U `verify_fix` GA with per-metric noise floors
- [ ] Submit to: Smithery, MCP registry, Awesome MCP Servers
- [ ] Launch wave: Show HN, Product Hunt, dev.to tutorial

## Next — 2026 Q3 (Jul-Sep)

**Theme: CI ergonomics + first-party perf budgets.**

- [ ] GitHub Action `ohmyperf-action` published to Marketplace
- [ ] GitLab CI template
- [ ] Bitbucket Pipelines template
- [ ] `ohmyperf budget` subcommand — declarative perf budgets per route
- [ ] HTML reporter v2: side-by-side run comparison
- [ ] Custom plugin SDK docs + 3 reference plugins
- [ ] Hacktoberfest participation
- [ ] perf.now() / Performance Summit talk submission

## Later — 2026 Q4 (Oct-Dec)

**Theme: Multi-region + RUM bridge.**

- [ ] Multi-region measurement (queue runs across N machines, aggregate)
- [ ] Cloudflare Workers-based remote runner (BYO worker)
- [ ] CrUX field-data import → compare lab vs field
- [ ] Sentry integration: link a Sentry release ID to an ohmyperf run
- [ ] Datadog RUM bridge (read-only)
- [ ] OpenTelemetry traces export for the agent loop
- [ ] Hacktoberfest retrospective + contributor recognition

## Future — 2027+

**Theme: Beyond CWV.**

- [ ] Custom user-defined metrics (declare → measure → budget)
- [ ] Memory regression detection (heap snapshots over time)
- [ ] Storybook integration: measure each story as a perf surface
- [ ] React DevTools profiler bridge
- [ ] AI-suggested archetype expansion (LLM-proposed new fix patterns, human-reviewed before merge)

## Considering (no commitment)

These are interesting but not on the roadmap until validated:

- Firefox / WebKit measurement parity (currently Chromium-only)
- Native macOS app for the viewer
- Hosted ohmyperf.com service (currently self-hosted only)
- pnpm/npm install-time perf measurement (build-perf, not runtime)
- WebAssembly runtime perf plugins

## How to influence the roadmap

1. **Use the tool.** Tell us what hurts. Open a [feature request](https://github.com/hoainho/ohmyperf/issues/new?template=feature_request.yml).
2. **Sponsor an item.** [GitHub Sponsors](https://github.com/sponsors/hoainho) accelerate the item you want.
3. **Send a PR.** Most "Later" items are open for contributor takeover — comment on the matching issue first to claim it.
4. **Vote with 👍** on existing issues. We track top-voted to inform quarterly planning.

## Recently shipped

See [CHANGELOG.md](./CHANGELOG.md) for the full history.
