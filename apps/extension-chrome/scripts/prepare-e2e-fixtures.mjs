#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = dirname(here);
const repoRoot = dirname(dirname(extRoot));
const distDir = join(extRoot, "extension-dist");
const manifestPath = join(distDir, "manifest.json");
const websiteEnvLocal = join(repoRoot, "apps", "website", ".env.local");

function run(cmd, opts = {}) {
  console.log(`[prepare-e2e-fixtures] $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: repoRoot, ...opts });
}

if (!existsSync(join(extRoot, ".dev-keys", "extension.pem"))) {
  run(`pnpm --filter @ohmyperf/extension-chrome setup-dev`);
} else {
  console.log("[prepare-e2e-fixtures] reusing existing .dev-keys/extension.pem");
}

if (!existsSync(manifestPath)) {
  run(`pnpm --filter @ohmyperf/extension-chrome build`);
} else {
  console.log(`[prepare-e2e-fixtures] reusing existing extension-dist at ${distDir}`);
}

try {
  execSync("pnpm exec playwright --version", { stdio: "ignore", cwd: repoRoot });
  const versionOut = execSync("pnpm exec playwright --version", { cwd: repoRoot }).toString().trim();
  console.log(`[prepare-e2e-fixtures] playwright present: ${versionOut}`);
} catch {
  console.error("[prepare-e2e-fixtures] FATAL: playwright not resolvable. Run: pnpm install");
  process.exit(1);
}

try {
  const browsersPath = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? join(process.env["HOME"] ?? "", ".cache", "ms-playwright");
  if (!existsSync(browsersPath) || !execSync(`ls "${browsersPath}" 2>/dev/null | head -1`).toString().trim()) {
    console.log("[prepare-e2e-fixtures] Chromium not detected, running playwright install chromium");
    run(`pnpm exec playwright install chromium`);
  } else {
    console.log(`[prepare-e2e-fixtures] Chromium detected under ${browsersPath}`);
  }
} catch {
  console.log("[prepare-e2e-fixtures] Chromium check inconclusive, running playwright install chromium");
  run(`pnpm exec playwright install chromium`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) {
  console.error(`[prepare-e2e-fixtures] FATAL: manifest_version=${manifest.manifest_version}, expected 3`);
  process.exit(1);
}
if (!manifest.background?.service_worker) {
  console.error("[prepare-e2e-fixtures] FATAL: manifest missing background.service_worker");
  process.exit(1);
}

const envBody = await readFile(websiteEnvLocal, "utf8");
const idMatch = envBody.match(/NEXT_PUBLIC_EXTENSION_ID=(\S+)/);
if (!idMatch) {
  console.error(`[prepare-e2e-fixtures] FATAL: NEXT_PUBLIC_EXTENSION_ID missing from ${websiteEnvLocal}`);
  process.exit(1);
}

console.log(`
[prepare-e2e-fixtures] OK
  extension-dist: ${distDir}
  manifest version: ${manifest.version}
  service_worker: ${manifest.background.service_worker}
  NEXT_PUBLIC_EXTENSION_ID: ${idMatch[1]}
`);
