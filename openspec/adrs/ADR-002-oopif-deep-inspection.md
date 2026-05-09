# ADR-002: OOPIF deep-inspection via `Target.setAutoAttach({flatten:true})` with per-frame `CDPSession`s; CLS dual reporting (root vs aggregate)

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: Sisyphus, Oracle, Metis
- **Related design**: `design.md` D3; spec `iframe-deep-inspection`

## Context

Modern web pages are composed of cross-origin iframes (ads, embeds, payment widgets, third-party trackers, social-login flows). With Chromium's Site Isolation, cross-origin iframes are out-of-process iframes (OOPIFs) and CANNOT be inspected from the parent's CDP session. Lighthouse and PageSpeed Insights effectively skip OOPIF internals — they observe network only. OhMyPerf's marquee differentiator is "99% iframe coverage." The technical mechanism to deliver this is `Target.setAutoAttach`.

The legacy non-flattened CDP attach mode wraps each child session in a nested protocol; flatten-mode shares a single WebSocket with `sessionId` routing. Most internet examples use the legacy mode. We must standardize on flatten-mode and accept the reroute responsibility.

CLS attribution is contested: Lighthouse reports the parent document's CLS only; users running ohmyperf will rightly ask "what about the shifts in the embedded checkout iframe?". Reporting a single conflated number is misleading; reporting two numbers (root vs aggregate) is honest.

## Decision

Adopt the OOPIF flow from `iframe-deep-inspection` spec, summarized:

```
1. context.newCDPSession(page) → rootSession
2. rootSession.send('Target.setAutoAttach', {
     autoAttach: true,
     waitForDebuggerOnStart: true,
     flatten: true,
     filter: [{ type: 'iframe', exclude: false }, { type: 'page', exclude: false }]
   })  // BEFORE Page.navigate
3. On 'Target.attachedToTarget': per-frame CDPSession; enable Page/Network/Runtime/Performance/PerformanceTimeline/DOM/CSS/Profiler?/Log; injectWebVitals via Page.addScriptToEvaluateOnNewDocument; Runtime.runIfWaitingForDebugger
4. On 'Target.targetInfoChanged': re-bind frameId↔sessionId mapping (cross-origin nav within same frame slot)
5. On 'Target.detachedFromTarget' and 'Target.targetDestroyed': finalize that frame's metrics; idempotent error handling for subsequent CDP calls
```

All per-frame state is keyed by **frameId** (from the parent's frame tree), not `targetId`. Cross-origin navigations within the same frame slot reuse the frameId; the sessionId may change.

CLS reported as two numbers per run:
- `clsRoot` — sum of layout shifts in the parent document only (Lighthouse-compatible, used for diff comparability).
- `clsAggregate` — Σ across all frames, weighted by viewport intersection × time-visible.

The "99% iframe coverage" claim is conditioned in marketing: "99% of measurable signals; sandboxed-no-scripts and fenced frames are documented opaque." Sandboxed-no-scripts iframes record `inFrameMetrics: { available: false, reason: 'sandboxed-no-scripts' }`. Fenced frames record `inFrameMetrics: { available: false, reason: 'fenced-frame-opaque' }`.

## Alternatives considered

- **Same-origin only via postMessage handshake**: requires iframe-owner cooperation; cross-origin coverage drops to ~30%. Rejected — defeats the differentiator.
- **Network-only observation**: Lighthouse already does this; gives up in-frame INP/CLS/LCP. Rejected.
- **Single `clsAggregate` only**: misleading vs Lighthouse comparisons; users will not trust the number. Rejected.

## Consequences

- (+) Real cross-origin OOPIF inspection. The differentiator works.
- (+) Honest CLS dual reporting; comparable to Lighthouse on `clsRoot`, richer than Lighthouse on `clsAggregate`.
- (-) High implementation complexity; many edge cases (detached frames, target destroy on cross-origin nav, BFCache, prerender, SW, SPA, popups, fenced frames, sandboxed). Mitigated by a comprehensive synthetic test corpus.
- (-) Auto-attach ordering is fragile (`setAutoAttach` MUST be sent BEFORE `Page.navigate`). A runtime ordering guard fails the run with exit code 7 if violated.

## Compliance / Validation

- The `tests/oopif-corpus/` synthetic test suite exercises every documented edge case and runs against both Playwright and Extension drivers in CI.
- Marketing copy on the website and READMEs SHALL use the conditioned phrasing — never bare "99% iframe coverage."
