# Tasks: Share + Export UI + Visual Identity (Track C)

## C1. Wire @ohmyperf/share-client into the SPA

- [ ] C1.1 Add `"@ohmyperf/share-client": "workspace:*"` to `apps/website/package.json` dependencies; run `pnpm install`.
- [ ] C1.2 Add `NEXT_PUBLIC_SHARE_ENDPOINT=` to `apps/website/.env.example` with a comment explaining what it does and the default Workers deploy URL.
- [ ] C1.3 Extend `apps/website/lib/env.ts` to expose `getShareEndpoint(): string | null` reading `process.env.NEXT_PUBLIC_SHARE_ENDPOINT`.

## C2. Share button

- [ ] C2.1 Create `apps/website/components/report/share-button.tsx`:
  - shadcn `Button` with `Share2` icon from `lucide-react`.
  - On click with no endpoint: shadcn `Popover` with a 3-line explainer + link to `docs/measurement-spa-deploy.md` Workers section.
  - On click with endpoint: set `pending=true`, call `uploadReport({ endpoint, report })`, on success → `navigator.clipboard.writeText(url)` + sonner toast "Share link copied" with URL in description, on `ShareSecretLeakError` → shadcn `AlertDialog` listing the leaked keys with "Share anyway (unsafe)" option (uses `skipRedaction: true`).
- [ ] C2.2 Add `data-testid="share-button"` for Playwright tests.
- [ ] C2.3 Handle the `pending=true` UI state with a `Loader2` spin icon.

## C3. Export menu

- [ ] C3.1 Create `apps/website/components/report/export-menu.tsx`:
  - shadcn `DropdownMenu` triggered by `Button` with `Download` icon.
  - Items: "Download JSON", "Download Markdown", "Copy as JSON", "Copy as Markdown".
- [ ] C3.2 "Download JSON" handler: `Blob` + `URL.createObjectURL` + temp `<a>` click + `URL.revokeObjectURL`. Filename `ohmyperf-<reportId>.json`.
- [ ] C3.3 "Download Markdown" handler: `renderMarkdown(report)` from `@ohmyperf/reporter-markdown` (verify browser-safe — if not, port the minimal markdown renderer inline in C3.x). Filename `ohmyperf-<reportId>.md`.
- [ ] C3.4 "Copy as JSON" handler: `navigator.clipboard.writeText(JSON.stringify(report))` + toast.
- [ ] C3.5 "Copy as Markdown" handler: same with `renderMarkdown(report)` + toast.
- [ ] C3.6 Add `data-testid="export-menu"` for tests.

## C4. Toolbar integration

- [ ] C4.1 In `apps/website/app/report/page.tsx`, find the `SingleReport` JSX. Add a toolbar `<div className="flex items-center justify-between mb-4">` above `CwvGauge`.
  - Left: existing "← All reports" link.
  - Right: `<ShareButton report={report} />` + `<ExportMenu report={report} />`.
- [ ] C4.2 Make the toolbar sticky on scroll: `sticky top-0 bg-background/90 backdrop-blur z-10 py-3 border-b`.

## C5. Share endpoint status pill in header

- [ ] C5.1 In `apps/website/components/layout/site-header.tsx`, add a small pill:
  - If `getShareEndpoint()` returns string → green badge "Share: connected" with hover tooltip showing the endpoint.
  - If null → muted badge "Share: not configured" linking to docs.
- [ ] C5.2 Hide pill on `/` landing if it adds noise (decide at implementation review).

## C6. Wrangler config + deploy docs

- [ ] C6.1 Create `packages/share-server/wrangler.toml`:
  - `name = "ohmyperf-share"`
  - `main = "src/workers.ts"`
  - `compatibility_date = "2026-05-01"`
  - `[[d1_databases]]` placeholder with `binding = "DB"`, `database_name = "ohmyperf-share-prod"`, `database_id = "REPLACE_AFTER_wrangler_d1_create"`
  - `[[r2_buckets]]` placeholder with `binding = "REPORTS"`, `bucket_name = "ohmyperf-reports"`
  - `[vars]` with `OHMYPERF_PUBLIC_BASE_URL = "https://share.ohmyperf.dev"`
- [ ] C6.2 Create `packages/share-server/wrangler.example.toml` — sanitized version for self-hosters; add to README.
- [ ] C6.3 Add `packages/share-server/migrations/0001_initial.sql` — emit `D1_SCHEMA` from `workers.ts:D1_SCHEMA` as a migration file.
- [ ] C6.4 Update `docs/measurement-spa-deploy.md`:
  - Append section "Deploy share-server to Cloudflare Workers" with the `wrangler d1 create` + `wrangler r2 bucket create` + `wrangler deploy` commands.
  - Document setting `NEXT_PUBLIC_SHARE_ENDPOINT` on the website host.

## C7. Visual identity — Calibre/SpeedCurve direction

- [ ] C7.1 Update `apps/website/app/globals.css` `@theme` block:
  - `--color-accent-primary: oklch(0.55 0.18 245)` (Calibre-style deep blue)
  - `--color-accent-success: oklch(0.65 0.18 145)` (CWV good)
  - `--color-accent-warning: oklch(0.75 0.18 70)` (CWV ni)
  - `--color-accent-danger: oklch(0.6 0.22 25)` (CWV poor)
  - Update `--color-primary` to reference `--color-accent-primary` (or set to the same blue)
  - Dark-mode counterparts in the `.dark` block
- [ ] C7.2 Update `apps/website/lib/format.ts`:
  - Replace hardcoded `#0cce6b`, `#ffa400`, `#ff4e42` with `var(--color-accent-success/warning/danger)`.
  - Where Tailwind class is needed, expose via `bg-[var(--color-accent-success)]` etc.
- [ ] C7.3 Re-run `pnpm test:a11y`; fix any new contrast violations.

## C8. Refactor ReportViewer to use shadcn primitives + wire orphans

- [ ] C8.1 In `apps/website/components/viewer/report-viewer.tsx`:
  - Wrap each section in shadcn `Card` + `CardHeader` + `CardTitle` + `CardContent`.
  - Replace `<table className="..."` with shadcn `Table` primitives where appropriate (`Table`, `TableHeader`, `TableRow`, `TableCell`).
  - Add `Separator` between sections.
  - Replace render-blocking yellow span with shadcn `Badge variant="warning"`.
- [ ] C8.2 Replace inline `UnstableBanner` with `<VarianceBanner report={report} />` (component already exists in `components/metrics/variance-banner.tsx`).
- [ ] C8.3 Replace inline `FrameNodeItem` recursion with `<FrameTree node={report.frameTree} />` (component already exists with collapse toggle in `components/metrics/frame-tree.tsx`).
- [ ] C8.4 Add `<Waterfall resources={firstWarmRun.resources} />` (from `components/metrics/waterfall.tsx`) below the ResourcesTable.
- [ ] C8.5 Audit: confirm there are zero unused components in `components/metrics/` after this change. If any remain orphaned (e.g. `MetricRow`), either wire them in or delete.
- [ ] C8.6 If `uplot` is still unused, remove from `apps/website/package.json` dependencies.

## C9. Acceptance

- [ ] C9.1 Re-measure any URL (e.g. `https://blog.thnkandgrow.com/`) end-to-end.
- [ ] C9.2 On the report page, verify:
  - Toolbar with "← All reports" + Share + Export visible
  - Share button works (with endpoint set → uploads + copies URL)
  - Export → Download JSON downloads a file
  - Export → Copy as Markdown puts valid markdown in clipboard
  - Waterfall chart renders below the resources table
  - Frame tree has a working collapse/expand toggle
  - Variance banner replaces the inline yellow text
  - Cards use shadcn primitives (visible `border` + `bg-card`)
  - Accent blue applied to primary buttons + good/warning/danger to metric colors
- [ ] C9.3 `pnpm test:a11y` green (no new contrast violations from new palette).
- [ ] C9.4 `pnpm test:smoke` green.
- [ ] C9.5 Deploy `share-server` to a personal Cloudflare account; verify `POST /api/share` from the SPA works against the deployed URL.
- [ ] C9.6 Bundle budget for `/report` route remains ≤ 250 KB gzip after the new components + share-client are added.
