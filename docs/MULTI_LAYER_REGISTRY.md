# Multi-Layer Registry

Systems where ≥2 files MUST move together. Touching one layer without the
others = silent failure in production (canonical bug class).

When a new multi-layer bug is discovered, append an entry below + cite the
post-mortem commit. Operationalised by `scripts/check-cross-cutting-allowlists.sh`
and Forbidden Practice #20.

---

## `chrome-ext-spa-allowlist` — Chrome extension ↔ SPA bridge

| Layer | File | Concern |
|---|---|---|
| A | `apps/extension-chrome/static/manifest.json` → `externally_connectable.matches` | Chrome's allowlist gate |
| B | `apps/extension-chrome/src/background.ts` → `MANIFEST_MATCH_PATTERNS` regex array | Runtime allowlist in SW |
| C | `apps/website/lib/env.ts` → `NEXT_PUBLIC_EXTENSION_ID` hardcoded default | SPA fallback when discovery empty |
| D | `apps/website/lib/backend-detector.ts` + `apps/extension-chrome/src/background.ts` postMessage handshake | Runtime ID self-announce |
| E | `apps/website/lib/backend-detector.ts` module-level `installAnnounceListener()` invocation | Announce listener MUST register at module-load (eager), not on first detect call (lazy) — otherwise SW announce fires during page load and is missed |
| F | `apps/website/app/measure/page.tsx` `useEffect(() => detectExtensionOnly(), [])` | Measure page MUST auto-detect extension-only on mount (NOT runner — that would violate PR #12 contract). Otherwise initial render shows NoBackendGuide even when extension is loaded |

**Invariants** (checked by `test:cross-cutting-allowlists` + `test:e2e:extension`):

- set(A) == set(B) — manifest matches and runtime regex MUST list the same origins
- For every host in A, there is a deploy target in `apps/website/next.config.mjs` or `.github/workflows/deploy-pages.yml`
- C is non-empty OR runtime ID discovery path exists (regex on `chrome.runtime.id` postMessage in background.ts)
- Layer E: `backend-detector.ts` MUST contain a top-level `if (typeof window !== 'undefined') { installAnnounceListener(); }` call OUTSIDE any function body
- Layer F: `app/measure/page.tsx` MUST contain `useEffect` that calls `detectExtensionOnly` (NOT `detectBackend`) when `backend.kind === 'none'` — preserves PR #12 contract that runner is NOT probed before user clicks Measure

**Trigger file globs** (any diff touching these requires Multi-Layer Pre-Flight):

```
apps/extension-chrome/static/manifest.json
apps/extension-chrome/src/background.ts
apps/website/lib/env.ts
apps/website/lib/backend-detector.ts
apps/website/lib/extension-bridge.ts
apps/website/lib/extension-id.ts
apps/website/app/measure/page.tsx
```

**Canonical post-mortems**:
- Session 2026-05-21, commits `51feecf` → `f097b42` → `2fc26c8` → `be1eca2` (4 commits for Layers A-D). Forbidden #17.
- Session 2026-05-22, this branch (Layers E + F discovered via `test:e2e:extension` real-Chromium-with-extension run; Forbidden #17 extended).

---

## `node-globals-in-browser-bundle` — `@ohmyperf/core` cross-runtime

| Layer | File | Concern |
|---|---|---|
| 1 | `packages/core/src/**/*.ts` + any package consumed by browser surface | `typeof X !== 'undefined'` guards at every Node-API callsite |
| 2 | `apps/extension-chrome/scripts/bundle-extension.mjs` define block | Compile-time stub of `process.env`, `process.version`, etc. |

**Invariants**:

- Build the browser bundles (extension SW, website chunks, share-client) → grep output for `process.X`, `Buffer.X`, `__dirname`, `__filename`, `setImmediate` after stripping esbuild's `<define:process.X>` replacement markers
- Any unguarded hit = gate fails
- Bundler `define` block does NOT define `process` itself to undefined (would break Layer 1 guards) — only defines properties

**Trigger file globs**:

```
packages/core/src/**/*.ts
packages/plugins-builtin/src/**/*.ts
apps/extension-chrome/scripts/bundle-extension.mjs
apps/website/next.config.mjs
```

**Canonical post-mortem**: session 2026-05-21, commit `9af7824` (4 Node leaks fixed in 1 commit only after Forbidden #19 codified).

---

## `mv3-sw-port-lifecycle` — Chrome MV3 service worker idle race

| Layer | File | Concern |
|---|---|---|
| A | `apps/website/lib/extension-bridge.ts` | Connect-first pattern OR atomic `connect()` inside `sendMessage` callback (no microtask gap) |
| B | `apps/extension-chrome/src/background.ts` `onConnectExternal` handler | Port receiver registered at top-level (sync), not behind async init |
| C | `apps/extension-chrome/src/background.ts` long-running keepalive | `chrome.debugger.attach()` (Chrome 118+) OR port-ping every 20s OR `chrome.alarms` ≥0.5min |

**Invariants**:

- Static check: `extension-bridge.ts` contains `chrome.runtime.connect` BEFORE any `sendMessage`, OR the `sendMessage` callback synchronously calls `streamPort`/`connect` (no `await` between)
- Static check: `background.ts` registers `onConnectExternal` at module top level (not inside an async function or behind `await`)
- For any measurement >30s: either `chrome.debugger.attach()` is called, OR a port ping mechanism is wired

**Trigger file globs**:

```
apps/website/lib/extension-bridge.ts
apps/extension-chrome/src/background.ts
```

**Canonical post-mortem**: session 2026-05-21, commit `27bea87` ("Could not establish connection. Receiving end does not exist."). Forbidden #18 codifies the rule.

---

## `extension-e2e-test-infra` — Headed-Chromium-with-extension test harness

| Layer | File | Concern |
|---|---|---|
| 1 | `apps/extension-chrome/playwright.config.ts` | Workers=1 + headless=false (required for extension API exposure) + webServer hands off `pnpm --filter website dev` |
| 2 | `apps/extension-chrome/tests/playwright-e2e/extension-load.spec.ts` | Uses `chromium.launchPersistentContext()` with `--load-extension` + `--headless=new` env-toggle |
| 3 | `apps/extension-chrome/scripts/prepare-e2e-fixtures.mjs` | Idempotent build + setup-dev — guarantees `extension-dist/manifest.json` + `apps/website/.env.local:NEXT_PUBLIC_EXTENSION_ID` exist before test |
| 4 | `apps/extension-chrome/package.json` `scripts.e2e:extension` | Single command for agents/devs/CI to invoke the entire pipeline |

**Invariants**:

- Test runs MUST use `launchPersistentContext`, NOT `chromium.launch` + `newContext` (extensions don't load in non-persistent contexts)
- `--disable-extensions-except=<path>` AND `--load-extension=<path>` MUST both be set
- `prepare-e2e-fixtures.mjs` MUST be idempotent (re-runs without rebuilding when artifacts present)
- The `webServer` config MUST set `reuseExistingServer: true` to allow developer iteration
- `headless: false` mandatory at config level; per-spec override via `OHMYPERF_E2E_HEADLESS=false` for CI/Xvfb support
- Extension ID match assertion (test L1) MUST compare SW URL ID against `.env.local:NEXT_PUBLIC_EXTENSION_ID` (not hardcoded)

**Trigger file globs**:

```
apps/extension-chrome/playwright.config.ts
apps/extension-chrome/tests/playwright-e2e/**/*.spec.ts
apps/extension-chrome/scripts/prepare-e2e-fixtures.mjs
apps/extension-chrome/package.json
```

**Canonical post-mortem**: session 2026-05-22, this branch (em wired E2E specifically to dogfood Multi-Layer Pre-Flight; the spec immediately exposed Layers E+F race in `chrome-ext-spa-allowlist`). Validation Ladder layer `test:e2e:extension`.

---

## Adding a new system

When a multi-layer bug is discovered, append:

```markdown
## `<short-name>` — <one-line description>

| Layer | File | Concern |
|---|---|---|
| 1 | `<path>` | <what this layer ensures> |
| 2 | `<path>` | <what this layer ensures> |

**Invariants**: <bullet list of properties the `test:cross-cutting-allowlists` script asserts>

**Trigger file globs**:
\`\`\`
<glob1>
<glob2>
\`\`\`

**Canonical post-mortem**: <session date>, commit `<sha>`. Forbidden #<N> codifies the rule (if applicable).
```

Then add a corresponding case to `scripts/check-cross-cutting-allowlists.sh` so CI enforces the invariants automatically.
