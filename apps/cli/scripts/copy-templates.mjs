// Copies the authored CI templates from the monorepo root (templates/ci) into
// this package (apps/cli/templates/ci) so the published @ohmyperf/cli ships them
// and `ohmyperf init --ci <provider>` can resolve them at runtime.
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // apps/cli/scripts
const pkgRoot = resolve(here, ".."); // apps/cli
const repoRoot = resolve(here, "../../.."); // <repo>
const src = resolve(repoRoot, "templates/ci");
const dest = resolve(pkgRoot, "templates/ci");

await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`[copy-templates] ${src} -> ${dest}`);
