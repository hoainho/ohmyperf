# Capability: website-surface

The static report viewer + landing site at `ohmyperf.dev`, including the Chrome extension download and (when shipped) the hosted shareable-link UI.

## ADDED Requirements

### Requirement: Static drag-drop report viewer
The website SHALL host a static page at `https://ohmyperf.dev/viewer` that accepts a JSON report via drag-drop, file-picker, or paste, validates it against the `1.0.0` schema, and renders the same viewer used by the HTML reporter and the IDE webview. No upload to any backend SHALL be required for this path.

#### Scenario: Drag-drop renders report
- **WHEN** a user navigates to `/viewer` and drops a valid `report.json`
- **THEN** the page renders: meta header (URL, mode, browser version, run count), CWV summary tiles (LCP/CLS/INP/FCP/TTFB with median + CoV + unstable flag), waterfall, frame-tree visualization, audits list
- **AND** no network request is made to upload the report

#### Scenario: Invalid report rejected
- **WHEN** a user drops a file whose content is not valid JSON or is missing `schemaVersion`
- **THEN** the viewer displays "Invalid report" with a link to schema docs
- **AND** no further rendering or processing occurs

### Requirement: Landing page
The website SHALL host a landing page at `https://ohmyperf.dev/` describing the tool's value proposition (real-machine + 99% iframe + CI ergonomics + 4 surfaces), with prominent calls-to-action: "Install the CLI", "Get the Chrome extension", "View a sample report", "Read the docs".

#### Scenario: Landing renders
- **WHEN** a user navigates to `https://ohmyperf.dev/`
- **THEN** the page returns HTTP 200 with the landing content
- **AND** the page passes axe-core a11y audit at WCAG 2.1 AA in CI
- **AND** Lighthouse mobile score on the landing page itself is ≥ 90 across performance, accessibility, best-practices, and SEO

### Requirement: Chrome extension distribution
The website SHALL provide a download/install link for the Chrome extension via the Chrome Web Store. The link SHALL be visible on the landing page and via `/extension`. The website SHALL detect non-Chromium browsers and SHALL display "Currently Chrome and Edge only — install the CLI for Firefox/Safari" inline.

#### Scenario: Non-Chromium UA
- **WHEN** a Firefox UA fetches `/extension`
- **THEN** the page displays the "Chrome/Edge only" notice and prominently surfaces the CLI as the alternative

#### Scenario: Edge supported
- **WHEN** an Edge UA fetches `/extension`
- **THEN** the page surfaces the same Chrome Web Store install link (Chromium Edge supports CWS)

### Requirement: Hosted shareable-link viewer (P4)
The website SHALL host shareable reports at URLs of the form `https://ohmyperf.dev/r/<id>`. The viewer SHALL fetch the report via the share-server API, render it, and SHALL NOT execute any plugin code from the report (per the `plugin-system` capability). Optional features: password prompt (when set), expiry display, owner-only delete button (when authenticated as owner).

#### Scenario: Public share renders
- **WHEN** a user navigates to `https://ohmyperf.dev/r/abcd1234` for a public, non-expired report
- **THEN** the viewer fetches the report, renders all panels, and displays expiry date
- **AND** the page sets `Cache-Control: private, max-age=300` and `Referrer-Policy: no-referrer`

#### Scenario: Password-protected share
- **WHEN** a user navigates to a password-protected share URL
- **THEN** the viewer prompts for the password BEFORE the report is fetched (the share-server enforces, the viewer requests)
- **AND** wrong-password responses do NOT leak any report metadata

#### Scenario: Expired share
- **WHEN** a user navigates to a share whose `expiresAt` has passed
- **THEN** the viewer displays a 410 Gone page with the original creation date but no report content

### Requirement: Viewer accessibility
The viewer SHALL meet WCAG 2.1 AA. The repository SHALL run `axe-core` against the viewer in CI and SHALL fail the build on any violations.

#### Scenario: a11y CI gate
- **WHEN** the website CI workflow runs `pnpm test:a11y` against the built viewer
- **THEN** zero axe-core violations are reported at WCAG 2.1 AA
- **AND** the workflow exits 0

### Requirement: Privacy & policy pages
Before P4 GA the website SHALL host `/privacy`, `/terms`, `/dpa`, and a `/dsar` (Data Subject Access Request) endpoint at `https://ohmyperf.dev/dsar`. The landing page SHALL link to `/privacy` from the footer.

#### Scenario: Privacy page exists pre-P4-GA
- **WHEN** P4 ships hosted shareable links
- **THEN** `/privacy`, `/terms`, `/dpa`, `/dsar` are reachable, return HTTP 200, and have been reviewed by counsel (recorded in the project's PRE_GA_CHECKLIST.md)

### Requirement: No third-party trackers
The website SHALL NOT embed Google Analytics, Segment, Mixpanel, Hotjar, Sentry public DSN, or any third-party analytics/marketing scripts on the landing or viewer pages. First-party privacy-friendly analytics (e.g. self-hosted Plausible, Cloudflare Web Analytics) MAY be used after legal review.

#### Scenario: No trackers in built site
- **WHEN** the website is deployed and a user loads the landing page
- **THEN** the page makes zero network requests to Google, Segment, Mixpanel, Hotjar, or any third-party analytics origin

### Requirement: Sample report
The website SHALL host a sample shareable report at `https://ohmyperf.dev/r/sample` that survives schema migrations across `1.x`. The sample is curated to demonstrate every panel (CWV summary, waterfall, frame tree with OOPIFs, audits, redaction badges).

#### Scenario: Sample renders on every release
- **WHEN** a release tag triggers the website CI
- **THEN** an end-to-end Playwright test renders `/r/sample` and asserts every panel is present
- **AND** the test exits 0
