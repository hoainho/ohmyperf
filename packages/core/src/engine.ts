import { randomUUID } from "node:crypto";
import { arch as osArch, platform as osPlatform, release as osRelease } from "node:os";
import {
  type CollectorContext,
  type CollectorFactory,
  type CollectorHandle,
  type CollectorResult,
  emptyCollectorResult,
  mergeCollectorResults,
} from "./collectors.js";
import { cwvCollectorFactory } from "./collectors-impl/cwv-collector.js";
import { loadingCollectorFactory } from "./collectors-impl/loading-collector.js";
import { longTaskCollectorFactory } from "./collectors-impl/longtask-collector.js";
import { computeRenderBlockingOpportunity } from "./collectors-impl/render-blocking.js";
import { resourceCollectorFactory } from "./collectors-impl/resource-collector.js";
import { fullLoadCollectorFactory } from "./collectors-impl/full-load-collector.js";
import { domTopologyCollectorFactory } from "./collectors-impl/dom-topology-collector.js";
import {
  createFilmstripCollectorFactory,
  type FilmstripSink,
} from "./collectors-impl/filmstrip-collector.js";
import { createTraceCollector } from "./collectors-impl/trace-collector.js";
import { computeFullLoad, FULL_LOAD_DEFAULTS } from "./full-load.js";
import { computeHotspots } from "./hotspots.js";
import { evaluateRx } from "./rx.js";
import type { FullLoadConfig, FullLoadReport, FullLoadResult } from "./types.js";
import { applyEmulation, calibrate, type CalibrationResult } from "./calibration.js";
import {
  buildFixPlan,
  classifyOrigin,
  classifyServability,
  computeTrustScore,
  parseOriginInfo,
} from "./llm-signals/index.js";
import { resolveOrgDomains } from "./llm-signals/origin-class.js";
import { createConsoleLogger, createSilentLogger } from "./logger.js";
import {
  createPluginRuntime,
  loadPlugins,
  type PluginRuntime,
} from "./plugin-runtime.js";
import type {
  AggregatedMetric,
  AggregatedMetrics,
  CDPSessionLike,
  Driver,
  FrameNode,
  FrameTree,
  HeadlessMode,
  Logger,
  LongTask,
  MeasureOptions,
  Metric,
  Mode,
  Opportunity,
  Report,
  ReportCtx,
  ReportMeta,
  RunCtx,
  RunReport,
} from "./types.js";

export interface EngineLaunchAdapter {
  launchPageWithCdp(): Promise<EnginePageContext>;
}

export interface EnginePageContext {
  readonly browserVersion: string;
  readonly browserSource: "bundled" | "system" | "extension-host";
  readonly rootSession: CDPSessionLike;
  readonly attachedFrames: ReadonlyArray<EngineAttachedFrame>;
  goto(url: string): Promise<void>;
  waitForLoadIdle(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

export interface EngineAttachedFrame {
  readonly frameId: string;
  readonly url: string;
  readonly isOOPIF: boolean;
  readonly session: CDPSessionLike | null;
}

export interface EngineRunOptions {
  readonly opts: MeasureOptions;
  readonly driver: Driver;
  readonly adapter: EngineLaunchAdapter;
  readonly logger?: Logger;
  readonly collectors?: ReadonlyArray<CollectorFactory>;
}

export const DEFAULT_COLLECTOR_FACTORIES: ReadonlyArray<CollectorFactory> = [
  cwvCollectorFactory,
  loadingCollectorFactory,
  longTaskCollectorFactory,
  resourceCollectorFactory,
  fullLoadCollectorFactory,
];

const DEFAULT_RUNS = 5;
const DEFAULT_HEADLESS: HeadlessMode = "headless";
const DEFAULT_MODE: Mode = "real";
const ROOT_FRAME_ID = "ohmyperf:root";
const LOAD_IDLE_TIMEOUT_MS = 30_000;

export async function runEngine(input: EngineRunOptions): Promise<Report> {
  const { opts, driver, adapter, collectors } = input;
  const logger = input.logger ?? createSilentLogger();

  const runs = opts.runs ?? DEFAULT_RUNS;
  const fullLoadConfig: FullLoadConfig = { ...FULL_LOAD_DEFAULTS, ...(opts.fullLoad ?? {}) };

  const diagnoseEnabled = opts.diagnose === true || opts.rx === true;
  const visualEnabled = fullLoadConfig.visual === true;
  // Shared, per-run-reset sink so the settle loop can wait for visual quiet (runs are sequential).
  const visSink: FilmstripSink = { last: 0 };
  const baseFactories = collectors ?? DEFAULT_COLLECTOR_FACTORIES;
  const factories = [
    ...baseFactories,
    ...(diagnoseEnabled ? [domTopologyCollectorFactory] : []),
    ...(visualEnabled
      ? [createFilmstripCollectorFactory({ epsilon: fullLoadConfig.visualDiffEpsilon, sink: visSink })]
      : []),
  ];

  const headless = opts.headless ?? DEFAULT_HEADLESS;
  const mode = opts.mode ?? DEFAULT_MODE;
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  const plugins = loadPlugins(opts.plugins ?? []);
  const pluginRuntime = createPluginRuntime({ plugins, driver, logger });
  await pluginRuntime.setup();

  let calibration: CalibrationResult | undefined;
  if (mode === "ci-stable") {
    logger.info("engine: running CPU calibration (mode=ci-stable)");
    calibration = await calibrate({
      driver,
      adapter,
      logger,
      networkProfile: "fast-4g",
      ...(opts.calibration?.recalibrate ? { recalibrate: true } : {}),
    });
    logger.info("engine: calibration done", {
      throttleRate: calibration.throttleRate,
      observedScore: calibration.observedScore,
      cacheHit: calibration.cacheHit,
    });
  }

  const runReports: RunReport[] = [];
  const frameNodes: Record<string, FrameNode> = {};
  let browserVersion = driver.browserVersion;
  let browserSource: "bundled" | "system" | "extension-host" = "bundled";

  for (let i = 0; i < runs; i++) {
    logger.debug("engine: starting run", { runIndex: i, url: opts.url });
    visSink.last = 0; // reset visual-settle tracker for this run
    const pageCtx = await adapter.launchPageWithCdp();
    browserVersion = pageCtx.browserVersion || browserVersion;
    browserSource = pageCtx.browserSource;

    const runCtx: RunCtx = {
      runIndex: i,
      driver: { id: driver.id },
      page: { id: `page:${String(i)}` },
      emit: () => undefined,
      logger,
      state: new Map<string, unknown>(),
      cdp: pageCtx.rootSession,
      async evaluateInPage<T = unknown>(expression: string): Promise<T | undefined> {
        try {
          const result = (await pageCtx.rootSession.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
          })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
          if (result.exceptionDetails) return undefined;
          return result.result?.value as T | undefined;
        } catch (err) {
          logger.debug("engine: evaluateInPage failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          return undefined;
        }
      },
      audit(audit) {
        pluginRuntime.emitAudit(pluginRuntime.activePluginId.id, audit);
      },
      setData(data) {
        pluginRuntime.setPluginData(pluginRuntime.activePluginId.id, data);
      },
      recordCapabilityUse(capability) {
        pluginRuntime.recordCapabilityUse(pluginRuntime.activePluginId.id, capability, "run");
      },
    };

    try {
      await pluginRuntime.beforeNavigate(runCtx);
      const navStartMs = Date.now();

      const rootCtx: CollectorContext = {
        logger,
        frameId: ROOT_FRAME_ID,
        isRoot: true,
        url: opts.url,
        navigationStart: navStartMs,
      };
      const rootHandles = await installCollectorsOn(
        pageCtx.rootSession,
        rootCtx,
        factories,
        driver,
        logger,
      );

      if (calibration) {
        await applyEmulation(pageCtx.rootSession, calibration, logger);
      }

      const traceEnabled = opts.collectTrace === true && mode !== "ci-stable";
      const traceCollector = traceEnabled
        ? createTraceCollector(pageCtx.rootSession, logger)
        : undefined;
      if (traceCollector) {
        try {
          await traceCollector.start();
        } catch (err) {
          logger.debug("engine: Tracing.start failed; continuing without trace", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await pageCtx.goto(opts.url);
      await pluginRuntime.onNavigate(runCtx, {
        url: opts.url,
        frameId: ROOT_FRAME_ID,
        type: "initial",
      });
      try {
        await pageCtx.waitForLoadIdle(LOAD_IDLE_TIMEOUT_MS);
      } catch (err) {
        logger.debug("engine: load-idle wait timed out", {
          runIndex: i,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await pluginRuntime.onLoad(runCtx);
      await pluginRuntime.onIdle(runCtx);

      if (opts.syntheticInteraction) {
        const cfg =
          typeof opts.syntheticInteraction === "string"
            ? { type: "auto-click" as const, selector: undefined, waitAfterMs: 500 }
            : { waitAfterMs: 500, ...opts.syntheticInteraction };
        const selector =
          cfg.selector ?? 'button,a,[role="button"],input[type="submit"],[tabindex="0"]';
        try {
          const boxResult = (await pageCtx.rootSession.send("Runtime.evaluate", {
            expression: `(function(){
              const t = document.querySelector(${JSON.stringify(selector)});
              if (!t) return null;
              const r = t.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return null;
              return { x: r.left + r.width/2, y: r.top + r.height/2, tag: t.tagName + (t.id ? '#' + t.id : '') };
            })()`,
            returnByValue: true,
            awaitPromise: false,
          })) as { result?: { value?: { x: number; y: number; tag: string } | null } } | undefined;
          const box = boxResult?.result?.value;
          if (box) {
            await pageCtx.rootSession.send("Input.dispatchMouseEvent", {
              type: "mousePressed",
              x: box.x,
              y: box.y,
              button: "left",
              clickCount: 1,
            });
            await pageCtx.rootSession.send("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              x: box.x,
              y: box.y,
              button: "left",
              clickCount: 1,
            });
            logger.debug("engine: syntheticInteraction dispatched", {
              runIndex: i,
              selector,
              target: box.tag,
            });
            await new Promise((r) => setTimeout(r, cfg.waitAfterMs ?? 500));
          } else {
            logger.warn("engine: syntheticInteraction target not found", {
              runIndex: i,
              selector,
            });
          }
        } catch (err) {
          logger.warn("engine: syntheticInteraction failed", {
            runIndex: i,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const frameResults: Record<string, CollectorResult> = {};
      const frameHandles: Array<{ frameId: string; handles: CollectorHandle[] }> = [];
      for (const f of pageCtx.attachedFrames) {
        if (f.session === null) continue;
        const fctx: CollectorContext = {
          logger,
          frameId: f.frameId,
          isRoot: false,
          url: f.url,
          navigationStart: navStartMs,
        };
        const handles = await installCollectorsOn(f.session, fctx, factories, driver, logger);
        frameHandles.push({ frameId: f.frameId, handles });
      }

      // Actively observe past network-idle until the page is genuinely settled — no significant DOM
      // mutation, no long task, and no new resource for a full settle window — so Full-Load Time
      // covers the WHOLE load (e.g. hydration/deferred JS that runs after the network goes quiet),
      // not just up to network-idle. Bounded by maxWait. Only the settle-based endpoints need this;
      // load-event and network-idle-2 are already resolved by waitForLoadIdle.
      if (fullLoadConfig.until === "fully-loaded" || fullLoadConfig.until === "visually-complete") {
        await waitForActivitySettle(
          pageCtx.rootSession,
          fullLoadConfig,
          navStartMs,
          logger,
          visualEnabled ? visSink : undefined,
        );
      }

      const rootFinal = await finalizeAll(rootHandles);
      for (const f of frameHandles) {
        frameResults[f.frameId] = await finalizeAll(f.handles);
      }

      let traceLongTasks: ReadonlyArray<LongTask> = [];
      if (traceCollector) {
        try {
          const result = await traceCollector.collect();
          traceLongTasks = result.longTasks;
        } catch (err) {
          logger.debug("engine: trace collection failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const mergedLongTasks: ReadonlyArray<LongTask> =
        traceLongTasks.length > 0 ? traceLongTasks : rootFinal.longTasks;

      const fcpValue = rootFinal.metrics["fcp"]?.value;
      const renderBlockingOpp = computeRenderBlockingOpportunity(rootFinal.resources, fcpValue);
      const opportunities: Opportunity[] = renderBlockingOpp ? [renderBlockingOpp] : [];

      const transformedMetrics = await applyOnMetric(rootFinal.metrics, runCtx, pluginRuntime);

      let fullLoadResult: FullLoadResult | undefined;
      if (rootFinal.fullLoadSignals) {
        const observedUntilMs = Date.now() - navStartMs;
        fullLoadResult = computeFullLoad(
          {
            net: rootFinal.fullLoadSignals.net,
            dom: rootFinal.fullLoadSignals.dom,
            cpu: rootFinal.fullLoadSignals.cpu,
            ...(rootFinal.visChanges ? { vis: rootFinal.visChanges } : {}),
            subTimeline: {
              ttfb:
                rootFinal.fullLoadSignals.subTimeline?.ttfb ?? metricVal(transformedMetrics, "ttfb"),
              fcp:
                rootFinal.fullLoadSignals.subTimeline?.fcp ?? metricVal(transformedMetrics, "fcp"),
              lcp: metricVal(transformedMetrics, "lcp"),
              domContentLoaded:
                rootFinal.fullLoadSignals.subTimeline?.domContentLoaded ??
                metricVal(transformedMetrics, "domContentLoaded"),
              loadEventEnd:
                rootFinal.fullLoadSignals.subTimeline?.loadEventEnd ??
                metricVal(transformedMetrics, "load"),
            },
            observedUntilMs,
          },
          fullLoadConfig,
        );
      }

      runReports.push(
        buildRunReport(i, {
          ...rootFinal,
          metrics: transformedMetrics,
          longTasks: mergedLongTasks,
          opportunities,
          ...(fullLoadResult ? { fullLoad: fullLoadResult } : {}),
        }),
      );

      if (i === 0) {
        frameNodes[ROOT_FRAME_ID] = {
          frameId: ROOT_FRAME_ID,
          url: opts.url,
          origin: safeOrigin(opts.url),
          parentFrameId: null,
          isOOPIF: false,
          isCrossOrigin: false,
          attachedAt: navStartMs,
          metrics: rootFinal.metrics,
          children: pageCtx.attachedFrames.map((f) => f.frameId),
        };
        for (const f of pageCtx.attachedFrames) {
          frameNodes[f.frameId] = {
            frameId: f.frameId,
            url: f.url,
            origin: safeOrigin(f.url),
            parentFrameId: ROOT_FRAME_ID,
            isOOPIF: f.isOOPIF,
            isCrossOrigin: safeOrigin(f.url) !== safeOrigin(opts.url),
            attachedAt: navStartMs,
            metrics: frameResults[f.frameId]?.metrics ?? {},
            children: [],
          };
        }
      }
    } finally {
      try {
        await pageCtx.close();
      } catch (err) {
        logger.debug("engine: pageCtx.close threw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const aggregated = aggregateRuns(runReports);
  const fullLoadReport = aggregateFullLoad(runReports, fullLoadConfig, aggregated);
  const durationMs = Date.now() - startedAtMs;

  const reportCtx: ReportCtx = { logger };
  await pluginRuntime.beforeReport(reportCtx);

  const unstable = isReportUnstable(aggregated);
  const meta = buildMeta({
    opts,
    runs,
    mode,
    headless,
    browserVersion,
    browserSource,
    startedAt,
    durationMs,
    pluginCapabilityUses: pluginRuntime.capabilityUses,
    unstable,
    calibration,
  });

  const reportOpportunities = aggregateOpportunities(runReports);

  const primaryOrigin = parseOriginInfo(opts.url);
  const envSource: Record<string, string | undefined> =
    typeof process !== "undefined" && process.env ? process.env : {};
  const orgDomains = resolveOrgDomains(opts.orgDomains, envSource);
  const enrichedRuns: RunReport[] = runReports.map((r) => ({
    ...r,
    resources: r.resources.map((res) => ({
      ...res,
      originClass: classifyOrigin(res.url, primaryOrigin, orgDomains),
    })),
  }));

  const servability = classifyServability({
    schemaVersion: "1.0.0",
    meta,
    runs: enrichedRuns,
    aggregated,
    frames: { root: ROOT_FRAME_ID, nodes: frameNodes } satisfies FrameTree,
    audits: [...pluginRuntime.audits],
    artifacts: {},
    pluginData: { ...pluginRuntime.pluginData },
    ...(reportOpportunities.length > 0 ? { opportunities: reportOpportunities } : {}),
  } as Report);

  const metaWithServability: ReportMeta = { ...meta, servability };

  const baseReport: Report = {
    schemaVersion: "1.0.0",
    meta: metaWithServability,
    runs: enrichedRuns,
    aggregated,
    frames: { root: ROOT_FRAME_ID, nodes: frameNodes } satisfies FrameTree,
    audits: [...pluginRuntime.audits],
    artifacts: {},
    pluginData: { ...pluginRuntime.pluginData },
    ...(reportOpportunities.length > 0 ? { opportunities: reportOpportunities } : {}),
    ...(fullLoadReport ? { fullLoad: fullLoadReport } : {}),
  };

  const trustScore = computeTrustScore(baseReport);
  const fixPlan = buildFixPlan(baseReport);

  let report: Report = {
    ...baseReport,
    trustScore,
    ...(fixPlan.length > 0 ? { fixPlan } : {}),
  };

  // Diagnose (hotspots) + remediate (Rx) — post-processing over the trust-scored report,
  // mirroring computeTrustScore/buildFixPlan. Gated on opts.diagnose/opts.rx.
  if (diagnoseEnabled) {
    const hotspots = computeHotspots(report);
    report = { ...report, hotspots };
    if (opts.rx === true) {
      const rx = evaluateRx(report);
      report = {
        ...report,
        recommendations: rx.recommendations,
        ...(rx.note !== undefined ? { remediationNote: rx.note } : {}),
      };
    }
  }

  report = await pluginRuntime.onReport(reportCtx, report);
  await pluginRuntime.teardown();
  return report;
}

async function applyOnMetric(
  metrics: Readonly<Record<string, Metric>>,
  runCtx: RunCtx,
  pluginRuntime: PluginRuntime,
): Promise<Record<string, Metric>> {
  if (pluginRuntime.plugins.length === 0) return { ...metrics };
  const out: Record<string, Metric> = {};
  for (const [name, metric] of Object.entries(metrics)) {
    out[name] = await pluginRuntime.onMetric(runCtx, metric);
  }
  return out;
}

async function installCollectorsOn(
  session: CDPSessionLike,
  ctx: CollectorContext,
  factories: ReadonlyArray<CollectorFactory>,
  driver: Driver,
  logger: Logger,
): Promise<CollectorHandle[]> {
  const handles: CollectorHandle[] = [];
  for (const factory of factories) {
    const supported = factory.requires.every((cap) => driver.supports(cap));
    if (!supported) {
      logger.debug("engine: collector skipped (driver capability missing)", {
        collectorId: factory.id,
        requires: factory.requires,
      });
      continue;
    }
    try {
      const handle = await factory.create(session, ctx);
      handles.push(handle);
    } catch (err) {
      logger.warn("engine: collector create() threw", {
        collectorId: factory.id,
        frameId: ctx.frameId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return handles;
}

async function finalizeAll(handles: ReadonlyArray<CollectorHandle>): Promise<CollectorResult> {
  const results: CollectorResult[] = [];
  for (const h of handles) {
    try {
      results.push(await h.finalize());
    } catch (err) {
      results.push(emptyCollectorResult(`${h.id}: ${err instanceof Error ? err.message : String(err)}`));
    }
    try {
      await h.dispose();
    } catch {
      /* dispose errors are non-fatal */
    }
  }
  return mergeCollectorResults(results);
}

function buildRunReport(
  runIndex: number,
  rootFinal: CollectorResult & {
    opportunities?: ReadonlyArray<Opportunity>;
    fullLoad?: FullLoadResult;
  },
): RunReport {
  const runtime: Record<string, number> = {};
  for (const [name, m] of Object.entries(rootFinal.metrics)) {
    if (name.startsWith("runtime.")) {
      runtime[name.slice("runtime.".length)] = m.value;
    }
  }
  // Inject FLT as a first-class metric for non-capped runs so the standard
  // median/p75/p95/CoV/outlier aggregation pipeline covers it. Capped runs are
  // excluded from the aggregate (they would skew the median toward maxWait).
  const metrics =
    rootFinal.fullLoad && !rootFinal.fullLoad.capped
      ? {
          ...rootFinal.metrics,
          fullLoad: { name: "fullLoad", value: rootFinal.fullLoad.fltMs, unit: "ms" as const },
        }
      : rootFinal.metrics;
  const base: RunReport = {
    runIndex,
    cold: runIndex === 0,
    metrics,
    resources: rootFinal.resources,
    longTasks: rootFinal.longTasks,
    meta: {},
  };
  const out: Mutable<RunReport> = { ...base };
  if (Object.keys(runtime).length > 0) out.runtime = runtime;
  if (rootFinal.opportunities && rootFinal.opportunities.length > 0) {
    out.opportunities = rootFinal.opportunities;
  }
  if (rootFinal.fullLoad) out.fullLoad = rootFinal.fullLoad;
  if (rootFinal.domTopology) out.domTopology = rootFinal.domTopology;
  return out;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Block until the page has been quiet (no significant DOM mutation, no long task, no new resource)
 * for `settleWindowMs`, or `maxWaitMs` elapses. Mirrors the noise floor used by computeFullLoad so
 * the "settled" decision matches the metric. Network is already idle here (waitForLoadIdle ran);
 * this catches post-network-idle main-thread/DOM work so FLT covers the entire load.
 */
async function waitForActivitySettle(
  session: CDPSessionLike,
  cfg: FullLoadConfig,
  navStartMs: number,
  logger: Logger,
  visSink?: FilmstripSink,
): Promise<void> {
  const POLL_MS = 150;
  const floor = cfg.mutationNoiseFloor;
  const expr = `(function(){var fl=window.__ohmyperfFL||{dom:[],cpu:[]};var F=${String(floor)};var d=0,c=0,r=0;` +
    `for(var i=0;i<fl.dom.length;i++){if(fl.dom[i].w>=F&&fl.dom[i].t>d)d=fl.dom[i].t;}` +
    `for(var j=0;j<fl.cpu.length;j++){if(fl.cpu[j].end>c)c=fl.cpu[j].end;}` +
    `try{var rs=performance.getEntriesByType('resource');for(var k=0;k<rs.length;k++){var e=rs[k].responseEnd||0;if(e>r)r=e;}}catch(_){}` +
    `return JSON.stringify({last:Math.max(d,c,r),now:performance.now()});})()`;
  while (Date.now() - navStartMs < cfg.maxWaitMs) {
    let last = 0;
    let now = 0;
    try {
      const res = (await session.send("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
        awaitPromise: false,
      })) as { result?: { value?: unknown } };
      const v = res.result?.value;
      if (typeof v === "string") {
        const parsed = JSON.parse(v) as { last?: number; now?: number };
        last = typeof parsed.last === "number" ? parsed.last : 0;
        now = typeof parsed.now === "number" ? parsed.now : 0;
      }
    } catch (err) {
      logger.debug("engine: settle poll failed; finalizing", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    // Include the visual-change timeline (filmstrip) so we also wait for visual quiet.
    const lastActivity = Math.max(last, visSink?.last ?? 0);
    if (now - lastActivity >= cfg.settleWindowMs) return; // quiet for a full window → settled
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function metricVal(metrics: Readonly<Record<string, Metric>>, name: string): number | null {
  const v = metrics[name]?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Aggregate per-run FLT results into a report-level block (US-4). */
function aggregateFullLoad(
  runs: ReadonlyArray<RunReport>,
  config: FullLoadConfig,
  aggregated: AggregatedMetrics,
): FullLoadReport | undefined {
  const results = runs.map((r) => r.fullLoad).filter((x): x is FullLoadResult => x !== undefined);
  if (results.length === 0) return undefined;

  const cappedCount = results.filter((r) => r.capped).length;
  const aggCapped = cappedCount * 2 >= results.length;
  const pool = aggCapped ? results : results.filter((r) => !r.capped);
  const effectivePool = pool.length > 0 ? pool : results;

  const fltMs =
    aggregated["fullLoad"]?.median ??
    quantile([...effectivePool.map((r) => r.fltMs)].sort((a, b) => a - b), 0.5);

  // Representative run = closest to the aggregated FLT (for sub-timeline + gating distribution).
  const representative = effectivePool.reduce((best, r) =>
    Math.abs(r.fltMs - fltMs) < Math.abs(best.fltMs - fltMs) ? r : best,
  );

  // gatingPhase = modal phase across runs; "mixed" when no single phase dominates.
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.gatingPhase, (counts.get(r.gatingPhase) ?? 0) + 1);
  let maxCount = 0;
  for (const c of counts.values()) maxCount = Math.max(maxCount, c);
  const top = [...counts.entries()].filter(([, c]) => c === maxCount).map(([p]) => p);
  const gatingPhase = top.length === 1 ? (top[0] as FullLoadReport["gatingPhase"]) : "mixed";

  const out: Mutable<FullLoadReport> = {
    fltMs,
    capped: aggCapped,
    gatingPhase,
    gatingDistribution: representative.gatingDistribution,
    subTimeline: { ...representative.subTimeline, fltMs },
    settleConfig: config,
  };
  const aggMetric = aggregated["fullLoad"];
  if (aggMetric) out.aggregated = aggMetric;
  if (aggCapped) out.trustReason = "never-settled";
  return out;
}

function aggregateOpportunities(runs: ReadonlyArray<RunReport>): ReadonlyArray<Opportunity> {
  const byId = new Map<string, Opportunity>();
  for (const r of runs) {
    for (const opp of r.opportunities ?? []) {
      if (!byId.has(opp.id)) byId.set(opp.id, opp);
    }
  }
  return Array.from(byId.values());
}

const UNSTABLE_COV_THRESHOLD = 0.2;
const OUTLIER_Z_THRESHOLD = 3.5;

const CWV_METRIC_NAMES = new Set(["lcp", "cls", "inp", "fcp", "ttfb"]);

export function aggregateRuns(runs: ReadonlyArray<RunReport>): AggregatedMetrics {
  const byMetric: Record<string, number[]> = {};
  for (const r of runs) {
    for (const [name, m] of Object.entries(r.metrics)) {
      const list = byMetric[name];
      if (list) list.push(m.value);
      else byMetric[name] = [m.value];
    }
  }
  const aggregated: Record<string, AggregatedMetric> = {};
  for (const [name, raw] of Object.entries(byMetric)) {
    if (raw.length === 0) continue;
    const { kept, dropped } = rejectOutliers(raw);
    const values = kept;
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const median = quantile(sorted, 0.5);
    const p75 = quantile(sorted, 0.75);
    const p95 = quantile(sorted, 0.95);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.length > 1
        ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
        : 0;
    const stdev = Math.sqrt(variance);
    const cov = mean === 0 ? 0 : Math.abs(stdev / mean);
    aggregated[name] = {
      median,
      p75,
      p95,
      mean,
      stdev,
      cov,
      runs: values.length,
      droppedOutliers: dropped,
    };
  }
  return aggregated;
}

export function isReportUnstable(aggregated: AggregatedMetrics): boolean {
  for (const name of CWV_METRIC_NAMES) {
    const agg = aggregated[name];
    if (!agg) continue;
    if (Number.isFinite(agg.cov) && agg.cov > UNSTABLE_COV_THRESHOLD) return true;
  }
  return false;
}

function rejectOutliers(values: ReadonlyArray<number>): {
  kept: number[];
  dropped: number;
} {
  if (values.length < 5) return { kept: [...values], dropped: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const deviations = values.map((v) => Math.abs(v - median));
  const sortedDeviations = [...deviations].sort((a, b) => a - b);
  const mad = quantile(sortedDeviations, 0.5);
  if (mad === 0) return { kept: [...values], dropped: 0 };
  const kept: number[] = [];
  let dropped = 0;
  for (const v of values) {
    const z = (0.6745 * (v - median)) / mad;
    if (Math.abs(z) > OUTLIER_Z_THRESHOLD) {
      dropped++;
    } else {
      kept.push(v);
    }
  }
  return { kept, dropped };
}

function quantile(sortedAsc: ReadonlyArray<number>, q: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sortedAsc[base]!;
  const hi = sortedAsc[Math.min(base + 1, sortedAsc.length - 1)]!;
  return lo + rest * (hi - lo);
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

interface BuildMetaInput {
  opts: MeasureOptions;
  runs: number;
  mode: Mode;
  headless: HeadlessMode;
  browserVersion: string;
  browserSource: "bundled" | "system" | "extension-host";
  startedAt: string;
  durationMs: number;
  pluginCapabilityUses: ReadonlyArray<{
    pluginId: string;
    capability: string;
    when: string;
  }>;
  unstable: boolean;
  calibration?: CalibrationResult | undefined;
}

function buildMeta(input: BuildMetaInput): ReportMeta {
  const {
    opts,
    runs,
    mode,
    headless,
    browserVersion,
    browserSource,
    startedAt,
    durationMs,
    pluginCapabilityUses,
    unstable,
    calibration,
  } = input;
  const meta: ReportMeta = {
    url: opts.url,
    startedAt,
    durationMs,
    runs,
    mode,
    browser: {
      name: "chromium",
      version: browserVersion,
      source: browserSource,
    },
    host: {
      os: `${osPlatform()} ${osRelease()}`,
      arch: osArch(),
      nodeVersion:
        typeof process !== "undefined" && typeof process.version === "string"
          ? process.version
          : "browser",
    },
    parity: {
      mode: headless,
      knownDeltas: headless === "headless" ? { inp: "synthetic-input" } : {},
    },
    emulation: opts.emulation ?? false,
    pluginCapabilityUses: pluginCapabilityUses.map((u) => ({
      pluginId: u.pluginId,
      capability: u.capability as import("./types.js").PluginCapability,
      when: u.when,
    })),
    measurementId: typeof randomUUID === "function" ? randomUUID() : `m_${String(Date.now())}`,
    ...(unstable ? { unstable: true } : {}),
    ...(calibration
      ? {
          calibration: {
            reference: calibration.reference,
            observedScore: calibration.observedScore,
            throttleRate: calibration.throttleRate,
            networkProfile: calibration.networkProfile,
            cacheHit: calibration.cacheHit,
          },
        }
      : {}),
  };
  return meta;
}

export function makeConsoleLoggerForEngine(level: "debug" | "info" | "warn" | "error" = "info"): Logger {
  return createConsoleLogger({ level, prefix: "ohmyperf:engine" });
}
