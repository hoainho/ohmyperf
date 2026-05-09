import { spawn } from "node:child_process";
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
    logger.info("running: npx playwright install chromium");
    const code = await runProcess("npx", ["playwright", "install", "chromium"]);
    if (code === 0) {
      logger.info("Chromium installed");
      return;
    }
    logger.error(`installer exited with code ${String(code)}`);
    process.exit(EXIT_CODES.browserBinaryMissing);
  },
});

function runProcess(cmd: string, argv: ReadonlyArray<string>): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(cmd, [...argv], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}
