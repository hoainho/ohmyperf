import {
  type CollectorContext,
  type CollectorFactory,
  type CollectorHandle,
  type CollectorResult,
  emptyCollectorResult,
} from "../collectors.js";
import type { CDPSessionLike, Metric } from "../types.js";

interface LifecycleEvent {
  frameId: string;
  loaderId: string;
  name: string;
  timestamp: number;
}

interface PerformanceMetric {
  name: string;
  value: number;
}

interface PerformanceGetMetricsResult {
  metrics: PerformanceMetric[];
}

const TRACKED_LIFECYCLE = new Set([
  "navigationStart",
  "DOMContentLoaded",
  "load",
  "firstPaint",
  "firstContentfulPaint",
]);

export const loadingCollectorFactory: CollectorFactory = {
  id: "ohmyperf.loading",
  requires: [],
  async create(session: CDPSessionLike, ctx: CollectorContext): Promise<CollectorHandle> {
    const lifecycle = new Map<string, number>();
    let installed = false;

    try {
      await session.send("Page.enable");
      await session.send("Page.setLifecycleEventsEnabled", { enabled: true });
      await session.send("Performance.enable");
      installed = true;
    } catch (err) {
      ctx.logger.debug("loading-collector: install failed", {
        frameId: ctx.frameId,
        error: errMessage(err),
      });
    }

    session.on("Page.lifecycleEvent", (raw: unknown) => {
      const event = raw as LifecycleEvent;
      if (!TRACKED_LIFECYCLE.has(event.name)) return;
      if (lifecycle.has(event.name)) return;
      lifecycle.set(event.name, event.timestamp * 1_000_000);
    });

    return {
      id: loadingCollectorFactory.id,
      async finalize(): Promise<CollectorResult> {
        if (!installed) return emptyCollectorResult("loading-collector-install-failed");

        const metrics: Record<string, Metric> = {};

        const navStartUs = lifecycle.get("navigationStart");
        const dclUs = lifecycle.get("DOMContentLoaded");
        const loadUs = lifecycle.get("load");

        if (navStartUs !== undefined) {
          const navStartMs = navStartUs / 1000;
          if (dclUs !== undefined) {
            const ms = dclUs / 1000 - navStartMs;
            if (Number.isFinite(ms) && ms >= 0 && ms < 600_000) {
              metrics["domContentLoaded"] = {
                name: "domContentLoaded",
                value: ms,
                unit: "ms",
              };
            }
          }
          if (loadUs !== undefined) {
            const ms = loadUs / 1000 - navStartMs;
            if (Number.isFinite(ms) && ms >= 0 && ms < 600_000) {
              metrics["load"] = { name: "load", value: ms, unit: "ms" };
            }
          }
        }

        try {
          await session.send("Performance.getMetrics");
        } catch (err) {
          ctx.logger.debug("loading-collector: Performance.getMetrics failed", {
            error: errMessage(err),
          });
        }

        return { metrics, longTasks: [], resources: [], available: true };
      },
      async dispose(): Promise<void> {
        return undefined;
      },
    };
  },
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
