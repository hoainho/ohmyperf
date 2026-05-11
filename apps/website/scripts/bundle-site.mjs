#!/usr/bin/env node
import { mkdir, cp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "site-dist");
const staticDir = join(root, "static");

await mkdir(out, { recursive: true });

for (const name of ["index.html", "viewer.html"]) {
  await cp(join(staticDir, name), join(out, name));
}

const esbuild = await import("esbuild").catch(() => null);
if (!esbuild) {
  await writeFile(
    join(out, "viewer-page.bundle.js"),
    "// Placeholder — install 'esbuild' to produce the real bundle.\n",
  );
  console.warn("[bundle-site] esbuild not installed; wrote placeholder.");
  process.exit(0);
}

const stubDir = join(out, "_stubs");
await mkdir(stubDir, { recursive: true });
const nodeStub = `export default {};
export const randomUUID = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
export const arch = () => 'browser';
export const platform = () => 'browser';
export const release = () => '';
export const homedir = () => '';
export const hostname = () => 'website';
export const totalmem = () => 0;
export const createHash = () => ({ update() { return this; }, digest() { return ''; } });
export const readFile = async () => { throw new Error('node:fs not available'); };
export const writeFile = async () => undefined;
export const mkdir = async () => undefined;
export const unlink = async () => undefined;
export const existsSync = () => false;
export const join = (...p) => p.join('/');
export const dirname = (p) => p.split('/').slice(0, -1).join('/');
export const resolve = (...p) => p.join('/');
`;
await writeFile(join(stubDir, "node-stub.mjs"), nodeStub);

await esbuild.build({
  entryPoints: [join(root, "dist/viewer-page.js")],
  outfile: join(out, "viewer-page.bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  minify: true,
  legalComments: "none",
  alias: {
    "node:crypto": join(stubDir, "node-stub.mjs"),
    "node:fs": join(stubDir, "node-stub.mjs"),
    "node:fs/promises": join(stubDir, "node-stub.mjs"),
    "node:os": join(stubDir, "node-stub.mjs"),
    "node:path": join(stubDir, "node-stub.mjs"),
    "node:http": join(stubDir, "node-stub.mjs"),
    "node:net": join(stubDir, "node-stub.mjs"),
    "node:child_process": join(stubDir, "node-stub.mjs"),
    "node:module": join(stubDir, "node-stub.mjs"),
  },
});

console.log(`Wrote site bundle to ${out}`);
