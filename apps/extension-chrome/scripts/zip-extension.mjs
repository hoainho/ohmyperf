#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, readdir, stat, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { deflateRawSync, crc32 } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extDist = join(root, "extension-dist");
const releasesDir = join(root, "..", "..", "releases");

const manifest = JSON.parse(await readFile(join(extDist, "manifest.json"), "utf8"));
const version = manifest.version;
const zipName = `ohmyperf-extension-v${version}.zip`;
const zipPath = join(releasesDir, zipName);

await mkdir(releasesDir, { recursive: true });
await rm(zipPath, { force: true });

const entries = [];
async function walk(dir) {
  for (const name of await readdir(dir)) {
    const abs = join(dir, name);
    const s = await stat(abs);
    if (s.isDirectory()) {
      await walk(abs);
    } else {
      entries.push(abs);
    }
  }
}
await walk(extDist);
entries.sort();

const localChunks = [];
const central = [];
let offset = 0;

for (const abs of entries) {
  const rel = relative(extDist, abs).split(sep).join(posix.sep);
  const raw = await readFile(abs);
  const compressed = deflateRawSync(raw);
  const useStored = compressed.length >= raw.length;
  const data = useStored ? raw : compressed;
  const method = useStored ? 0 : 8;
  const crc = crc32(raw);
  const nameBuf = Buffer.from(rel, "utf8");

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  localChunks.push(local, nameBuf, data);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(0, 12);
  cd.writeUInt16LE(33, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);
  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE(0, 38);
  cd.writeUInt32LE(offset, 42);
  central.push(cd, nameBuf);

  offset += local.length + nameBuf.length + data.length;
}

const cdStart = offset;
const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(cdStart, 16);
eocd.writeUInt16LE(0, 20);

const finalBuf = Buffer.concat([...localChunks, cdBuf, eocd]);
const { writeFile } = await import("node:fs/promises");
await writeFile(zipPath, finalBuf);

const sha = createHash("sha256").update(finalBuf).digest("hex");
const sizeKb = (finalBuf.length / 1024).toFixed(1);
console.log(`[zip-extension] wrote ${zipPath}`);
console.log(`[zip-extension] size:   ${sizeKb} KB`);
console.log(`[zip-extension] sha256: ${sha}`);
console.log(`[zip-extension] files:  ${entries.length}`);
