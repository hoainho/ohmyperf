# Spec: Source-Map Resolution

## ADDED Requirements

### Requirement: LongTask attribution URLs must be resolved to original source locations
For every LongTask whose attribution URL (`attribution.url` or change-#1-era `attributionRich.url`) refers to a script for which a source map is discoverable under `config.repoRoot`, the resolver SHALL populate `longTask.sourceLocation = { file, line, column, function?, sourceMapHash }`. The original-language `file` SHALL be a path relative to `config.repoRoot`.

#### Scenario: Resolver maps a minified URL+line to a source-tree path
- **WHEN** `tests/fixtures/sourcemap-fixture/dist/bundle.js` is served alongside `bundle.js.map`
- **AND** the fixture page triggers a 200ms LongTask attributed to `dist/bundle.js:1:knownColumn`
- **THEN** after the source-map plugin's `onReport` hook runs, `report.runs[0].longTasks[0].sourceLocation.file === 'src/Foo.tsx'`
- **AND** `sourceLocation.function === 'Foo'`
- **AND** `sourceLocation.sourceMapHash` equals the hex sha256 of `bundle.js.map`'s raw bytes

#### Scenario: Missing source map degrades gracefully
- **WHEN** a LongTask's URL has no discoverable `.map` and no `//# sourceMappingURL=` comment
- **THEN** `longTask.sourceLocation` is undefined
- **AND** `report.warnings[]` (top-level on Report; emitted via the plugin's returned-new-Report pattern, not via `.push`) contains an entry with `id` matching `source-maps.missing` and a count
- **AND** `report.warnings` is a `ReadonlyArray` — the resolver plugin returns a new Report rather than mutating the existing one

#### Scenario: Inline / eval'd / data: URL scripts resolve to undefined with explicit warning
- **WHEN** a LongTask is attributed to an inline `<script>` (no URL), an `eval()`'d function (also no URL), or a `data:application/javascript;base64,...` URL
- **THEN** `longTask.sourceLocation` is undefined
- **AND** `report.warnings[]` contains an entry with `id` matching one of `source-maps.unresolvable-inline`, `source-maps.unresolvable-eval`, or `source-maps.unresolvable-data-url` (per the kind of unmappable script)

#### Scenario: Vite virtual sourceMappingURL resolves to synthetic SourceLocation
- **WHEN** a script's `//# sourceMappingURL=` resolves to a Vite virtual path (e.g., `/@id/__x00__virtual:my-plugin`) that is not openable on disk under `repoRoot`
- **THEN** `longTask.sourceLocation` is populated as `{ file: '<virtual:__x00__virtual:my-plugin>', line, column, resolved: true, codeWindowRef: undefined }`
- **AND** no warning is emitted (virtual sources are a successful resolution, just with no readable file)

#### Scenario: esbuild inline base64 source map decodes successfully
- **WHEN** a script ends with `//# sourceMappingURL=data:application/json;base64,<encoded>` and the decoded JSON is a valid source map
- **THEN** the resolver decodes the base64 payload (no disk read), parses it, and produces a correct `SourceLocation` with `resolved: true`
- **AND** `sourceMapHash` is the sha256 of the **decoded JSON bytes**

#### Scenario: Webpack v3 index map (sections-based) is correctly traversed
- **WHEN** the source map is an index map with a `sections` array (no top-level `mappings`)
- **THEN** `@jridgewell/trace-mapping`'s `TraceMap` correctly resolves positions across sections
- **AND** the test fixture `tests/fixtures/sourcemap-webpack-index-fixture/` validates this end-to-end

### Requirement: Source-map resolution must never make a network request
The resolver SHALL read source maps only from in-memory script bytes already captured via CDP Network domain or from on-disk files under `config.repoRoot`. No `fetch`, `http`, `https`, or `node:net` calls SHALL be made during resolution.

#### Scenario: Resolver refuses to fetch a cross-origin source map URL
- **WHEN** a script at `https://cdn.foo.com/app.js` includes `//# sourceMappingURL=https://cdn.foo.com/app.js.map`
- **AND** `https://cdn.foo.com/app.js.map` is NOT cached in CDP Network state
- **AND** `config.repoRoot` contains no matching local file
- **THEN** `sourceLocation` is undefined for that script's attribution
- **AND** no HTTP request for `app.js.map` is issued by ohmyperf
- **AND** `report.warnings[]` records `source-maps.missing`

### Requirement: Resolver must enforce path-traversal hardening (POSIX + Windows)
The resolver SHALL reject any source-map path that resolves outside `config.repoRoot` on both POSIX and Windows platforms. Symbolic links SHALL be resolved before the boundary check. On Windows, forward-slash mixing in path components SHALL be normalized before comparison; drive-letter comparison SHALL be case-insensitive; UNC paths (`\\?\...`, `\\server\share\...`) outside `repoRoot` SHALL be rejected.

#### Scenario: POSIX crafted sourceMappingURL escapes are blocked
- **WHEN** a script declares `//# sourceMappingURL=../../../etc/passwd`
- **THEN** resolver returns `null` for that script's attribution
- **AND** `report.warnings[]` contains entry with `id === 'source-maps.path-traversal-blocked'`
- **AND** does NOT read `/etc/passwd` from disk

#### Scenario: Windows backslash-escape via mixed-slash sourceMappingURL is blocked
- **WHEN** `process.platform === 'win32'`
- **AND** `config.repoRoot === 'C:\\repo'`
- **AND** a script declares `//# sourceMappingURL=/c:/repo/../etc/passwd`
- **THEN** resolver returns `null`
- **AND** `report.warnings[]` contains `source-maps.path-traversal-blocked`

#### Scenario: UNC path outside repoRoot is rejected
- **WHEN** `process.platform === 'win32'`
- **AND** a script's source-map resolves to UNC path `\\?\D:\evil\map.js.map`
- **AND** `config.repoRoot === 'C:\\repo'`
- **THEN** resolver returns `null` and logs `source-maps.path-traversal-blocked`

#### Scenario: Symlink pointing outside repoRoot is rejected after symlink-resolve
- **WHEN** `<repoRoot>/dist/bundle.js.map` is a symlink to `/etc/passwd`
- **THEN** resolver `fs.realpath`s the symlink first, finds `/etc/passwd` is outside `repoRoot`, returns `null`
- **AND** logs `source-maps.path-traversal-blocked`

#### Scenario: Case-insensitive drive-letter compare succeeds on Win32
- **WHEN** `process.platform === 'win32'`
- **AND** `config.repoRoot === 'C:\\repo'`
- **AND** resolved map path is `c:\\repo\\dist\\bundle.js.map`
- **THEN** the path is accepted (case-insensitive drive letter compare) and resolution proceeds

### Requirement: Resolver must respect finalize-time budgets
The aggregate wall-clock time spent in the `sourceMapResolverPlugin.onReport` hook SHALL NOT exceed 3 seconds for any single Report. Per-map `fs.readFile` SHALL race against a 500ms timeout. Concurrency SHALL be capped at 4 simultaneous map reads.

#### Scenario: Budget exhaustion emits a degradation, not a crash
- **WHEN** 100 distinct source maps each take 50ms to read (cumulative 5s)
- **THEN** the resolver completes ≤ 3.5s wall-clock
- **AND** `report.warnings[]` contains `{ id: 'source-maps.finalize-budget-exceeded', count: <remaining> }`
- **AND** locations resolved before the budget cutoff remain populated
- **AND** the engine does not throw

#### Scenario: A single slow map does not block others
- **WHEN** one source map's read hangs (simulated 5s delay)
- **AND** the other 9 source maps read in < 50ms each
- **THEN** the slow map's location is left undefined (timed out)
- **AND** the 9 fast maps' locations are populated correctly

### Requirement: Code windows are emitted as side artifacts, not inlined
When `config.codeWindow === 'artifact'` (default), the resolver SHALL write a ±15-line code window for each resolved location to `ctx.artifacts.put(...)` and SHALL set `sourceLocation.codeWindowRef = { sha256, bytes }`. Inline embedding (`codeWindow === 'inline'`) is reserved for v2.1 and SHALL be rejected with a config-validation error in v1.

#### Scenario: Code window artifact is emitted with deterministic hash
- **WHEN** the resolver resolves `src/Foo.tsx:42:8` and the source file contains stable content
- **THEN** `sourceLocation.codeWindowRef.sha256` equals the sha256 of the ±15-line text window
- **AND** `ctx.artifacts.get(sha256)` returns the window bytes

#### Scenario: Inline code-window mode is rejected in v1
- **WHEN** a user sets `config.codeWindow = 'inline'`
- **THEN** plugin construction throws a config-validation error with message containing `'inline code windows reserved for v2.1'`

### Requirement: Resolver must operate only via on-disk source maps and never from the network
(See Requirement: Source-map resolution must never make a network request above — kept distinct so the path-traversal scenario reads cleanly.)

### Requirement: Extension build must not load the source-map plugin
The chrome-extension surface (`apps/extension-chrome/src/background.ts`) SHALL NOT register `sourceMapResolverPlugin`. Reports emitted from the extension SHALL include `report.degradations.push({ capability: 'source-maps', reason: 'extension-fs-unavailable' })`.

#### Scenario: Extension Report records the source-map degradation
- **WHEN** a measurement is initiated from the chrome extension
- **THEN** the resulting `report.degradations[]` (top-level on Report; the new `PluginDegradationCapability` union channel — NOT `ReportMeta.degradations`) contains an entry with `capability === 'source-maps'` and `reason === 'extension-fs-unavailable'`
- **AND** no `longTask.sourceLocation` fields are populated
