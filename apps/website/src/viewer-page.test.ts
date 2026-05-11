import { describe, expect, it } from "vitest";
import { renderReportHtml } from "@ohmyperf/viewer";

function makeReport() {
  return {
    schemaVersion: "1.0.0" as const,
    meta: {
      url: "https://example.com",
      startedAt: "2026-05-11T00:00:00.000Z",
      durationMs: 1000,
      runs: 1,
      mode: "real" as const,
      browser: { name: "chromium", version: "147.0", source: "bundled" as const },
      host: { os: "linux", arch: "x64", nodeVersion: "v22" },
      parity: { mode: "headless" as const, knownDeltas: {} },
      emulation: false as const,
      pluginCapabilityUses: [],
      measurementId: "m_test",
    },
    runs: [],
    aggregated: {},
    frames: {
      root: "r",
      nodes: {
        r: {
          frameId: "r",
          url: "https://example.com",
          origin: "https://example.com",
          parentFrameId: null,
          isOOPIF: false,
          isCrossOrigin: false,
          attachedAt: 0,
          metrics: {},
          children: [],
        },
      },
    },
    audits: [],
    artifacts: {},
    pluginData: {},
  };
}

describe("website /viewer rendering contract", () => {
  it("renderReportHtml() produces a self-contained doc the website can write()", () => {
    const html = renderReportHtml(makeReport());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("OhMyPerf v1.0.0 report");
    expect(html).toContain("https://example.com");
  });

  it("rejects v2.0.0 schemaVersion at the drag-drop layer", () => {
    const isReport = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return false;
      const r = value as { schemaVersion?: unknown; runs?: unknown; meta?: unknown };
      if (r.schemaVersion !== "1.0.0") return false;
      if (!Array.isArray(r.runs)) return false;
      if (!r.meta || typeof r.meta !== "object") return false;
      return true;
    };
    expect(isReport({ ...makeReport(), schemaVersion: "2.0.0" })).toBe(false);
    expect(isReport(makeReport())).toBe(true);
    expect(isReport(null)).toBe(false);
    expect(isReport({ schemaVersion: "1.0.0" })).toBe(false);
  });
});
