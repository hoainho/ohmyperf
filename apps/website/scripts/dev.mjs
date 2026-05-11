#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "site-dist");
const port = Number(process.env.PORT ?? 5174);
const host = process.env.HOST ?? "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    const file = join(out, safePath);
    if (!file.startsWith(out)) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
    const s = await stat(file);
    if (s.isDirectory()) {
      res.writeHead(302, { Location: urlPath.replace(/\/?$/, "/") + "index.html" });
      res.end();
      return;
    }
    const body = await readFile(file);
    const ext = "." + (file.split(".").pop() ?? "");
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      res.statusCode = 404;
      res.end(`Not found: ${req.url ?? ""}\n\nTip: run \`pnpm --filter @ohmyperf/website build\` first to populate site-dist/.`);
    } else {
      res.statusCode = 500;
      res.end(`Error: ${msg}`);
    }
  }
});

server.listen(port, host, () => {
  process.stderr.write(`ohmyperf website dev server: http://${host}:${String(port)}\n`);
  process.stderr.write(`serving ${out}\n`);
  process.stderr.write(`pages:\n`);
  process.stderr.write(`  - http://${host}:${String(port)}/         (landing)\n`);
  process.stderr.write(`  - http://${host}:${String(port)}/viewer.html  (drag-drop)\n`);
});

const watcher = spawn("node", [join(root, "scripts/bundle-site.mjs")], {
  stdio: "inherit",
});
watcher.on("exit", (code) => {
  if (code !== 0) {
    process.stderr.write(`bundle-site exited ${String(code)}; static server stays up.\n`);
  }
});

process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
