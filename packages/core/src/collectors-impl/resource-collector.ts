import {
  type CollectorContext,
  type CollectorFactory,
  type CollectorHandle,
  type CollectorResult,
  emptyCollectorResult,
} from "../collectors.js";
import type { CDPSessionLike, Resource } from "../types.js";

interface RequestWillBeSentParams {
  requestId: string;
  loaderId: string;
  documentURL: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    initialPriority: string;
  };
  timestamp: number;
  wallTime: number;
  initiator?: { type: string; url?: string };
  type?: string;
  redirectResponse?: ResponseLike;
}

interface ResponseLike {
  url: string;
  status: number;
  statusText: string;
  mimeType: string;
  fromDiskCache?: boolean;
  fromPrefetchCache?: boolean;
  fromServiceWorker?: boolean;
  encodedDataLength?: number;
  timing?: ResourceTiming | null;
}

interface ResourceTiming {
  requestTime: number;
  dnsStart: number;
  dnsEnd: number;
  connectStart: number;
  connectEnd: number;
  sslStart: number;
  sslEnd: number;
  sendStart: number;
  sendEnd: number;
  receiveHeadersStart?: number;
  receiveHeadersEnd: number;
}

interface ResponseReceivedParams {
  requestId: string;
  loaderId: string;
  timestamp: number;
  type: string;
  response: ResponseLike & {
    encodedDataLength: number;
    headers: Record<string, string>;
  };
  hasExtraInfo?: boolean;
  willBeSentAsRenderBlocking?: boolean;
}

interface LoadingFinishedParams {
  requestId: string;
  timestamp: number;
  encodedDataLength: number;
}

interface LoadingFailedParams {
  requestId: string;
  timestamp: number;
  type: string;
  errorText: string;
  canceled?: boolean;
}

const RENDER_BLOCKING_TYPES = new Set(["Stylesheet", "Document"]);

interface InFlight {
  url: string;
  startedAt: number;
  initiatorType: string;
  type: string;
  willBeRenderBlocking: boolean;
  response?: ResponseReceivedParams["response"];
  responseAt?: number;
  finishedAt?: number;
  finalEncodedDataLength?: number;
  failed?: { errorText: string; canceled: boolean };
  responseRenderBlocking?: boolean;
}

export const resourceCollectorFactory: CollectorFactory = {
  id: "ohmyperf.resources",
  requires: [],
  async create(session: CDPSessionLike, ctx: CollectorContext): Promise<CollectorHandle> {
    const inFlight = new Map<string, InFlight>();
    let installed = false;

    try {
      await session.send("Network.enable", { maxResourceBufferSize: 5_000_000 });
      installed = true;
    } catch (err) {
      ctx.logger.debug("resource-collector: Network.enable failed", {
        frameId: ctx.frameId,
        error: errMessage(err),
      });
    }

    session.on("Network.requestWillBeSent", (raw: unknown) => {
      const p = raw as RequestWillBeSentParams;
      if (p.redirectResponse !== undefined) {
        const prior = inFlight.get(p.requestId);
        if (prior) {
          prior.response = p.redirectResponse as ResponseReceivedParams["response"];
          prior.responseAt = p.timestamp;
          prior.finishedAt = p.timestamp;
          prior.finalEncodedDataLength = p.redirectResponse.encodedDataLength ?? 0;
        }
      }
      inFlight.set(p.requestId, {
        url: p.request.url,
        startedAt: p.timestamp,
        initiatorType: p.initiator?.type ?? "other",
        type: p.type ?? "Other",
        willBeRenderBlocking: RENDER_BLOCKING_TYPES.has(p.type ?? ""),
      });
    });

    session.on("Network.responseReceived", (raw: unknown) => {
      const p = raw as ResponseReceivedParams;
      const entry = inFlight.get(p.requestId);
      if (!entry) return;
      entry.response = p.response;
      entry.responseAt = p.timestamp;
      if (p.willBeSentAsRenderBlocking !== undefined) {
        entry.responseRenderBlocking = p.willBeSentAsRenderBlocking;
      }
    });

    session.on("Network.loadingFinished", (raw: unknown) => {
      const p = raw as LoadingFinishedParams;
      const entry = inFlight.get(p.requestId);
      if (!entry) return;
      entry.finishedAt = p.timestamp;
      entry.finalEncodedDataLength = p.encodedDataLength;
    });

    session.on("Network.loadingFailed", (raw: unknown) => {
      const p = raw as LoadingFailedParams;
      const entry = inFlight.get(p.requestId);
      if (!entry) return;
      entry.failed = { errorText: p.errorText, canceled: p.canceled === true };
      entry.finishedAt = p.timestamp;
    });

    return {
      id: resourceCollectorFactory.id,
      async finalize(): Promise<CollectorResult> {
        if (!installed) return emptyCollectorResult("resource-collector-install-failed");

        const resources: Resource[] = [];
        for (const entry of inFlight.values()) {
          if (entry.failed && entry.failed.canceled) continue;
          if (!entry.response || entry.responseAt === undefined) continue;
          resources.push(buildResource(entry));
        }

        return {
          metrics: {},
          longTasks: [],
          resources,
          available: true,
        };
      },
      async dispose(): Promise<void> {
        return undefined;
      },
    };
  },
};

function buildResource(entry: InFlight): Resource {
  const response = entry.response!;
  const timing = response.timing;
  const responseAt = entry.responseAt!;
  const finishedAt = entry.finishedAt ?? responseAt;

  const requestMs = clampNonNegative((responseAt - entry.startedAt) * 1000);
  const responseMs = clampNonNegative((finishedAt - responseAt) * 1000);

  const cacheHit = Boolean(
    response.fromDiskCache || response.fromPrefetchCache || response.fromServiceWorker,
  );

  const renderBlocking =
    entry.responseRenderBlocking ?? entry.willBeRenderBlocking ?? false;

  const encodedSizeBytes = entry.finalEncodedDataLength ?? response.encodedDataLength ?? 0;
  const decodedSizeBytes = encodedSizeBytes;
  const transferSizeBytes = cacheHit ? 0 : encodedSizeBytes;

  const result: Resource = {
    url: entry.url,
    mimeType: response.mimeType ?? "",
    requestMs,
    responseMs,
    transferSizeBytes,
    encodedSizeBytes,
    decodedSizeBytes,
    renderBlocking,
    cacheHit,
  };

  if (timing) {
    const dns = nonNegativeDelta(timing.dnsEnd, timing.dnsStart);
    const tcp = nonNegativeDelta(timing.connectEnd, timing.connectStart);
    const tls = nonNegativeDelta(timing.sslEnd, timing.sslStart);
    return {
      ...result,
      ...(dns !== undefined ? { dnsMs: dns } : {}),
      ...(tcp !== undefined ? { tcpMs: tcp } : {}),
      ...(tls !== undefined ? { tlsMs: tls } : {}),
    };
  }
  return result;
}

function nonNegativeDelta(end: number, start: number): number | undefined {
  if (!Number.isFinite(end) || !Number.isFinite(start)) return undefined;
  if (end < 0 || start < 0) return undefined;
  const d = end - start;
  if (d < 0 || d > 60_000) return undefined;
  return d;
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
