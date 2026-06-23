import type { CpuInterval, DomBatch, NetRequest, VisChange } from "./full-load.js";
import type {
  CDPSessionLike,
  DomTopology,
  DriverCapability,
  Logger,
  LongTask,
  Metric,
  Resource,
} from "./types.js";

/** Raw Full-Load activity streams produced by the full-load collector (root frame only). */
export interface FullLoadSignals {
  readonly net: readonly NetRequest[];
  readonly dom: readonly DomBatch[];
  readonly cpu: readonly CpuInterval[];
  readonly vis?: readonly VisChange[];
  /** Navigation-timing-sourced checkpoints (more reliable than lifecycle events). */
  readonly subTimeline?: {
    readonly ttfb: number | null;
    readonly fcp: number | null;
    readonly domContentLoaded: number | null;
    readonly loadEventEnd: number | null;
  };
}

export interface CollectorContext {
  readonly logger: Logger;
  readonly frameId: string;
  readonly isRoot: boolean;
  readonly url: string;
  readonly navigationStart: number;
}

export interface CollectorResult {
  readonly metrics: Readonly<Record<string, Metric>>;
  readonly longTasks: readonly LongTask[];
  readonly resources: readonly Resource[];
  readonly available: boolean;
  readonly reason?: string;
  /** Full-Load activity streams (set only by the full-load collector on the root frame). */
  readonly fullLoadSignals?: FullLoadSignals;
  /** DOM topology snapshot (set only by the dom-topology collector on the root frame, when diagnose is on). */
  readonly domTopology?: DomTopology;
  /** Visual-change timeline (set only by the filmstrip collector on the root frame, when --filmstrip is on). */
  readonly visChanges?: readonly VisChange[];
}

export interface CollectorHandle {
  readonly id: string;
  finalize(): Promise<CollectorResult>;
  dispose(): Promise<void>;
}

export interface CollectorFactory {
  readonly id: string;
  readonly requires: ReadonlyArray<DriverCapability>;
  create(session: CDPSessionLike, ctx: CollectorContext): Promise<CollectorHandle>;
}

export function emptyCollectorResult(reason?: string): CollectorResult {
  const result: CollectorResult = {
    metrics: {},
    longTasks: [],
    resources: [],
    available: reason === undefined,
    ...(reason !== undefined ? { reason } : {}),
  };
  return result;
}

export function mergeCollectorResults(results: readonly CollectorResult[]): CollectorResult {
  const metrics: Record<string, Metric> = {};
  const longTasks: LongTask[] = [];
  const resources: Resource[] = [];
  let available = true;
  const reasons: string[] = [];

  for (const r of results) {
    for (const [name, metric] of Object.entries(r.metrics)) {
      metrics[name] = metric;
    }
    longTasks.push(...r.longTasks);
    resources.push(...r.resources);
    if (!r.available) {
      available = false;
      if (r.reason) reasons.push(r.reason);
    }
  }

  const fullLoadSignals = results.find((r) => r.fullLoadSignals)?.fullLoadSignals;
  const domTopology = results.find((r) => r.domTopology)?.domTopology;
  const visChanges = results.find((r) => r.visChanges)?.visChanges;
  const merged: CollectorResult = {
    metrics,
    longTasks,
    resources,
    available,
    ...(reasons.length > 0 ? { reason: reasons.join("; ") } : {}),
    ...(fullLoadSignals ? { fullLoadSignals } : {}),
    ...(domTopology ? { domTopology } : {}),
    ...(visChanges ? { visChanges } : {}),
  };
  return merged;
}

export class CollectorTimeoutError extends Error {
  public override readonly name = "CollectorTimeoutError";
}

export async function withCollectorTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new CollectorTimeoutError(`${what} timed out after ${String(ms)}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
