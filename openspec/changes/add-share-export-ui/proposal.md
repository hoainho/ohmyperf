# Proposal: Share + Export UI + Visual Identity (Track C)

## Why

The post-MVP audit (Sisyphus 2026-05-17) found two gaps that limit OhMyPerf's daily usefulness:

1. **The SPA has zero share/export UI.** `@ohmyperf/share-client` exists and works end-to-end via CLI (`ohmyperf share report.json`). `@ohmyperf/share-server` is fully implemented (Hono + R2 + D1 adapter, FileSystem adapter, redaction pipeline). But the SPA's `/report` route has no "Share via link" button, no "Download JSON" button, no "Copy as Markdown" button. The website's `package.json` doesn't even depend on `@ohmyperf/share-client`. Every measurement is trapped in the user's IndexedDB.

2. **The Report UI is a colorless data dump.** `apps/website/app/globals.css` defines the entire design palette in OKLCH with `chroma=0` (pure grayscale). There is no brand hue. The `ReportViewer` doesn't use any shadcn components — it's raw Tailwind divs and tables. Six fully-built components in `apps/website/components/metrics/` (`Waterfall`, collapsible `FrameTree`, `VarianceBanner`, `MetricRow`, `AuditsList`, `WaterfallChart`) are **orphaned** — never imported by `ReportViewer`. `uplot` is installed as a dependency but used nowhere.

User chose **Calibre / SpeedCurve** as the visual direction: perf-tool aesthetic, dense data, blue accent, trend-friendly. This change closes the share gap and re-skins the SPA to that direction.

(Note: this change depends on Track A + Track B landing for the engine-side data the new UI surfaces. The UI scaffold can be built in parallel with mocked data, then the wiring done after A+B merge.)

## What changes

### Added — Share + Export

- `apps/website/package.json` — add `@ohmyperf/share-client: workspace:*` dependency.
- `apps/website/lib/env.ts` — read `NEXT_PUBLIC_SHARE_ENDPOINT` (optional). When unset, share UI shows "Self-host a share-server to enable sharing" instead of being broken.
- `apps/website/components/report/share-button.tsx` — primary action button. On click:
  - If endpoint unset: open a popover explaining `OHMYPERF_SHARE_ENDPOINT` env var + Workers deploy link.
  - If endpoint set: call `uploadReport({ endpoint, report })` from `@ohmyperf/share-client`. Show loading state. On success: copy `url` to clipboard + show toast "Share link copied" with the URL displayed.
  - On `ShareSecretLeakError`: show a destructive dialog listing the leaked keys + suggest `--unsafe-share-with-secrets` flag (CLI only).
- `apps/website/components/report/export-menu.tsx` — secondary action. shadcn `DropdownMenu` with items:
  - "Download JSON" — `new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })` → `<a download>`.
  - "Copy as Markdown" — call `renderMarkdown(report)` from `@ohmyperf/reporter-markdown` (browser-safe, no Node APIs). Copy result to clipboard.
  - "Copy as JSON (compact)" — single-line JSON to clipboard.
- `apps/website/app/report/page.tsx` — wire `ShareButton` + `ExportMenu` into the report toolbar (next to "← All reports").
- `packages/share-server/wrangler.toml` — NEW deployment config (Workers + R2 + D1 bindings). Includes inline comment instructions for `wrangler d1 create` / `wrangler r2 bucket create`.
- `packages/share-server/wrangler.example.toml` — annotated sample for self-hosters.

### Added — Visual identity (Calibre/SpeedCurve direction)

- `apps/website/app/globals.css` — extend `@theme` block with brand hues:
  - `--color-accent-primary: oklch(0.55 0.18 245)` (deep blue, Calibre-like)
  - `--color-accent-success: oklch(0.65 0.18 145)` (green for "good" metrics)
  - `--color-accent-warning: oklch(0.75 0.18 70)` (amber for "needs improvement")
  - `--color-accent-danger: oklch(0.6 0.22 25)` (red for "poor")
  - Update existing `--color-primary` to the accent-primary blue (was achromatic gray)
  - Dark mode counterparts
- `apps/website/lib/format.ts` — update hardcoded `#0cce6b / #ffa400 / #ff4e42` to use CSS vars from globals (so theme switches cascade).
- `apps/website/components/viewer/report-viewer.tsx` — refactor to use shadcn `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Badge`, `Separator`, `Tabs`, `Accordion` (already in `components/ui/`) instead of raw divs.
- `apps/website/components/viewer/report-header.tsx` — extract into its own file, use shadcn `Card` + `Badge` for the meta-row.

### Modified — Wire orphan components

- `apps/website/components/viewer/report-viewer.tsx`:
  - Import and use `Waterfall` (from `metrics/waterfall.tsx`) inside the resources block.
  - Import and use `FrameTree` (from `metrics/frame-tree.tsx`) with its built-in collapse toggle, replacing the inline `FrameNodeItem`.
  - Import and use `VarianceBanner` (from `metrics/variance-banner.tsx`), replacing the inline `UnstableBanner`.
  - Import and use `AuditsList` (the component, not inline) — but keep the simpler inline if Track B's `InsightsSection` already absorbs it.
- `apps/website/package.json` — remove unused `uplot` dependency (or wire it into a sparkline component if Track B's history view uses it). Decide at implementation time.

### Modified — Header CTA

- `apps/website/components/layout/site-header.tsx` — add a small "Share endpoint: connected / not set" status pill so users always know if they can share.

## Out of scope

- Multi-user accounts / auth on share-server (still anonymous + password-gated).
- Workspaces / team sharing.
- Trend sparklines / history charts (require share-server-side storage of historical runs; deferred to v1.2 once we know real usage).
- The 5 stub reporters (csv/har/junit/lh-compat/trace) — Track D candidate.

## Success criteria

1. SPA `/report` page has a visible "Share" button.
2. Clicking Share with a configured endpoint uploads the Report and copies the URL to clipboard.
3. Clicking Share without an endpoint shows a help popover; nothing breaks.
4. "Download JSON" downloads a valid `report-<id>.json`.
5. "Copy as Markdown" puts a valid markdown string in clipboard.
6. The SPA visually adopts the Calibre/SpeedCurve direction: accent blue on primary buttons + active states, good/ni/poor color cascade via CSS vars, ReportViewer uses shadcn cards.
7. The 6 orphan components are wired in (zero dead code in `apps/website/components/metrics/`).
8. `pnpm test:a11y` still green (no new contrast violations from the new palette).
9. `packages/share-server/wrangler.toml` deploys cleanly to a personal Cloudflare account.

## Risks

- **New brand palette may regress a11y.** Mitigation: chose OKLCH values vetted against `#fff` and `#1a1a1a` backgrounds for ≥4.5:1 contrast on text. Will re-run `pnpm test:a11y` and the manual `tests/MANUAL-keyboard.md` checklist.
- **Workers + R2 + D1 deploy needs a Cloudflare account.** Mitigation: deploy is optional — local `node share-server` still works for self-hosters. `wrangler.example.toml` documents the path.
- **Removing `uplot` may break some half-written future feature.** Mitigation: `git grep uplot` confirmed zero usages today; safe to remove or keep dormant.
