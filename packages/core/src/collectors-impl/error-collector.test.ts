import { describe, expect, it } from "vitest";
import { errorCollectorFactory } from "./error-collector.js";
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

describe("errorCollectorFactory", () => {
  it("captures an uncaught exception with message/name/stack/url", async () => {
    const { session, emit } = makeMockSession();
    const handle = await errorCollectorFactory.create(session, rootCtx);
    emit("Runtime.exceptionThrown", {
      exceptionDetails: {
        text: "Uncaught TypeError: x is not a function",
        url: "http://example.com/app.js",
        exception: {
          className: "TypeError",
          description: "TypeError: x is not a function\n    at http://example.com/app.js:12:5",
        },
      },
    });
    const result = await handle.finalize();
    const errs = result.pageErrors ?? [];
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toBe("TypeError: x is not a function");
    expect(errs[0]!.name).toBe("TypeError");
    expect(errs[0]!.source).toBe("exception");
    expect(errs[0]!.stack).toContain("at http://example.com/app.js:12:5");
    expect(errs[0]!.url).toBe("http://example.com/app.js");
  });

  it("classifies unhandled promise rejection from the '(in promise)' hint", async () => {
    const { session, emit } = makeMockSession();
    const handle = await errorCollectorFactory.create(session, rootCtx);
    emit("Runtime.exceptionThrown", {
      exceptionDetails: {
        text: "Uncaught (in promise) Error: rejected",
        exception: { className: "Error", description: "Error: rejected" },
      },
    });
    const result = await handle.finalize();
    expect(result.pageErrors![0]!.source).toBe("unhandledrejection");
  });

  it("caps at 25 errors", async () => {
    const { session, emit } = makeMockSession();
    const handle = await errorCollectorFactory.create(session, rootCtx);
    for (let i = 0; i < 40; i++) {
      emit("Runtime.exceptionThrown", { exceptionDetails: { text: `Error ${String(i)}`, exception: { description: `Error ${String(i)}` } } });
    }
    const result = await handle.finalize();
    expect(result.pageErrors!.length).toBe(25);
  });

  it("returns no pageErrors channel on non-root frames", async () => {
    const { session, emit } = makeMockSession();
    const handle = await errorCollectorFactory.create(session, { ...rootCtx, isRoot: false });
    emit("Runtime.exceptionThrown", { exceptionDetails: { text: "x" } });
    const result = await handle.finalize();
    expect(result.pageErrors).toBeUndefined();
  });

  it("SEAM: pageErrors survive mergeCollectorResults AND reach RunReport via buildRunReport", async () => {
    const { session, emit } = makeMockSession();
    const handle = await errorCollectorFactory.create(session, rootCtx);
    emit("Runtime.exceptionThrown", { exceptionDetails: { text: "Uncaught Error: seam", exception: { description: "Error: seam" } } });
    const errResult = await handle.finalize();
    const merged = mergeCollectorResults([
      { metrics: {}, longTasks: [], resources: [], available: true },
      errResult,
    ]);
    expect(merged.pageErrors).toBeDefined();
    const run = buildRunReport(0, merged);
    expect(run.pageErrors).toBeDefined();
    expect(run.pageErrors![0]!.message).toBe("Error: seam");
  });
});
