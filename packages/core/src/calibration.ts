import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, hostname, arch as osArch, platform as osPlatform, release as osRelease, totalmem } from "node:os";
import { dirname, join } from "node:path";
import type { CalibrationInfo, CDPSessionLike, Driver, Logger } from "./types.js";
import type { EngineLaunchAdapter } from "./engine.js";
import { createSilentLogger } from "./logger.js";

export const CALIBRATION_REFERENCE_NAME = "mid-range-2024-laptop" as const;

export const CALIBRATION_REFERENCE_MS = 250 as const;

export const NETWORK_PROFILES = {
  "fast-4g": {
    downloadThroughput: (12 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
    latency: 70,
  },
  "slow-4g": {
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (768 * 1024) / 8,
    latency: 150,
  },
  "no-throttle": null,
} as const;

export type NetworkProfileName = keyof typeof NETWORK_PROFILES;

const CALIBRATION_BENCHMARK_SOURCE = `
(() => {
  const ITER = 200000;
  const start = performance.now();
  let acc = 0;
  for (let i = 0; i < ITER; i++) {
    acc = (acc + Math.sin(i) * Math.cos(i / 3)) % 1.0;
  }
  return { ms: performance.now() - start, acc };
})();
`;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CalibrationOptions {
  readonly driver: Driver;
  readonly adapter: EngineLaunchAdapter;
  readonly logger?: Logger;
  readonly samples?: number;
  readonly cacheDir?: string;
  readonly recalibrate?: boolean;
  readonly networkProfile?: NetworkProfileName;
}

export interface CalibrationResult extends CalibrationInfo {
  readonly throttleRate: number;
  readonly observedScore: number;
  readonly reference: typeof CALIBRATION_REFERENCE_NAME;
  readonly networkProfile: NetworkProfileName;
  readonly cacheHit: boolean;
  readonly samplesMs: ReadonlyArray<number>;
}

export class CalibrationFailedError extends Error {
  public override readonly name = "CalibrationFailedError";
}

export async function calibrate(opts: CalibrationOptions): Promise<CalibrationResult> {
  const logger = opts.logger ?? createSilentLogger();
  const samples = opts.samples ?? 3;
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const networkProfile = opts.networkProfile ?? "fast-4g";
  const fingerprint = computeFingerprint(opts.driver);

  if (!opts.recalibrate) {
    const cached = await readCachedCalibration(cacheDir, fingerprint, logger);
    if (cached) {
      logger.debug("calibration: cache hit", { fingerprint, score: cached.observedScore });
      return { ...cached, cacheHit: true, networkProfile };
    }
  }

  const samplesMs = await runBenchmark(opts.adapter, samples, logger);
  if (samplesMs.length === 0) {
    throw new CalibrationFailedError("benchmark produced zero samples");
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;

  const observedScore = median;
  const throttleRate = computeThrottleRate(observedScore, CALIBRATION_REFERENCE_MS);

  if (throttleRate < 1 && observedScore > CALIBRATION_REFERENCE_MS * 2) {
    throw new CalibrationFailedError(
      `host CPU is too slow to match reference (${String(observedScore)}ms vs ${String(CALIBRATION_REFERENCE_MS)}ms target); cannot speed up`,
    );
  }

  const result: CalibrationResult = {
    reference: CALIBRATION_REFERENCE_NAME,
    observedScore,
    throttleRate,
    networkProfile,
    cacheHit: false,
    samplesMs,
  };

  await writeCachedCalibration(cacheDir, fingerprint, result, logger);
  return result;
}

async function runBenchmark(
  adapter: EngineLaunchAdapter,
  samples: number,
  logger: Logger,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const ctx = await adapter.launchPageWithCdp();
    try {
      await ctx.goto("about:blank");
      const result = (await ctx.rootSession.send("Runtime.evaluate", {
        expression: CALIBRATION_BENCHMARK_SOURCE,
        returnByValue: true,
        awaitPromise: false,
      })) as { result?: { value?: { ms: number } }; exceptionDetails?: unknown };
      if (result.exceptionDetails) {
        logger.debug("calibration: benchmark threw inside the page", {});
        continue;
      }
      const ms = result.result?.value?.ms;
      if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
        out.push(ms);
      }
    } finally {
      await ctx.close();
    }
  }
  return out;
}

function computeThrottleRate(observedMs: number, referenceMs: number): number {
  if (!Number.isFinite(observedMs) || observedMs <= 0) return 1;
  if (observedMs >= referenceMs) return 1;
  const rate = referenceMs / observedMs;
  return Math.max(1, Math.min(20, Number(rate.toFixed(2))));
}

export async function applyEmulation(
  session: CDPSessionLike,
  calibration: CalibrationResult,
  logger: Logger,
): Promise<void> {
  if (calibration.throttleRate > 1) {
    try {
      await session.send("Emulation.setCPUThrottlingRate", { rate: calibration.throttleRate });
    } catch (err) {
      logger.warn("calibration: setCPUThrottlingRate failed", {
        rate: calibration.throttleRate,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const profile = NETWORK_PROFILES[calibration.networkProfile];
  if (profile) {
    try {
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: profile.latency,
        downloadThroughput: profile.downloadThroughput,
        uploadThroughput: profile.uploadThroughput,
      });
    } catch (err) {
      logger.warn("calibration: emulateNetworkConditions failed", {
        profile: calibration.networkProfile,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function computeFingerprint(driver: Driver): string {
  const parts = [
    osPlatform(),
    osArch(),
    osRelease(),
    String(totalmem()),
    hostname(),
    driver.id,
    driver.browserVersion,
    "v1",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

function defaultCacheDir(): string {
  const env = process.env["OHMYPERF_CACHE_DIR"];
  if (env && env.length > 0) return env;
  return join(homedir(), ".ohmyperf-cache");
}

interface CachedEntry {
  fingerprint: string;
  reference: typeof CALIBRATION_REFERENCE_NAME;
  observedScore: number;
  throttleRate: number;
  samplesMs: number[];
  storedAt: number;
}

async function readCachedCalibration(
  cacheDir: string,
  fingerprint: string,
  logger: Logger,
): Promise<CalibrationResult | undefined> {
  try {
    const path = join(cacheDir, "calibration.json");
    const body = await readFile(path, "utf8");
    const entries = JSON.parse(body) as CachedEntry[];
    const found = entries.find((e) => e.fingerprint === fingerprint);
    if (!found) return undefined;
    if (Date.now() - found.storedAt > CACHE_TTL_MS) {
      logger.debug("calibration: cache stale", { fingerprint });
      return undefined;
    }
    if (found.reference !== CALIBRATION_REFERENCE_NAME) return undefined;
    return {
      reference: found.reference,
      observedScore: found.observedScore,
      throttleRate: found.throttleRate,
      networkProfile: "fast-4g",
      cacheHit: true,
      samplesMs: found.samplesMs,
    };
  } catch {
    return undefined;
  }
}

async function writeCachedCalibration(
  cacheDir: string,
  fingerprint: string,
  result: CalibrationResult,
  logger: Logger,
): Promise<void> {
  try {
    const path = join(cacheDir, "calibration.json");
    await mkdir(dirname(path), { recursive: true });
    let entries: CachedEntry[] = [];
    try {
      const existing = await readFile(path, "utf8");
      entries = JSON.parse(existing) as CachedEntry[];
    } catch {
      entries = [];
    }
    const filtered = entries.filter((e) => e.fingerprint !== fingerprint);
    filtered.push({
      fingerprint,
      reference: result.reference,
      observedScore: result.observedScore,
      throttleRate: result.throttleRate,
      samplesMs: [...result.samplesMs],
      storedAt: Date.now(),
    });
    await writeFile(path, JSON.stringify(filtered, null, 2), "utf8");
  } catch (err) {
    logger.debug("calibration: cache write failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
