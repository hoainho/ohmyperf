import {
  type CollectorContext,
  type CollectorFactory,
  type CollectorHandle,
  type CollectorResult,
  emptyCollectorResult,
} from "../collectors.js";
import type { CDPSessionLike, LongTask, Metric } from "../types.js";

const LONGTASK_INLINE_SCRIPT = `
(() => {
  if (window.__ohmyperfLongTasks) return;
  const list = [];
  window.__ohmyperfLongTasks = list;
  try {
    const po = new PerformanceObserver((entries) => {
      for (const e of entries.getEntries()) {
        list.push({ startTime: e.startTime, duration: e.duration });
      }
    });
    po.observe({ type: 'longtask', buffered: true });
  } catch (_) {}
})();
`;

interface RuntimeEvaluateResult {
  result?: { type: string; value?: unknown };
  exceptionDetails?: { text?: string };
}

interface RawLongTask {
  startTime: number;
  duration: number;
}

export const longTaskCollectorFactory: CollectorFactory = {
  id: "ohmyperf.longtask",
  requires: [],
  async create(session: CDPSessionLike, ctx: CollectorContext): Promise<CollectorHandle> {
    let installed = false;
    try {
      await session.send("Runtime.enable");
      await session.send("Page.enable");
      await session.send("Page.addScriptToEvaluateOnNewDocument", {
        source: LONGTASK_INLINE_SCRIPT,
        runImmediately: true,
      });
      installed = true;
    } catch (err) {
      ctx.logger.debug("longtask-collector: install failed", {
        frameId: ctx.frameId,
        error: errMessage(err),
      });
    }

    return {
      id: longTaskCollectorFactory.id,
      async finalize(): Promise<CollectorResult> {
        if (!installed) return emptyCollectorResult("longtask-script-injection-failed");
        try {
          const raw = await readLongTasks(session);
          if (!raw) return emptyCollectorResult("longtask-snapshot-unavailable");

          const longTasks: LongTask[] = raw.map((t) => ({
            startTime: t.startTime,
            duration: t.duration,
            attribution: ctx.isRoot ? "main-thread" : `frame:${ctx.frameId}`,
          }));

          const totalBlockingTime = longTasks.reduce(
            (acc, t) => acc + Math.max(0, t.duration - 50),
            0,
          );

          const metrics: Record<string, Metric> = {};
          if (ctx.isRoot) {
            metrics["tbt"] = { name: "tbt", value: totalBlockingTime, unit: "ms" };
          }

          return {
            metrics,
            longTasks,
            resources: [],
            available: true,
          };
        } catch (err) {
          return emptyCollectorResult(`longtask-finalize-error: ${errMessage(err)}`);
        }
      },
      async dispose(): Promise<void> {
        return undefined;
      },
    };
  },
};

async function readLongTasks(session: CDPSessionLike): Promise<RawLongTask[] | undefined> {
  const result = (await session.send("Runtime.evaluate", {
    expression: "JSON.stringify(window.__ohmyperfLongTasks || [])",
    returnByValue: true,
    awaitPromise: false,
  })) as RuntimeEvaluateResult;
  if (result.exceptionDetails) return undefined;
  const value = result.result?.value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(
      (x): x is RawLongTask =>
        x !== null &&
        typeof x === "object" &&
        typeof (x as RawLongTask).startTime === "number" &&
        typeof (x as RawLongTask).duration === "number",
    );
  } catch {
    return undefined;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
