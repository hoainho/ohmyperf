import type {
  CDPSessionLike,
  DriverCapability,
  Logger,
  LongTask,
  Metric,
  Resource,
} from "./types.js";

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

  const merged: CollectorResult = {
    metrics,
    longTasks,
    resources,
    available,
    ...(reasons.length > 0 ? { reason: reasons.join("; ") } : {}),
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
