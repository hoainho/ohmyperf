import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { createConsoleLogger } from "@ohmyperf/core";
import { EXIT_CODES } from "../exit-codes.js";

export const installBrowserCommand = defineCommand({
  meta: {
    name: "install-browser",
    description: "Download Playwright's bundled Chromium (idempotent).",
  },
  args: {
    quiet: {
      type: "boolean",
      default: false,
    },
  },
  async run({ args }): Promise<void> {
    const logger = createConsoleLogger({
      level: args.quiet ? "warn" : "info",
      prefix: "ohmyperf:install-browser",
    });

    const cliPath = resolvePlaywrightCli();
    if (cliPath) {
      logger.info(`running: node ${cliPath} install chromium`);
      const code = await runProcess(process.execPath, [cliPath, "install", "chromium"]);
      if (code === 0) {
        logger.info("Chromium installed");
        return;
      }
      logger.error(`installer exited with code ${String(code)}`);
      process.exit(EXIT_CODES.browserBinaryMissing);
    }

    for (const cmd of ["pnpm", "npx"]) {
      const argv = cmd === "pnpm"
        ? ["exec", "playwright", "install", "chromium"]
        : ["playwright", "install", "chromium"];
      logger.info(`running: ${cmd} ${argv.join(" ")}`);
      const code = await runProcess(cmd, argv);
      if (code === 0) {
        logger.info("Chromium installed");
        return;
      }
      logger.warn(`${cmd} exited with code ${String(code)}; trying next runner`);
    }
    logger.error("Could not install Chromium via any runner. Try `pnpm add -w playwright && pnpm exec playwright install chromium`.");
    process.exit(EXIT_CODES.browserBinaryMissing);
  },
});

function resolvePlaywrightCli(): string | null {
  // playwright's package.json "exports" map does not expose "./cli.js", so
  // require.resolve("playwright/cli.js") throws ERR_PACKAGE_PATH_NOT_EXPORTED.
  // Resolve the package.json (which IS exported) and derive cli.js from its dir.
  const anchors = [`${process.cwd()}/_resolve_anchor.js`, fileURLToPath(import.meta.url)];
  for (const anchor of anchors) {
    try {
      const req = createRequire(anchor);
      const pkgJsonPath = req.resolve("playwright/package.json");
      const cliPath = join(dirname(pkgJsonPath), "cli.js");
      if (existsSync(cliPath)) return cliPath;
    } catch {
      // try next anchor
    }
  }
  return null;
}

function runProcess(cmd: string, argv: ReadonlyArray<string>): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(cmd, [...argv], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}
