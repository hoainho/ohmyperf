import { describe, expect, it } from "vitest";
import {
  computeFullLoad,
  FULL_LOAD_DEFAULTS,
  type FullLoadStreams,
  type NetRequest,
} from "./full-load.js";

const EMPTY_SUBTIMELINE: FullLoadStreams["subTimeline"] = {
  ttfb: null,
  fcp: null,
  lcp: null,
  domContentLoaded: null,
  loadEventEnd: null,
};

function mkStreams(p: Partial<FullLoadStreams>): FullLoadStreams {
  return {
    net: [],
    dom: [],
    cpu: [],
    subTimeline: EMPTY_SUBTIMELINE,
    observedUntilMs: 30_000,
    ...p,
  };
}

const doc = (start: number, end: number): NetRequest => ({ startMs: start, endMs: end, kind: "document" });
const img = (start: number, end: number): NetRequest => ({ startMs: start, endMs: end, kind: "image" });
const xhr = (start: number, end: number | null): NetRequest => ({ startMs: start, endMs: end, kind: "xhr" });

describe("computeFullLoad — settle model", () => {
  it("defaults are the documented values", () => {
    expect(FULL_LOAD_DEFAULTS.until).toBe("fully-loaded");
    expect(FULL_LOAD_DEFAULTS.settleWindowMs).toBe(1000);
    expect(FULL_LOAD_DEFAULTS.maxWaitMs).toBe(30_000);
    expect(FULL_LOAD_DEFAULTS.netIdleThreshold).toBe(0);
    expect(FULL_LOAD_DEFAULTS.mutationNoiseFloor).toBe(3);
    expect(FULL_LOAD_DEFAULTS.longLivedGraceMs).toBe(5000);
    expect(FULL_LOAD_DEFAULTS.visual).toBe(false);
  });

  // Case 1
  it("clean static page → FLT at last resource end, gating network", () => {
    const r = computeFullLoad(
      mkStreams({ net: [doc(0, 200), { startMs: 50, endMs: 300, kind: "script" }, img(100, 900)] }),
    );
    expect(r.fltMs).toBe(900);
    expect(r.capped).toBe(false);
    expect(r.gatingPhase).toBe("network");
    expect(r.subTimeline.networkIdleAt).toBe(900);
  });

  // Case 2
  it("late XHR after load → FLT > loadEventEnd, gating network", () => {
    const r = computeFullLoad(
      mkStreams({ net: [doc(0, 300), xhr(1500, 2200)], subTimeline: { ...EMPTY_SUBTIMELINE, loadEventEnd: 1000 } }),
    );
    expect(r.fltMs).toBe(2200);
    expect(r.fltMs).toBeGreaterThan(r.subTimeline.loadEventEnd!);
    expect(r.gatingPhase).toBe("network");
  });

  // Case 3
  it("heavy hydration → main-thread gated, FLT > load", () => {
    const r = computeFullLoad(
      mkStreams({
        net: [doc(0, 300)],
        cpu: [{ start: 400, end: 520 }, { start: 900, end: 2100 }],
        dom: [{ t: 1400, w: 50 }],
        subTimeline: { ...EMPTY_SUBTIMELINE, loadEventEnd: 800 },
      }),
    );
    expect(r.fltMs).toBe(2100);
    expect(r.gatingPhase).toBe("main-thread");
    expect(r.fltMs).toBeGreaterThan(r.subTimeline.loadEventEnd!);
    expect(r.subTimeline.lastLongTaskEndAt).toBe(2100);
  });

  // Case 4
  it("persistent WebSocket does NOT cap; FLT at real content settle", () => {
    const r = computeFullLoad(
      mkStreams({
        net: [doc(0, 300), { startMs: 200, endMs: null, kind: "websocket" }, img(100, 1500)],
      }),
    );
    expect(r.capped).toBe(false);
    expect(r.fltMs).toBe(1500);
    expect(r.gatingPhase).toBe("network");
  });

  it("strict-network counts the open socket → caps", () => {
    const r = computeFullLoad(
      mkStreams({
        net: [doc(0, 300), { startMs: 200, endMs: null, kind: "websocket" }, img(100, 1500)],
      }),
      { strictNetwork: true },
    );
    // strict-network: the socket counts as blocking until it closes; it never does within
    // observation (30000), so the network never goes quiet → FLT caps at maxWait.
    expect(r.capped).toBe(true);
    expect(r.fltMs).toBe(30_000);
    expect(r.gatingPhase).toBe("network");
  });

  // Case 5
  it("polling timer never settles → capped at maxWait, gating network", () => {
    const net: NetRequest[] = [];
    for (let i = 0; i <= 37; i++) net.push(xhr(i * 800, i * 800 + 200));
    const r = computeFullLoad(mkStreams({ net }));
    expect(r.capped).toBe(true);
    expect(r.fltMs).toBe(30_000);
    expect(r.gatingPhase).toBe("network");
  });

  // Case 6
  it("steady-state animation (mutations below noise floor) does not delay FLT", () => {
    const dom = [500, 1000, 1500, 2000, 5000].map((t) => ({ t, w: 1 }));
    const r = computeFullLoad(mkStreams({ net: [doc(0, 400)], dom }));
    expect(r.fltMs).toBe(400);
    expect(r.gatingPhase).toBe("network");
    expect(r.subTimeline.lastMutationAt).toBeNull();
  });

  // LCP floor: the page is never "fully loaded" before its largest contentful paint.
  it("LCP floors FLT even when network/DOM/main-thread settle earlier → gating paint", () => {
    const r = computeFullLoad(
      mkStreams({ net: [doc(0, 300)], subTimeline: { ...EMPTY_SUBTIMELINE, fcp: 1008, lcp: 2036 } }),
    );
    expect(r.fltMs).toBe(2036);
    expect(r.gatingPhase).toBe("paint");
  });

  // Case 7
  it("SPA route with no second load → FLT not tied to loadEventEnd, gating dom", () => {
    const r = computeFullLoad(
      mkStreams({
        net: [doc(0, 300), xhr(2000, 2600)],
        dom: [{ t: 2800, w: 40 }],
        subTimeline: { ...EMPTY_SUBTIMELINE, loadEventEnd: 600 },
      }),
    );
    expect(r.fltMs).toBe(2800);
    expect(r.gatingPhase).toBe("dom");
    expect(r.fltMs).toBeGreaterThan(r.subTimeline.loadEventEnd!);
  });

  // Case 8
  it("is deterministic — same input yields deeply-equal output", () => {
    const streams = mkStreams({
      net: [doc(0, 300)],
      cpu: [{ start: 900, end: 2100 }],
      dom: [{ t: 1400, w: 50 }],
    });
    expect(computeFullLoad(streams)).toEqual(computeFullLoad(streams));
  });
});

describe("computeFullLoad — endpoints", () => {
  it("load-event short-circuits to loadEventEnd", () => {
    const r = computeFullLoad(
      mkStreams({ net: [doc(0, 5000)], subTimeline: { ...EMPTY_SUBTIMELINE, loadEventEnd: 1234 } }),
      { until: "load-event" },
    );
    expect(r.fltMs).toBe(1234);
    expect(r.gatingPhase).toBe("none");
  });

  it("network-idle-2 tolerates 2 in-flight (threshold 2)", () => {
    const net: NetRequest[] = [
      doc(0, 5000),
      img(100, 300),
      img(150, 350),
      xhr(200, 2000),
    ];
    const r = computeFullLoad(mkStreams({ net }), { until: "network-idle-2" });
    // count exceeds 2 on [150,350); it drops back to ≤2 at t=350 → that is when network-idle-2 is reached.
    expect(r.fltMs).toBe(350);
    expect(r.gatingPhase).toBe("network");
    expect(r.subTimeline.networkIdleAt).toBe(350);
  });

  it("empty streams → gating none, flt 0", () => {
    const r = computeFullLoad(mkStreams({}));
    expect(r.fltMs).toBe(0);
    expect(r.gatingPhase).toBe("none");
  });
});
