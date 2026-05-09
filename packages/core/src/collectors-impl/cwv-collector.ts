import {
  type CollectorContext,
  type CollectorFactory,
  type CollectorHandle,
  type CollectorResult,
  emptyCollectorResult,
} from "../collectors.js";
import type { CDPSessionLike, Metric } from "../types.js";
import { CWV_INLINE_SCRIPT } from "./cwv-inline-script.js";

interface CwvSnapshot {
  lcp?: number;
  cls?: number;
  inp?: number;
  fcp?: number;
  ttfb?: number;
}

interface RuntimeEvaluateResult {
  result?: { type: string; value?: unknown };
  exceptionDetails?: { text?: string };
}

export const cwvCollectorFactory: CollectorFactory = {
  id: "ohmyperf.cwv",
  requires: [],
  async create(session: CDPSessionLike, ctx: CollectorContext): Promise<CollectorHandle> {
    let installed = false;
    try {
      await session.send("Runtime.enable");
      await session.send("Page.enable");
      await session.send("Page.addScriptToEvaluateOnNewDocument", {
        source: CWV_INLINE_SCRIPT,
        runImmediately: true,
      });
      installed = true;
    } catch (err) {
      ctx.logger.debug("cwv-collector: install failed", {
        frameId: ctx.frameId,
        error: errMessage(err),
      });
    }

    return {
      id: cwvCollectorFactory.id,
      async finalize(): Promise<CollectorResult> {
        if (!installed) {
          return emptyCollectorResult("cwv-script-injection-failed");
        }
        try {
          const snapshot = await readSnapshot(session);
          if (!snapshot) {
            return emptyCollectorResult("cwv-snapshot-unavailable");
          }
          const metrics: Record<string, Metric> = {};
          if (typeof snapshot.lcp === "number" && Number.isFinite(snapshot.lcp)) {
            metrics["lcp"] = { name: "lcp", value: snapshot.lcp, unit: "ms" };
          }
          if (typeof snapshot.cls === "number" && Number.isFinite(snapshot.cls)) {
            metrics["cls"] = { name: "cls", value: snapshot.cls, unit: "score" };
          }
          if (typeof snapshot.inp === "number" && Number.isFinite(snapshot.inp)) {
            metrics["inp"] = { name: "inp", value: snapshot.inp, unit: "ms" };
          }
          if (typeof snapshot.fcp === "number" && Number.isFinite(snapshot.fcp)) {
            metrics["fcp"] = { name: "fcp", value: snapshot.fcp, unit: "ms" };
          }
          if (typeof snapshot.ttfb === "number" && Number.isFinite(snapshot.ttfb)) {
            metrics["ttfb"] = { name: "ttfb", value: snapshot.ttfb, unit: "ms" };
          }
          return {
            metrics,
            longTasks: [],
            resources: [],
            available: true,
          };
        } catch (err) {
          return emptyCollectorResult(`cwv-finalize-error: ${errMessage(err)}`);
        }
      },
      async dispose(): Promise<void> {
        return undefined;
      },
    };
  },
};

async function readSnapshot(session: CDPSessionLike): Promise<CwvSnapshot | undefined> {
  const expression = "JSON.stringify(window.__ohmyperfCwv || null)";
  const result = (await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: false,
  })) as RuntimeEvaluateResult;

  if (result.exceptionDetails) return undefined;
  const value = result.result?.value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null || typeof parsed !== "object") return undefined;
    return parsed as CwvSnapshot;
  } catch {
    return undefined;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
