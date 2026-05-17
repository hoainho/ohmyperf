# Parity tests

Verifies that OhMyPerf's metric values match Lighthouse 13.x within published tolerances on a small set of self-hosted fixtures. Gated behind `pnpm test:parity` (not part of default `pnpm test`) because it launches two Chromium instances and takes ~30–60s on a warm host.

## Tolerances

| Metric | Bound | Owner |
|---|---|---|
| LCP / FCP / TTFB | ±10% relative to Lighthouse median | Track A (this file, `lighthouse-parity.test.ts`) |
| TBT | ±15% relative to Lighthouse | Track B (`tbt-parity.test.ts`, gated on trace collector) |

TBT parity uses a wider band in v1 because OhMyPerf currently aggregates long-tasks from `PerformanceObserver('longtask')` (main-thread only) while Lighthouse derives TBT from a CDP `Tracing` capture. Track B introduces a trace-based collector; once that lands, tighten TBT to ±5%.

## Fixtures

- `simple-static.html` — Plain HTML + CSS, no JS. LCP element is `<h1>`.
- `image-heavy-lcp.html` — Inline SVG hero as LCP element.
- `long-task-bomb.html` — Five back-to-back ~200ms blocking tasks to inflate TBT.

## Running

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test:parity
```

## Architecture notes

- Lighthouse and OhMyPerf launch **separate** Chromium instances on different `--remote-debugging-port` values to avoid CDP attach conflicts on shared `Page`/`Network` domains.
- A local static-file server is started by the test harness; no internet access required.
- Reference: deep-design Phase 4 critic notes (Oracle, 2026-05-17).
