# Design: Full-Load Time (FLT) — the formula

All timestamps are milliseconds relative to `navigationStart` (`t = 0`). The algorithm is a pure function of four event streams; it performs no I/O and is deterministic given its inputs.

## 1. Input event streams

| Stream | Source (CDP) | Shape |
|---|---|---|
| `net[]` | `Network.requestWillBeSent` / `loadingFinished` / `loadingFailed` / `webSocketCreated` | `{ t, delta: +1|-1, blocking: boolean }` |
| `dom[]` | injected `MutationObserver` (via `Page.addScriptToEvaluateOnNewDocument`) | `{ t, w }` where `w = added + removed + 0.25·attr + 0.1·charData` |
| `cpu[]` | `PerformanceObserver('long-animation-frame')` → fallback `longtask` | `{ start, end }` busy intervals (duration ≥ 50ms) |
| `vis[]` *(opt)* | periodic `Page.captureScreenshot` | `{ t, changed: boolean }` (viewport pixel-diff > `visualDiffEpsilon`) |

### 1.1 Blocking classification (network)
A request is **blocking** until it finishes, EXCEPT it is reclassified **non-blocking** when any holds:
- it is a WebSocket (`Network.webSocketCreated`) or EventSource/`text/event-stream`;
- its response is a streaming/long-poll body still open after `longLivedGraceMs` (default 5000ms);
- it is a fire-and-forget beacon (`navigator.sendBeacon`, `keepalive: true`).

Rationale: without this, any page with a live socket, SSE, or heartbeat poll never reaches network-quiet and FLT would always be `capped`. `--strict-network` disables reclassification.

### 1.2 DOM noise floor
A mutation batch counts as **busy** only if `w ≥ mutationNoiseFloor` (default 3). Batches confined to nodes with active CSS animation/transition, `<video>`, or a user-supplied steady-state selector are down-weighted to `0.25·w`. This filters cursor blinkers, live clocks, and micro-re-renders.

## 2. Per-signal "busy until" timestamps

For each signal define the last moment it was **blocking-busy**:

```
netBusyUntil   = max t such that, scanning net[] as a running counter of BLOCKING requests,
                 inflightBlocking(t) > netIdleThreshold        (default k = 2)
domBusyUntil   = max dom[i].t where dom[i].w ≥ mutationNoiseFloor
cpuBusyUntil   = max cpu[i].end
visBusyUntil   = max vis[i].t where vis[i].changed            (only if visual enabled)
```

If a signal is never busy, its `busyUntil = 0` (it was quiet from the start).

## 3. The settle algorithm (rolling confirmation)

FLT is the start of the **final quiet window** of length `settleWindow` (default 1000ms) during which **no enabled signal** is blocking-busy. Equivalent rolling form:

```
ENABLED = signals selected by `until`:
  load-event        → none (FLT := subTimeline.loadEventEnd)
  network-idle-2    → {net}
  fully-loaded      → {net, dom, cpu}            (default)
  visually-complete → {net, dom, cpu, vis}

events = merge & sort all "busy-end" boundaries from ENABLED signals
         (a network counter crossing down to ≤k; a dom batch at t; a cpu interval .end; a vis change at t)

lastBusy = max( busyUntil(s) for s in ENABLED )       // 0 if all quiet
// confirm the window is clean; if a late blocking event appears within the window, advance.
loop:
  windowEnd = lastBusy + settleWindow
  nextBusy  = min t over ENABLED signals with a blocking event in (lastBusy, windowEnd]
  if nextBusy exists: lastBusy = nextBusy; continue
  else: break
FLT = lastBusy
```

Observation runs until FLT is confirmed (a clean `settleWindow` elapsed) OR wall-clock reaches `maxWaitMs` (default 30000):

```
if confirmedWithin(maxWaitMs):  capped = false ; FLT = lastBusy
else:                           capped = true  ; FLT = maxWaitMs
```

`load-event` mode short-circuits to `loadEventEnd` (no settle needed). This is the same family as WebPageTest "Fully Loaded" (last activity + quiet window), generalized from 1 signal to 4.

## 4. Gating attribution (the "why")

```
gatingPhase = argmax_{s in ENABLED} busyUntil(s)        // the signal that went quiet LAST == what gated FLT
gatingDistribution = { s: busyUntil(s) for s in ENABLED }
```
Ties (within 16ms) resolved by priority `network > main-thread > dom > visual`; `gatingDistribution` always records the raw values so a reporter can show "FLT 4.2s — net quiet @1.1s, dom @1.4s, **cpu @4.2s ← gate**".

Key consequence used by `add-remediation-engine`: **fixing a non-gating signal yields ≈0 FLT improvement.** `gatingHeadroom(s) = FLT − max_{s'≠s} busyUntil(s')` quantifies how much fixing signal `s` can buy.

## 5. Sub-timeline (always reported)

`{ ttfb, fcp, domContentLoaded, loadEventEnd, networkIdleAt(k), lastMutationAt, lastLongTaskEndAt, visuallyCompleteAt?, fltMs }` — `ttfb/fcp` reuse the existing cwv collector; `domContentLoaded/loadEventEnd` reuse `loading-collector`; the rest come from §2.

## 6. Aggregation across N runs

- `fltMs` aggregated with the existing pipeline: median / p75 / p95 / CoV / outlier-rejection, and a `trustScore` verdict (reuses v0.2.0 quality core).
- `capped` runs are **excluded** from the median (logged); if ≥ half the runs cap, the aggregate `capped = true` and trust is forced to `unreliable` with reason `never-settled`.
- `gatingPhase` aggregated as the **mode** across runs; if no majority, report `gatingDistribution` and `gatingPhase = 'mixed'`.

## 7. Edge cases (must be covered by tests)

| Case | Expected |
|---|---|
| Clean static page | FLT ≈ last resource end + settle; `gatingPhase = network` |
| Late XHR after load | FLT > load; `gatingPhase = network` |
| Heavy hydration | FLT > load; `gatingPhase = main-thread` |
| Persistent WebSocket / SSE | does **not** cap (reclassified non-blocking); FLT at real content settle |
| Polling timer every 800ms | `capped = true`; `gatingPhase = network` (or dom); recommendation emitted |
| Steady-state animation only | mutations below noise floor → does not block; FLT settles |
| SPA route with no second `load` | FLT works (not load-based) |
| Synthetic deterministic streams | identical FLT every run (enables unit tests) |

## 8. Flags → config mapping

| Flag | `FullLoadConfig` field | Default |
|---|---|---|
| `--until` | `until` | `fully-loaded` |
| `--settle-window` | `settleWindowMs` | 1000 |
| `--max-wait` | `maxWaitMs` | 30000 |
| `--net-idle-threshold` | `netIdleThreshold` | 2 |
| `--mutation-noise` | `mutationNoiseFloor` | 3 |
| `--filmstrip` | `visual` | false |
| `--strict-network` | `strictNetwork` | false |
