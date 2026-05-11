#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "extension-out");
await mkdir(out, { recursive: true });

const esbuild = await import("esbuild").catch(() => null);
if (!esbuild) {
  await writeFile(
    join(out, "extension.js"),
    "// Placeholder — install 'esbuild' to produce the real bundle.\n",
  );
  console.warn("[bundle-extension] esbuild not installed; wrote placeholder.");
  process.exit(0);
}

await esbuild.build({
  entryPoints: [join(root, "dist/extension.js")],
  outfile: join(out, "extension.js"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  external: ["vscode"],
});

console.log(`Wrote VSCode extension bundle to ${out}/extension.js`);
