import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(HERE, "../../extension-dist");
const REPO_ROOT = resolve(HERE, "../../../..");
const WEBSITE_ENV = join(REPO_ROOT, "apps/website/.env.local");

function readExpectedExtensionId(): string {
  if (!existsSync(WEBSITE_ENV)) {
    throw new Error(
      `Missing ${WEBSITE_ENV}. Run: node apps/extension-chrome/scripts/prepare-e2e-fixtures.mjs`,
    );
  }
  const body = readFileSync(WEBSITE_ENV, "utf8");
  const match = body.match(/NEXT_PUBLIC_EXTENSION_ID=(\S+)/);
  if (!match) throw new Error(`NEXT_PUBLIC_EXTENSION_ID not in ${WEBSITE_ENV}`);
  return match[1]!;
}

function assertExtensionDistBuilt(): void {
  const manifestPath = join(EXTENSION_PATH, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing ${manifestPath}. Run: node apps/extension-chrome/scripts/prepare-e2e-fixtures.mjs`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    manifest_version: number;
    background?: { service_worker?: string };
  };
  expect(manifest.manifest_version, "manifest_version must be 3").toBe(3);
  expect(manifest.background?.service_worker, "must have service_worker").toBeTruthy();
}

let context: BrowserContext;
let userDataDir: string;

test.beforeAll(async () => {
  assertExtensionDistBuilt();
  userDataDir = mkdtempSync(join(tmpdir(), "ohmyperf-e2e-profile-"));
  const useNewHeadless = process.env["OHMYPERF_E2E_HEADLESS"] !== "false";
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      ...(useNewHeadless ? ["--headless=new"] : []),
    ],
    viewport: { width: 1280, height: 720 },
  });
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDir && existsSync(userDataDir)) {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("L1 extension service worker registers with deterministic ID", async () => {
  const expectedId = readExpectedExtensionId();
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 30_000 });
  }
  expect(serviceWorker, "service worker must register after extension load").toBeTruthy();
  const swUrl = serviceWorker.url();
  console.log(`[L1] service worker URL: ${swUrl}`);
  expect(swUrl, `SW URL must match chrome-extension://[32 chars]/. Got: ${swUrl}`).toMatch(
    /^chrome-extension:\/\/[a-z]{32}\//,
  );
  const actualId = swUrl.match(/chrome-extension:\/\/([a-z]{32})/)?.[1];
  console.log(`[L1] actual=${actualId}, expected=${expectedId}`);
  expect(
    actualId,
    `SW URL ext ID must match NEXT_PUBLIC_EXTENSION_ID. expected=${expectedId} actual=${actualId}`,
  ).toBe(expectedId);
});

test("L2 extension manifest contains externally_connectable for localhost", async () => {
  const manifest = JSON.parse(
    readFileSync(join(EXTENSION_PATH, "manifest.json"), "utf8"),
  ) as { externally_connectable?: { matches?: string[] } };
  const matches = manifest.externally_connectable?.matches ?? [];
  const hasLocalhost = matches.some((m) => m.includes("localhost"));
  expect(hasLocalhost, "manifest.externally_connectable.matches must include localhost").toBe(true);
});

test("L3 measure page handshake — extension IS loaded, MUST be detected", async () => {
  const expectedId = readExpectedExtensionId();
  const page: Page = await context.newPage();
  const consoleErrors: string[] = [];
  const consoleLog: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleLog.push(text);
    if (msg.type() === "error") consoleErrors.push(text);
  });

  await page.goto("/measure", { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const html = document.documentElement.innerText.toLowerCase();
      return /extension\s+ready|runner\s+detected|no\s+runner|not\s+detected/.test(html);
    },
    { timeout: 30_000 },
  );

  const bodyText = await page.locator("body").innerText();
  const extensionDetected = /extension\s+ready|runner\s+detected/i.test(bodyText) && !/no\s+runner|not\s+detected/i.test(bodyText);
  const guideVisible = /no\s+runner|not\s+detected/i.test(bodyText);

  console.log(`[L3] extensionDetected=${extensionDetected} guideVisible=${guideVisible}`);
  console.log(`[L3] bodyExcerpt=${bodyText.slice(0, 200).replace(/\s+/g, " ")}`);
  if (consoleLog.length) {
    console.log(`[L3] page console (${consoleLog.length} entries):\n${consoleLog.slice(0, 30).join("\n  ")}`);
  }

  const processLeak = consoleErrors.filter((e) => /process\s+is\s+not\s+defined/i.test(e));
  expect(
    processLeak,
    `Forbidden #19 regression: 'process is not defined' leaked into runtime. Errors: ${processLeak.join(" | ")}`,
  ).toEqual([]);

  expect(
    extensionDetected,
    `Extension IS loaded (L1 confirmed SW at ${expectedId}) and externally_connectable allows localhost (L2 confirmed) — handshake MUST complete. Got guideVisible=${guideVisible}. This is the canonical bug class from 4-commit chain 51feecf→be1eca2 (Forbidden #17). Body excerpt: ${bodyText.slice(0, 500)}`,
  ).toBe(true);

  const nonFatalErrors = consoleErrors.filter(
    (e) => !/favicon/i.test(e) && !/ERR_CONNECTION_REFUSED/i.test(e) && !/Failed to load resource/i.test(e),
  );
  expect(
    nonFatalErrors,
    `page must not emit console errors after handshake. Got: ${nonFatalErrors.join(" | ")}`,
  ).toEqual([]);

  await page.close();
});

test("L4 service worker bundle has no unguarded process.* runtime access", async () => {
  const swBundle = readFileSync(join(EXTENSION_PATH, "background.bundle.js"), "utf8");
  const lines = swBundle.split("\n");
  const offenders: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/<define:process\./.test(line)) continue;
    if (/define_process_(env|versions|version|platform)_default/.test(line)) continue;
    if (/init_define_process_(env|versions|version|platform)/.test(line)) continue;
    const matches = line.match(/(?<!typeof\s)\bprocess\.(env|version|versions|platform)\b/g);
    if (matches) {
      offenders.push(`L${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  }
  expect(
    offenders,
    `background.bundle.js must have 0 unguarded process.* refs (Forbidden #19). esbuild define artifacts (<define:process.env>) excluded. Found ${offenders.length} real offenders:\n${offenders.slice(0, 5).join("\n")}`,
  ).toEqual([]);
});

test("L5 atomic startMeasureAndStream pattern present in bridge", async () => {
  const bridgePath = join(REPO_ROOT, "apps/website/lib/extension-bridge.ts");
  if (!existsSync(bridgePath)) {
    test.skip(true, "extension-bridge.ts not found — SPA layout may have changed");
    return;
  }
  const bridge = readFileSync(bridgePath, "utf8");
  expect(
    bridge,
    "bridge must export startMeasureAndStream (atomic connect-inside-callback per Forbidden #18)",
  ).toMatch(/export\s+(async\s+)?function\s+startMeasureAndStream/);
});
