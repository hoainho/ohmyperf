#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BUDGETS = {
  '/':               { firstLoadJsKb: 150 },
  '/measure':        { firstLoadJsKb: 200 },
  '/report/[[...id]]': { firstLoadJsKb: 250 },
};

const root = process.cwd();
const analyzerJsonPath = join(root, '.next', 'analyze', 'client.json');
const buildOutputPath = join(root, '.next', 'build-manifest.json');

async function loadJson(p) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch (e) {
    console.error(`Could not read ${p}: ${e.message}`);
    process.exit(2);
  }
}

const stats = await loadJson(analyzerJsonPath);
const manifest = await loadJson(buildOutputPath);

let failed = false;
for (const [route, budget] of Object.entries(BUDGETS)) {
  const routeChunks = manifest.pages?.[route] ?? manifest.rootMainFiles ?? [];
  const gzipBytes = stats
    .filter((chunk) => routeChunks.some((rc) => chunk.label.endsWith(rc.split('/').pop())))
    .reduce((acc, chunk) => acc + (chunk.gzipSize ?? 0), 0);
  const gzipKb = Math.round(gzipBytes / 1024);
  const status = gzipKb <= budget.firstLoadJsKb ? '✅' : '❌';
  console.log(`${status} ${route} → ${gzipKb}KB (budget ${budget.firstLoadJsKb}KB)`);
  if (gzipKb > budget.firstLoadJsKb) failed = true;
}

if (failed) {
  console.error('\nBundle budget exceeded. See .next/analyze/client.html for details.');
  process.exit(1);
}
