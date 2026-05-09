import { describe, expect, it } from "vitest";
import { resourceCollectorFactory } from "./resource-collector.js";
import { createSilentLogger } from "../logger.js";
import type { CDPSessionLike } from "../types.js";

function makeMockSession(): {
  session: CDPSessionLike;
  emit: (method: string, payload: unknown) => void;
  sent: Array<{ method: string; params: unknown }>;
} {
  const handlers = new Map<string, Array<(p: unknown) => void>>();
  const sent: Array<{ method: string; params: unknown }> = [];
  const session: CDPSessionLike = {
    async send(method, params) {
      sent.push({ method, params });
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
  return { session, emit, sent };
}

describe("resourceCollectorFactory", () => {
  it("enables Network on create and records a successful request", async () => {
    const { session, emit, sent } = makeMockSession();
    const handle = await resourceCollectorFactory.create(session, {
      logger: createSilentLogger(),
      frameId: "root",
      isRoot: true,
      url: "http://example.com/",
      navigationStart: 0,
    });

    expect(sent.find((s) => s.method === "Network.enable")).toBeDefined();

    emit("Network.requestWillBeSent", {
      requestId: "1",
      loaderId: "L1",
      documentURL: "http://example.com/",
      request: { url: "http://example.com/main.js", method: "GET", headers: {}, initialPriority: "High" },
      timestamp: 100.0,
      wallTime: 1700000000,
      type: "Script",
    });
    emit("Network.responseReceived", {
      requestId: "1",
      loaderId: "L1",
      timestamp: 100.05,
      type: "Script",
      response: {
        url: "http://example.com/main.js",
        status: 200,
        statusText: "OK",
        mimeType: "application/javascript",
        encodedDataLength: 0,
        headers: {},
        timing: {
          requestTime: 100.0,
          dnsStart: 1.0,
          dnsEnd: 4.0,
          connectStart: 4.0,
          connectEnd: 12.0,
          sslStart: 5.0,
          sslEnd: 12.0,
          sendStart: 12.0,
          sendEnd: 12.5,
          receiveHeadersEnd: 50.0,
        },
      },
      willBeSentAsRenderBlocking: false,
    });
    emit("Network.loadingFinished", {
      requestId: "1",
      timestamp: 100.2,
      encodedDataLength: 1234,
    });

    const result = await handle.finalize();
    expect(result.available).toBe(true);
    expect(result.resources).toHaveLength(1);
    const r = result.resources[0]!;
    expect(r.url).toBe("http://example.com/main.js");
    expect(r.mimeType).toBe("application/javascript");
    expect(r.encodedSizeBytes).toBe(1234);
    expect(r.transferSizeBytes).toBe(1234);
    expect(r.cacheHit).toBe(false);
    expect(r.renderBlocking).toBe(false);
    expect(r.requestMs).toBeGreaterThan(0);
    expect(r.responseMs).toBeGreaterThan(0);
    expect(r.dnsMs).toBe(3);
    expect(r.tcpMs).toBe(8);
    expect(r.tlsMs).toBe(7);
  });

  it("flags render-blocking when CDP says so", async () => {
    const { session, emit } = makeMockSession();
    const handle = await resourceCollectorFactory.create(session, {
      logger: createSilentLogger(),
      frameId: "root",
      isRoot: true,
      url: "http://example.com/",
      navigationStart: 0,
    });

    emit("Network.requestWillBeSent", {
      requestId: "css1",
      loaderId: "L1",
      documentURL: "http://example.com/",
      request: { url: "http://example.com/style.css", method: "GET", headers: {}, initialPriority: "VeryHigh" },
      timestamp: 100.0,
      wallTime: 1700000000,
      type: "Stylesheet",
    });
    emit("Network.responseReceived", {
      requestId: "css1",
      loaderId: "L1",
      timestamp: 100.02,
      type: "Stylesheet",
      response: {
        url: "http://example.com/style.css",
        status: 200,
        statusText: "OK",
        mimeType: "text/css",
        encodedDataLength: 0,
        headers: {},
      },
      willBeSentAsRenderBlocking: true,
    });
    emit("Network.loadingFinished", { requestId: "css1", timestamp: 100.04, encodedDataLength: 500 });

    const result = await handle.finalize();
    expect(result.resources[0]!.renderBlocking).toBe(true);
  });

  it("falls back to type-based render-blocking heuristic when CDP doesn't tell us", async () => {
    const { session, emit } = makeMockSession();
    const handle = await resourceCollectorFactory.create(session, {
      logger: createSilentLogger(),
      frameId: "root",
      isRoot: true,
      url: "http://example.com/",
      navigationStart: 0,
    });
    emit("Network.requestWillBeSent", {
      requestId: "doc1",
      loaderId: "L1",
      documentURL: "http://example.com/",
      request: { url: "http://example.com/", method: "GET", headers: {}, initialPriority: "VeryHigh" },
      timestamp: 100.0,
      wallTime: 1700000000,
      type: "Document",
    });
    emit("Network.responseReceived", {
      requestId: "doc1",
      loaderId: "L1",
      timestamp: 100.01,
      type: "Document",
      response: {
        url: "http://example.com/",
        status: 200,
        statusText: "OK",
        mimeType: "text/html",
        encodedDataLength: 0,
        headers: {},
      },
    });
    emit("Network.loadingFinished", { requestId: "doc1", timestamp: 100.02, encodedDataLength: 1000 });

    const result = await handle.finalize();
    expect(result.resources[0]!.renderBlocking).toBe(true);
  });

  it("marks cache hits and reports zero transferSize", async () => {
    const { session, emit } = makeMockSession();
    const handle = await resourceCollectorFactory.create(session, {
      logger: createSilentLogger(),
      frameId: "root",
      isRoot: true,
      url: "http://example.com/",
      navigationStart: 0,
    });
    emit("Network.requestWillBeSent", {
      requestId: "img1",
      loaderId: "L1",
      documentURL: "http://example.com/",
      request: { url: "http://example.com/logo.png", method: "GET", headers: {}, initialPriority: "Low" },
      timestamp: 100.0,
      wallTime: 1700000000,
      type: "Image",
    });
    emit("Network.responseReceived", {
      requestId: "img1",
      loaderId: "L1",
      timestamp: 100.001,
      type: "Image",
      response: {
        url: "http://example.com/logo.png",
        status: 200,
        statusText: "OK",
        mimeType: "image/png",
        fromDiskCache: true,
        encodedDataLength: 0,
        headers: {},
      },
    });
    emit("Network.loadingFinished", { requestId: "img1", timestamp: 100.002, encodedDataLength: 8192 });

    const result = await handle.finalize();
    const r = result.resources[0]!;
    expect(r.cacheHit).toBe(true);
    expect(r.transferSizeBytes).toBe(0);
    expect(r.encodedSizeBytes).toBe(8192);
  });

  it("drops canceled requests but keeps successful ones", async () => {
    const { session, emit } = makeMockSession();
    const handle = await resourceCollectorFactory.create(session, {
      logger: createSilentLogger(),
      frameId: "root",
      isRoot: true,
      url: "http://example.com/",
      navigationStart: 0,
    });
    emit("Network.requestWillBeSent", {
      requestId: "kept",
      loaderId: "L1",
      documentURL: "http://example.com/",
      request: { url: "http://example.com/a", method: "GET", headers: {}, initialPriority: "Low" },
      timestamp: 100.0,
      wallTime: 0,
      type: "Other",
    });
    emit("Network.responseReceived", {
      requestId: "kept",
      loaderId: "L1",
      timestamp: 100.1,
      type: "Other",
      response: {
        url: "http://example.com/a",
        status: 200,
        statusText: "OK",
        mimeType: "text/plain",
        encodedDataLength: 0,
        headers: {},
      },
    });
    emit("Network.loadingFinished", { requestId: "kept", timestamp: 100.2, encodedDataLength: 10 });
    emit("Network.requestWillBeSent", {
      requestId: "canceled",
      loaderId: "L1",
      documentURL: "http://example.com/",
      request: { url: "http://example.com/b", method: "GET", headers: {}, initialPriority: "Low" },
      timestamp: 100.0,
      wallTime: 0,
      type: "Other",
    });
    emit("Network.loadingFailed", {
      requestId: "canceled",
      timestamp: 100.05,
      type: "Other",
      errorText: "net::ERR_ABORTED",
      canceled: true,
    });

    const result = await handle.finalize();
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]!.url).toBe("http://example.com/a");
  });
});
