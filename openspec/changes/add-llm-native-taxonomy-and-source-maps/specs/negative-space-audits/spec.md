# Spec: Negative-Space (Absence) Audits

## ADDED Requirements

### Requirement: Report must surface AbsenceFinding entries for the v1 absence checks
Every Report processed by `diagnoser` SHALL include `Report.absences: AbsenceFinding[]` enumerating findings from at least the five v1 checks: `lcp.preload-missing`, `cls.image-dimensions-missing`, `font.display-swap-missing`, `cache.static-asset-no-cache-control`, `compression.large-text-uncompressed`. An empty `absences[]` indicates "no absences detected"; absence of the field indicates the diagnoser did not run.

#### Scenario: Fixture without LCP preload triggers lcp.preload-missing
- **WHEN** a fixture page renders `<img src="/hero.jpg">` as the LCP element with NO `<link rel="preload" as="image" href="/hero.jpg">` in `<head>`
- **THEN** `report.absences[]` contains an entry with `id === 'lcp.preload-missing'`
- **AND** that entry's `subject.url === '/hero.jpg'`
- **AND** `subject.count === 1`
- **AND** `expected` is a string containing `<link rel="preload" as="image"`

#### Scenario: Fixture with LCP preload present does NOT trigger lcp.preload-missing
- **WHEN** the same fixture as above but with `<link rel="preload" as="image" href="/hero.jpg">` added to `<head>`
- **THEN** `report.absences[]` does NOT contain any entry with `id === 'lcp.preload-missing'` matching `/hero.jpg`

#### Scenario: Fixture with unsized LCP image triggers cls.image-dimensions-missing
- **WHEN** the LCP `<img>` has no `width` and no `height` attribute and contributes to a layout shift
- **THEN** `report.absences[]` contains `{ id: 'cls.image-dimensions-missing', subject: { selector: <img selector>, count: 1 }, ... }`

### Requirement: Absences must be deterministic across repeated runs on the same fixture
For any fixed input page, two consecutive `diagnoser` runs SHALL produce byte-equal `report.absences` JSON. The deterministic-comparison helper MAY exclude timing-derived `estimatedImpact.deltaMs` from byte-equality (timing varies even on identical inputs); all other fields SHALL be byte-equal.

#### Scenario: 10× repeat on the same fixture yields byte-equal absences
- **WHEN** `tests/determinism/absences.test.ts` invokes the diagnoser 10 times against `tests/fixtures/absences-fixture/`
- **THEN** every iteration's `report.absences` (with `estimatedImpact.deltaMs` blanked) deep-equals iteration #1's

#### Scenario: Absences are sorted by stable key
- **WHEN** multiple absence findings share the same `id`
- **THEN** they appear sorted by `subject.url ?? subject.selector ?? ''` (lexicographic ascending) within the array

### Requirement: Absence-check logic must operate on a frozen DOM snapshot, cold-run only
The DOM snapshot for absence-check input SHALL be captured exactly once **per run** during that run's `onIdle` collection phase and stored at `report.runs[i].pluginData['ohmyperf:domSnapshot']` (requires `RunReport.pluginData?` field — additive optional, per `B1.7`). Absence checks SHALL read **only `report.runs[0].pluginData['ohmyperf:domSnapshot']` (the cold/first run)** plus `report.runs[0].resources[]` and `report.runs[0].metrics`. They SHALL NOT call back into the browser, SHALL NOT re-query the DOM, and SHALL NOT consider runs[1..N] snapshots even if those snapshots happen to be present.

#### Scenario: Re-running the diagnoser on the same report yields byte-equal output
- **WHEN** the diagnoser plugin is invoked twice against the same in-memory Report object
- **THEN** both invocations produce the same `report.absences` (deep-equal)
- **AND** no Runtime/Page CDP calls are made during the second invocation

#### Scenario: Multi-run report: absences derive only from runs[0]
- **WHEN** a Report has `runs.length === 3` (multi-run measurement)
- **AND** the `runs[0]` (cold) snapshot has a missing-preload-image scenario
- **AND** the `runs[1]` and `runs[2]` (warm) snapshots have differently-laid-out DOM (e.g., service worker pre-caches the image, layout shifts differently on subsequent runs)
- **THEN** `report.absences[]` contains the cold-run findings only
- **AND** `report.absences[]` is byte-equal regardless of `runs[1..2]` snapshot contents
- **AND** changing `runs[1].pluginData['ohmyperf:domSnapshot']` does NOT change `report.absences[]`

### Requirement: Absence findings must reference taxonomy IDs that exist in the registry
Every `AbsenceFinding.id` SHALL be a valid `TaxonomyId` (key of `TAXONOMY_V1`).

#### Scenario: All absence findings have a corresponding taxonomy entry
- **WHEN** the diagnoser emits N absence findings
- **THEN** for every finding `f`, `getTaxonomyEntry(f.id)` returns a non-null entry
- **AND** the entry's `metric` matches the metric category of the absence check that emitted `f`

### Requirement: Absences must include an actionable expectedLocation when feasible
For each `AbsenceFinding`, `expectedLocation` SHALL be populated whenever the fix has a deterministic insertion point. Two location shapes are supported:
- `SourceLocation` — for DOM-level fixes (e.g., preload links go in `<head>`; specific source file/line if HTML source map is available).
- `{ kind: 'response-header', resourceUrl, header }` — for HTTP-header-level fixes (e.g., missing `Cache-Control`, missing `Content-Encoding`).
When the location cannot be inferred deterministically, `expectedLocation` SHALL be `undefined` rather than guessed.

#### Scenario: cache.static-asset-no-cache-control points to the response-header location
- **WHEN** a static `image/png` resource has no `Cache-Control` header
- **THEN** the absence finding's `expectedLocation === { kind: 'response-header', resourceUrl: <that-url>, header: 'cache-control' }`

#### Scenario: compression.large-text-uncompressed points to the response-header location
- **WHEN** a 50KB JS resource is served with no `Content-Encoding` or `Content-Encoding: identity`
- **THEN** the absence finding's `expectedLocation === { kind: 'response-header', resourceUrl: <that-url>, header: 'content-encoding' }`

### Requirement: Absence checks must not produce false positives on correctly-configured pages
A "golden" fixture page with explicit best-practice configuration (LCP preload present, all `<img>` sized, fonts with `font-display: swap`, all static assets cached with `Cache-Control: public, max-age=31536000, immutable`, all text resources gzip- or br-encoded) SHALL produce `report.absences.length === 0`.

#### Scenario: Best-practice fixture has zero absences
- **WHEN** the diagnoser runs on `tests/fixtures/golden-fixture/`
- **THEN** `report.absences` is the empty array
- **AND** `report.diagnoses` may still contain non-absence diagnoses derived from `audits`, but no absence-type findings
