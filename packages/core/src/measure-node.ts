import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MeasureOptions, Report, Driver } from "./types.js";
import type { EngineLaunchAdapter } from "./engine.js";
import { MeasureOptionsError } from "./index.js";
import { createSilentLogger } from "./logger.js";

void createRequire;

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

type DriverModule = {
  createPlaywrightAdapter: (config: { kind: "chromium" | "firefox" | "webkit" }) => {
    driver: Driver;
    adapter: EngineLaunchAdapter;
  };
};

export async function measureNode(opts: MeasureOptions): Promise<Report> {
  if (typeof opts !== "object" || opts === null) {
    throw new MeasureOptionsError("opts must be an object", "opts");
  }
  if (typeof opts.url !== "string" || !isValidHttpUrl(opts.url)) {
    throw new MeasureOptionsError(
      `Invalid url: expected http(s) URL, got ${JSON.stringify(opts.url)}`,
      "url",
    );
  }
  if (
    opts.runs !== undefined &&
    (!Number.isInteger(opts.runs) || opts.runs < 1)
  ) {
    throw new MeasureOptionsError(
      `Invalid runs: expected positive integer, got ${String(opts.runs)}`,
      "runs",
    );
  }

  let driverMod: DriverModule;
  const candidates: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.push(
      join(dir, "node_modules", "@ohmyperf", "driver-playwright", "dist", "index.js"),
    );
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  let driverEntry: string | null = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      driverEntry = p;
      break;
    }
  }
  if (driverEntry) {
    try {
      driverMod = (await import(pathToFileURL(driverEntry).href)) as DriverModule;
    } catch (err) {
      throw new Error(
        `ohmyperf measure() found @ohmyperf/driver-playwright at ${driverEntry} but failed to import: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    try {
      driverMod = (await import(
        "@ohmyperf/driver-playwright" as string
      )) as DriverModule;
    } catch (err) {
      throw new Error(
        `ohmyperf measure() requires @ohmyperf/driver-playwright. Install it: 'npm install @ohmyperf/driver-playwright @ohmyperf/core'. Searched ${String(candidates.length)} candidate node_modules paths from ${process.cwd()} upward. Last error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const { driver, adapter } = driverMod.createPlaywrightAdapter({ kind: "chromium" });
  const { runEngine } = await import("./engine.js");
  return runEngine({ opts, driver, adapter, logger: createSilentLogger() });
}
