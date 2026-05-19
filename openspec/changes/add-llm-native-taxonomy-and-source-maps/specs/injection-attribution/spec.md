# Spec: Code-Location-Keyed Injection Attribution

## ADDED Requirements

### Requirement: Dynamically-injected scripts must be attributed to the inserting code location
For every `<script>` element inserted into the DOM via `appendChild`, `insertBefore`, or `replaceChild`, ohmyperf SHALL capture the call-site stack trace at the **moment of insertion** (not creation, not `src` setter) and SHALL attribute the resulting Resource's `injectionPath[0]` to the top frame of that stack. The raw stack is emitted with `SourceLocation.resolved === false` (where `file` carries the minified URL); the source-map resolver in spec `source-map-resolution` later rewrites these entries to `resolved === true` form with `file` as the `repoRoot`-relative source-tree path.

#### Scenario: useEffect-injected script is attributed back to its source file
- **WHEN** `tests/fixtures/injection-fixture/app/page.tsx` declares `useEffect(() => { const s = document.createElement('script'); s.src = '/static/intercom.stub.js'; document.head.appendChild(s); }, [])` at line `<N>`
- **AND** a measurement is performed against the fixture (with source maps available)
- **THEN** `report.runs[0].resources.find(r => r.url.endsWith('intercom.stub.js')).injectionPath` is an array of length ≥ 1
- **AND** the immediately-post-collector entry has `resolved: false` and `file` equal to the minified URL
- **AND** AFTER `sourceMapResolverPlugin.onReport` runs, the entry has `resolved: true`, `file === 'app/page.tsx'`, `line === N`

#### Scenario: Emit-on-insertion-only — `src` setter alone does not emit
- **WHEN** a page does `const s = document.createElement('script'); s.src = '/foo.js';` but **never** appends `s` to the DOM
- **THEN** `window.__ohmyperf_injections` does NOT contain an entry for `/foo.js`
- **AND** the eventual Report has no `Resource` entry for `/foo.js` at all (because it never loaded)

#### Scenario: Re-entry across the same element does not double-emit
- **WHEN** the page appends a `<script>` element, then detaches it, then re-appends the same element (frameworks bouncing nodes)
- **THEN** the resulting Resource has exactly one `injectionPath` entry, not two (WeakSet `__omp_emitted` guard)

### Requirement: Shim must run in the page world via a pre-load init script
The injection shim SHALL be injected via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true })` so that it runs before any page script and bypasses page `script-src` CSP directives.

#### Scenario: Shim installs successfully on a CSP-locked page
- **WHEN** the fixture serves `Content-Security-Policy: script-src 'self' 'unsafe-inline'`
- **AND** the page dynamically injects `/static/intercom.stub.js`
- **THEN** the resulting Resource still has a populated `injectionPath`
- **AND** `report.degradations[]` does NOT contain `injection-attribution`

### Requirement: When CDP init-script injection fails, attribution degrades gracefully
If `Page.addScriptToEvaluateOnNewDocument` rejects (e.g., fenced frame, extension-context restriction), the injection collector SHALL emit `{ capability: 'injection-attribution', reason: <error-message> }` into `report.degradations[]` (the new top-level `PluginDegradationCapability` channel — distinct from `ReportMeta.degradations` which uses `DriverCapability`) via the returned-new-Report pattern (since Report is deep-readonly; no `.push`), and SHALL skip injection capture for that frame WITHOUT throwing.

#### Scenario: Forced injection failure produces a degradation, not a crash
- **WHEN** `Page.addScriptToEvaluateOnNewDocument` is stubbed to throw `'CSP-blocked'`
- **THEN** the measurement completes
- **AND** `report.degradations[]` (top-level) contains `{ capability: 'injection-attribution', reason: 'CSP-blocked' }`
- **AND** no Resource has a populated `injectionPath`
- **AND** no error is propagated to the runner

### Requirement: Static `<script src=...>` HTML mapping is out of scope for v1
For static `<script src=...>` tags present in the initial HTML response, `Resource.injectionPath` SHALL be `undefined`. HTML-source mapping is reserved for v2.1 of this capability.

#### Scenario: Static script tag has no injectionPath in v1
- **WHEN** the initial HTML contains `<script src="/static/foo.js"></script>` (no JS-driven injection)
- **THEN** `report.runs[0].resources.find(r => r.url.endsWith('foo.js')).injectionPath` is undefined

### Requirement: Cross-frame OOPIF injection is captured per-frame
For each child frame attached via the existing `Target.setAutoAttach` flow, the injection shim SHALL be installed independently via that frame's CDP session. Captured injections SHALL be keyed by `{ scriptUrl, frameId }` so cross-frame collisions do not overwrite.

#### Scenario: OOPIF-injected script is attributed in the child frame
- **WHEN** a parent frame at `https://parent.example/` embeds `<iframe src="https://child.example/">` and the child frame injects `intercom.stub.js`
- **THEN** the resulting Resource for that injection has `injectionPath[0].file` pointing to a file under the child frame's source tree (if maps available)
- **AND** the parent frame's resources are not falsely attributed to the child injection
