# Diagnostics

OhMyPerf doesn't just give you a number — it tells you **where the page is slow and what to fix**. The diagnostics surface ships in both the SPA `/report` view and the CLI's `--format markdown` output.

## What you get

### LCP breakdown

For every measurement where LCP attribution is available, you see the LCP value broken into four sub-parts:

| Sub-part | What it is |
|---|---|
| `ttfb` | Time to first byte of the document |
| `loadDelay` | Gap between document TTFB and the LCP resource starting to load |
| `loadDuration` | How long the LCP resource took to download |
| `renderDelay` | Gap between LCP resource finishing and the LCP painting |

You also see the **element** (CSS selector) and, when the LCP is an image, the **resource URL**. The four sub-parts sum to the LCP value (within ±5ms of rounding).

**How to act**: if `loadDelay` or `loadDuration` dominate, your LCP is network-bound — preload, host on a faster CDN, or shrink the image. If `renderDelay` dominates, you have render-blocking work — see the next section.

### INP breakdown

Same idea for INP: `inputDelay + processing + presentation`. You also see the **longest script** that ran during the interaction, with its URL and the sub-part it occurred in.

**How to act**: `inputDelay` high → main thread was busy before the event reached your handler (probably during page load). `processing` high → your event handler did too much work. `presentation` high → too much style/layout/paint after the handler.

### CLS culprit

For every measurement with a layout shift, you see the **largest shifting element** (CSS selector), the `previousRect` and `currentRect`, and a `cause` hint. When the shifting source is an iframe, `cause` is `frame-resize`.

**How to act**: explicitly size images and ad slots; reserve space for late-loading content; avoid injecting content above existing content.

### Render-blocking resources

Listed with a per-resource **`wastedMs`** (the milliseconds the resource delayed FCP) and transfer size.

**How to act**: defer scripts (`<script async>` or `defer`), inline critical CSS, lazy-load non-critical CSS via `media="print" onload="this.media='all'"`.

### Long main-thread tasks

The top 20 tasks ≥ 50ms, attributed to a JS URL when the trace shows one. Each task is color-coded:

- ≥ 300ms → severe (red)
- ≥ 100ms → warn (amber)
- < 100ms → ok (gray)

**How to act**: split the offending bundle, defer non-critical work to `requestIdleCallback`, move expensive computation to a worker.

### Third parties

Resources grouped by entity (Google Tag Manager, Hotjar, Cloudflare beacon, …) with the **transfer size** and **main-thread time** attributed to that entity. Detection uses the [`third-party-web`](https://github.com/patrickhulce/third-party-web) `nostats-subset` dataset.

**How to act**: audit each entity for actual ROI; use [Facade](https://web.dev/articles/third-party-facades) for video/chat widgets; gate consent-managed scripts behind interaction.

## Filtering

In the SPA `/report` view, the "Metric filter pills" let you narrow the insights panel to a single metric. Pick `LCP` and CLS culprits + INP details disappear; pick `TBT` and you see long tasks + third parties (the things that affect main-thread time).

## When insights are missing

The insights panel surfaces what data is **available**, not a fixed set. Missing insights usually mean:

- **No LCP breakdown** → `web-vitals/attribution` couldn't identify the element (CSP / cross-origin / very fast page).
- **No long tasks** → the page had no main-thread work > 50ms, or you ran the CLI without `--collect-trace` (it's opt-in for `ohmyperf run`; SPA + extension enable it by default).
- **No third parties** → only first-party resources detected.
- **No render-blocking opportunity** → no `<link rel="stylesheet">` or sync `<script>` blocked FCP, or FCP itself wasn't captured.

If insights you expect aren't appearing, re-run with `--collect-trace` and check `report.json` directly to verify the underlying data shape.
