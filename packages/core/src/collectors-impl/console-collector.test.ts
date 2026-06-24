import { describe, expect, it } from "vitest";
import { consoleCollectorFactory } from "./console-collector.js";
import { mergeCollectorResults } from "../collectors.js";
import { buildRunReport } from "../engine.js";
import { createSilentLogger } from "../logger.js";
import type { CDPSessionLike } from "../types.js";

function makeMockSession(): {
  session: CDPSessionLike;
  emit: (method: string, payload: unknown) => void;
} {
  const handlers = new Map<string, Array<(p: unknown) => void>>();
  const session: CDPSessionLike = {
    async send() {
      return undefined;
    },
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    async detach() {
      return undefined;
    },
  };
  const emit = (method: string, payload: unknown) => {
    for (const h of handlers.get(method) ?? []) h(payload);
  };
  return { session, emit };
}

const rootCtx = {
  logger: createSilentLogger(),
  frameId: "root",
  isRoot: true,
  url: "http://example.com/",
  navigationStart: 0,
};

describe("consoleCollectorFactory", () => {
  it("captures console.error/warn via Runtime.consoleAPICalled with level + text", async () => {
    const { session, emit } = makeMockSession();
    const handle = await consoleCollectorFactory.create(session, rootCtx);
    emit("Runtime.consoleAPICalled", {
      type: "error",
      args: [{ value: "Boom" }, { value: 42 }],
      stackTrace: { callFrames: [{ url: "http://example.com/app.js", lineNumber: 10 }] },
    });
    emit("Runtime.consoleAPICalled", { type: "warning", args: [{ description: "Deprecated API" }] });

    const result = await handle.finalize();
    const msgs = result.consoleMessages ?? [];
    expect(msgs).toHaveLength(2);
    const err = msgs.find((m) => m.level === "error")!;
    expect(err.text).toBe("Boom 42");
    expect(err.url).toBe("http://example.com/app.js");
    expect(err.lineNumber).toBe(10);
    expect(msgs.find((m) => m.level === "warning")!.text).toBe("Deprecated API");
  });

  it("dedupes identical (level+text) and counts occurrences", async () => {
    const { session, emit } = makeMockSession();
    const handle = await consoleCollectorFactory.create(session, rootCtx);
    for (let i = 0; i < 3; i++) emit("Runtime.consoleAPICalled", { type: "error", args: [{ value: "same" }] });
    const result = await handle.finalize();
    expect(result.consoleMessages).toHaveLength(1);
    expect(result.consoleMessages![0]!.count).toBe(3);
  });

  it("captures browser warnings via Log.entryAdded (CORS/CSP) mapping levels", async () => {
    const { session, emit } = makeMockSession();
    const handle = await consoleCollectorFactory.create(session, rootCtx);
    emit("Log.entryAdded", {
      entry: { source: "security", level: "error", text: "Blocked by CSP", url: "http://x/" },
    });
    emit("Log.entryAdded", { entry: { source: "deprecation", level: "verbose", text: "old api" } });
    const result = await handle.finalize();
    const msgs = result.consoleMessages ?? [];
    expect(msgs.find((m) => m.text === "Blocked by CSP")!.level).toBe("error");
    expect(msgs.find((m) => m.text === "old api")!.level).toBe("debug"); // verbose -> debug
  });

  it("caps distinct entries at 25", async () => {
    const { session, emit } = makeMockSession();
    const handle = await consoleCollectorFactory.create(session, rootCtx);
    for (let i = 0; i < 40; i++) emit("Runtime.consoleAPICalled", { type: "log", args: [{ value: `m${String(i)}` }] });
    const result = await handle.finalize();
    expect(result.consoleMessages!.length).toBe(25);
  });

  it("returns empty (no consoleMessages channel) on non-root frames", async () => {
    const { session, emit } = makeMockSession();
    const handle = await consoleCollectorFactory.create(session, { ...rootCtx, isRoot: false });
    emit("Runtime.consoleAPICalled", { type: "error", args: [{ value: "x" }] });
    const result = await handle.finalize();
    expect(result.consoleMessages).toBeUndefined();
  });

  it("SEAM: consoleMessages survive mergeCollectorResults AND reach RunReport via buildRunReport", async () => {
    const { session, emit } = makeMockSession();
    const handle = await consoleCollectorFactory.create(session, rootCtx);
    emit("Runtime.consoleAPICalled", { type: "error", args: [{ value: "seam-error" }] });
    const consoleResult = await handle.finalize();

    // Merge alongside other collector results (mirrors the engine's per-run merge).
    const merged = mergeCollectorResults([
      { metrics: {}, longTasks: [], resources: [], available: true },
      consoleResult,
    ]);
    expect(merged.consoleMessages).toBeDefined();
    expect(merged.consoleMessages![0]!.text).toBe("seam-error");

    // buildRunReport must copy it onto the RunReport (not silently drop it).
    const run = buildRunReport(0, merged);
    expect(run.consoleMessages).toBeDefined();
    expect(run.consoleMessages![0]!.text).toBe("seam-error");
  });
});
