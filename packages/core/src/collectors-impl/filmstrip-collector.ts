import {
  type CollectorContext,
  type CollectorFactory,
  type CollectorHandle,
  type CollectorResult,
  emptyCollectorResult,
} from "../collectors.js";
import { frameChanged } from "../frame-diff.js";
import type { VisChange } from "../full-load.js";
import type { CDPSessionLike } from "../types.js";

/** Shared mutable handle so the engine's settle loop can wait for visual quiet. */
export interface FilmstripSink {
  last: number; // ms-from-navigationStart of the most recent visual change
}

export interface FilmstripOptions {
  /** Byte-diff threshold (FullLoadConfig.visualDiffEpsilon); suppresses near-identical frames. */
  readonly epsilon: number;
  /** Hard cap on frames processed (memory/backpressure guard). */
  readonly maxFrames?: number;
  /** Optional sink updated on each visual change so the engine can wait for visual settle. */
  readonly sink?: FilmstripSink;
}

interface ScreencastFrame {
  data?: string;
  sessionId?: number;
}

/**
 * Captures the visual timeline via CDP Page.startScreencast (compositor-change-driven), recording a
 * `vis` change at each frame that differs from the previous one. Produces `visChanges` (timestamps
 * from navigationStart) which the FLT `visual` signal consumes → visuallyCompleteAt + a `visual`
 * gating phase. Opt-in (the engine only installs it when --filmstrip / FullLoadConfig.visual).
 */
export function createFilmstripCollectorFactory(opts: FilmstripOptions): CollectorFactory {
  const maxFrames = opts.maxFrames ?? 600;
  return {
    id: "ohmyperf.filmstrip",
    requires: [],
    async create(session: CDPSessionLike, ctx: CollectorContext): Promise<CollectorHandle> {
      const noop: CollectorHandle = {
        id: "ohmyperf.filmstrip",
        async finalize(): Promise<CollectorResult> {
          return emptyCollectorResult();
        },
        async dispose(): Promise<void> {
          return undefined;
        },
      };
      // Only the root frame drives the page-level visual timeline.
      if (!ctx.isRoot) return noop;

      const vis: VisChange[] = [];
      let prev: string | null = null;
      let frames = 0;
      let installed = false;
      let stopped = false;

      const onFrame = (raw: unknown): void => {
        if (stopped) return; // ignore in-flight frames after finalize (no stale acks/processing)
        const f = raw as ScreencastFrame;
        if (typeof f.sessionId === "number") {
          void Promise.resolve(session.send("Page.screencastFrameAck", { sessionId: f.sessionId })).catch(
            () => undefined,
          );
        }
        if (frames >= maxFrames) return;
        const data = typeof f.data === "string" ? f.data : "";
        if (data.length === 0) return;
        frames++;
        if (frameChanged(prev, data, opts.epsilon)) {
          // Engine-clock ms-from-navigationStart. Slightly later than the page's performance.now()
          // (timeOrigin commits inside goto), so it biases visuallyCompleteAt *later* — conservative
          // (never reports the page done before it is). Do NOT mix with in-page perf.now() timestamps.
          const t = Date.now() - ctx.navigationStart;
          vis.push({ t });
          if (opts.sink && t > opts.sink.last) opts.sink.last = t;
        }
        prev = data;
      };

      try {
        await session.send("Page.enable");
        session.on("Page.screencastFrame", onFrame);
        await session.send("Page.startScreencast", {
          format: "jpeg",
          quality: 40,
          maxWidth: 600,
          maxHeight: 600,
          everyNthFrame: 1,
        });
        installed = true;
      } catch (err) {
        ctx.logger.debug("filmstrip-collector: install failed", {
          frameId: ctx.frameId,
          error: errMessage(err),
        });
      }

      const stopOnce = async (): Promise<void> => {
        if (stopped) return; // idempotent — finalize() and dispose() both call this
        stopped = true;
        try {
          await session.send("Page.stopScreencast");
        } catch {
          // best-effort
        }
      };

      return {
        id: "ohmyperf.filmstrip",
        async finalize(): Promise<CollectorResult> {
          if (!installed) return emptyCollectorResult("filmstrip-install-failed");
          await stopOnce();
          return { metrics: {}, longTasks: [], resources: [], available: true, visChanges: vis };
        },
        async dispose(): Promise<void> {
          await stopOnce();
        },
      };
    },
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
