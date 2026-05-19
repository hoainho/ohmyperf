# Spec: LLM-Native Failure-Mode Taxonomy

## ADDED Requirements

### Requirement: A frozen, versioned taxonomy registry must exist
`packages/core/src/taxonomy/v1.ts` SHALL export `TAXONOMY_V1` as `Object.freeze(...)` and `type TaxonomyId = keyof typeof TAXONOMY_V1`. The registry SHALL contain at least the twelve archetypes listed in `tasks.md §B1.2`. Each entry SHALL declare `{ metric, severity, repairArchetype, docUrl }`. The taxonomy module SHALL import nothing from `collectors-impl/`, `insights/`, or sibling plugins.

#### Scenario: Taxonomy registry exports the twelve v1 archetypes
- **WHEN** code calls `Object.keys(TAXONOMY_V1)`
- **THEN** the result is a superset of `['lcp.preload-missing','lcp.render-blocking-script','lcp.image-too-large','lcp.lcp-image-not-discoverable','inp.handler-too-long','inp.long-input-delay','cls.image-no-dimensions','cls.layout-shift-third-party','tbt.script-evaluation','font.display-swap-missing','cache.static-asset-no-cache-control','compression.large-text-uncompressed']`
- **AND** every entry has non-empty `metric`, `severity`, `repairArchetype`, and `docUrl` strings

#### Scenario: Taxonomy registry is genuinely frozen
- **WHEN** code attempts `TAXONOMY_V1['lcp.preload-missing'].severity = 'low'`
- **THEN** the assignment throws a `TypeError` in strict mode (or is silently rejected in sloppy mode)
- **AND** the read-back severity remains `'high'`

#### Scenario: Taxonomy module is a leaf in the dependency graph
- **WHEN** the build pipeline computes the import graph for `packages/core/src/taxonomy/v1.ts`
- **THEN** that file's transitive imports include zero files matching `collectors-impl/**` or `insights/**`

### Requirement: Reports must carry taxonomyVersion when diagnoses are emitted
When `Report.diagnoses` is present, `Report.taxonomyVersion` SHALL also be present and equal to the version string of the registry used to emit those diagnoses.

#### Scenario: Diagnoser emits taxonomyVersion alongside diagnoses
- **WHEN** the diagnoser plugin runs on a Report and emits at least one Diagnosis using `TAXONOMY_V1`
- **THEN** `Report.taxonomyVersion === 'v1'`
- **AND** `Report.diagnoses[*].id` are all keys of `TAXONOMY_V1`

#### Scenario: Reports without diagnoses omit taxonomyVersion
- **WHEN** a Report has no diagnoses (no audit was mappable)
- **THEN** `Report.taxonomyVersion` is undefined
- **AND** `Report.diagnoses` is undefined

### Requirement: Taxonomy IDs must satisfy the distinctness invariant
No two entries in a single taxonomy version SHALL share the same `(metric, repairArchetype)` tuple. This invariant is enforced by `tests/unit/taxonomy/distinctness.test.ts`.

#### Scenario: Distinctness lint catches a duplicate archetype
- **WHEN** a developer adds `lcp.foo` with `{ metric: 'lcp', repairArchetype: 'defer-or-move-script' }`
- **AND** the existing `lcp.render-blocking-script` already has `{ metric: 'lcp', repairArchetype: 'defer-or-move-script' }`
- **THEN** `tests/unit/taxonomy/distinctness.test.ts` fails with a message naming both IDs

### Requirement: Schema JSON for Diagnosis must be machine-validated
The committed `packages/core/src/schema/report.schema.json` SHALL include type schemas for `Diagnosis`, `AbsenceFinding`, and `SourceLocation`. CI SHALL fail if the committed schema differs from what `scripts/gen-schema.ts` regenerates from `types.ts`.

#### Scenario: Schema is regenerated cleanly in CI
- **WHEN** CI runs `pnpm gen:schema`
- **THEN** `git diff --quiet packages/core/src/schema/report.schema.json` exits 0

#### Scenario: All fixture reports validate against the schema
- **WHEN** `tests/schema/all-fixtures-validate.test.ts` runs
- **THEN** every JSON file under `tests/fixtures/reports/` validates against `report.schema.json` using ajv

### Requirement: Audits and Diagnoses coexist; neither replaces the other in v1.x
`Report.audits` SHALL remain present in every Report. `Report.diagnoses` SHALL be an additive, optional surface emitted by the diagnoser plugin. The presence of `diagnoses` SHALL NOT remove or modify entries in `audits`.

#### Scenario: A Report carries both surfaces
- **WHEN** the diagnoser plugin processes a Report that originally had `audits: [render-blocking-resources, unsized-images]`
- **THEN** the resulting Report has `audits.length >= 2` (both originals preserved unchanged)
- **AND** `diagnoses` contains at least `[lcp.render-blocking-script, cls.image-no-dimensions]`

#### Scenario: Unmapped audit IDs do not generate phantom diagnoses
- **WHEN** the audits include `experimental-foo-audit` which has no entry in `AUDIT_TO_DIAGNOSIS`
- **THEN** `experimental-foo-audit` remains in `audits[]`
- **AND** `diagnoses[]` contains NO entry derived from `experimental-foo-audit`
