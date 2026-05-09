# Capability: reporting-and-sharing

Reporters (JSON/HTML/MD/JUnit/CSV/HAR/Trace/Lighthouse-compat), the redaction pipeline, and the hosted shareable-link backend.

## ADDED Requirements

### Requirement: Reporters
The repository SHALL ship the following first-party reporters under `packages/reporters/`:

| Name | Output |
|---|---|
| `json` | Canonical `Report` JSON (the source of truth). |
| `html` | A self-contained HTML file built via Vite's `viteSingleFile`-style approach: inlined CSS, inlined JS, inlined fonts. The HTML embeds the same React viewer used by the website. Opens offline in any browser. |
| `markdown` | A human-readable summary with CWV table, top regressions, top audits, redaction summary. Suitable for PR comments. |
| `junit` | JUnit XML compatible with most CI consumers; one `<testcase>` per budget threshold. |
| `csv` | One row per metric per run (long format) for spreadsheets/BI. |
| `har` | HTTP Archive (HAR) format from the network capture, with redaction applied. |
| `trace` | A separate `.json.gz` file with the Chrome trace events. Loadable in `chrome://tracing` and Chrome DevTools Performance panel. |
| `lh-compat` | A Lighthouse-compatible JSON shape so existing LH report viewers can render it. Lossy (loses OhMyPerf-specific fields). |

#### Scenario: All reporters writable in one run
- **WHEN** `measure({ url, output: { dir: '/tmp/out', formats: ['json', 'html', 'markdown', 'junit', 'csv', 'har', 'trace', 'lh-compat'] } })` is invoked with `artifacts.trace: true` and `artifacts.har: true`
- **THEN** the output dir contains `report.json`, `report.html`, `report.md`, `report.junit.xml`, `report.csv`, `report.har`, `trace.json.gz`, `report.lh.json`
- **AND** every file passes its respective format validator

#### Scenario: HTML report is self-contained
- **WHEN** `report.html` is opened in a browser with no internet connection
- **THEN** the page renders fully (no missing fonts, no broken styles, no failed XHRs)

#### Scenario: JUnit output round-trips through CI consumers
- **WHEN** `report.junit.xml` is parsed by `junit-xml-validator`
- **THEN** zero schema errors are reported

### Requirement: Trace artifact handling
Trace artifacts SHALL be opt-in (default off). When opted in (`artifacts.trace: true` or `--trace`), the engine SHALL stream trace events directly to a gzip stream on disk. The engine SHALL warn at 50 MB uncompressed accumulated trace and SHALL refuse to proceed beyond 500 MB unless `--no-trace-cap` is provided. The report's `artifacts.traceRef` SHALL include `path`, `sizeBytes`, `sha256`.

#### Scenario: Trace within cap
- **WHEN** measurement runs against a moderately complex page with `--trace`
- **THEN** the resulting `trace.json.gz` is < 500 MB uncompressed
- **AND** `report.artifacts.traceRef.sha256` matches the sha256 of the file

#### Scenario: Trace cap exceeded
- **WHEN** measurement runs against a very long-lived page that produces > 500 MB of trace events
- **THEN** the run aborts with exit code 5 and a clear message
- **AND** the partial trace file is removed

### Requirement: Heap snapshot artifact handling
Heap snapshots SHALL be opt-in (default off). When opted in, the engine SHALL stream snapshots to disk via chunked `HeapProfiler.takeHeapSnapshot` events, applying the same default 500 MB cap. Heap snapshots SHALL NOT be uploaded as part of any default share.

#### Scenario: Heap default-off
- **WHEN** `measure({ url })` is invoked without `artifacts.heap: true`
- **THEN** no heap snapshot is taken
- **AND** `report.artifacts.heapRef` is `undefined`

### Requirement: Redaction pipeline
Before any report is shared (uploaded to the share-server, posted to a webhook plugin, or copied to the OS clipboard via the CLI's "share to clipboard" path), the engine SHALL apply the redaction pipeline:

1. Strip the following request and response headers (case-insensitive): `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key`, `x-auth-*`. Replace values with the literal string `[REDACTED]`.
2. Strip URL query params matching (case-insensitive, exact name): `token`, `key`, `secret`, `password`, `api_key`, `auth`, `session`, `sid`, `access_token`, `refresh_token`, `code`, `state`. Replace values with `[REDACTED]`.
3. Strip request bodies entirely from the HAR section by default. The user MAY opt in via `share.includeBodies: true` in config or `--include-bodies` on the CLI.
4. Blur screenshots (in the screenshot artifacts AND in any inline screenshots embedded in the HTML report) over `<input type="password">`, `<input type="email">`, elements matching `[autocomplete=cc-*]`, elements with `[data-private]`, using box-redaction at composite step. The blur SHALL be applied in pixel space (not via DOM CSS) so it survives screenshot transmission.
5. Strip cookie values (keep names + paths) from the HAR.
6. Run a pre-share scrubber that scans the report (all string fields recursively, including HAR bodies if opted in) for substring matches against `process.env` values. Allow-list entries with the prefix `OHMYPERF_*` (treated as configuration, not secrets). On any hit, the share is refused (CLI exit code 10) with a structured list of `(field, location)` pairs and an `--unsafe-share-with-secrets` opt-out.

The user MAY extend the redaction lists in `ohmyperf.config.ts`:

```ts
export default defineConfig({
  redact: {
    extraHeaders: ['x-internal-trace'],
    extraQueryParams: ['cf_clearance'],
    extraBodyPatterns: [/Bearer [A-Za-z0-9._-]+/g],
  },
});
```

#### Scenario: Authorization header redacted
- **WHEN** a report contains a request entry with `headers.authorization === 'Bearer abc.def.ghi'`
- **AND** the report goes through the redaction pipeline
- **THEN** the resulting HAR has `headers.authorization === '[REDACTED]'`
- **AND** the original token does not appear anywhere else in the redacted report

#### Scenario: Token query param redacted
- **WHEN** a request URL is `https://api.example/users?api_key=abc123&page=2`
- **THEN** after redaction the URL is `https://api.example/users?api_key=[REDACTED]&page=2`

#### Scenario: Password input blurred in screenshot
- **WHEN** a screenshot was taken on a page containing `<input type="password" id="pw">` whose bounding box is { x: 100, y: 200, w: 200, h: 30 }
- **THEN** the redacted screenshot has that pixel rectangle replaced by an opaque solid color or gaussian blur
- **AND** OCR over the redacted screenshot returns no characters in that rectangle

#### Scenario: Pre-share scrubber refuses leak
- **WHEN** an env var `STRIPE_KEY=sk_live_abcd1234` is set
- **AND** a report contains the substring `sk_live_abcd1234` in any HAR header value
- **AND** the user runs `ohmyperf share <report>`
- **THEN** the upload is refused
- **AND** stderr lists the field path where the substring was found
- **AND** the CLI exits with code 10

### Requirement: Confirmation preview before upload
The CLI's `share` subcommand SHALL display a confirmation preview summarizing redactions performed and SHALL await user confirmation (Enter / `y`) unless `--yes` is provided. The preview SHALL include: number of headers redacted, number of query params redacted, number of bodies stripped, number of screenshots with blurs, scrubber findings.

#### Scenario: Preview displayed
- **WHEN** `ohmyperf share <report>` is invoked on a TTY without `--yes`
- **THEN** the CLI prints the preview and waits for confirmation BEFORE uploading
- **AND** answering `n` or pressing Ctrl-C cancels the upload with exit code 0 (user-initiated cancel)

### Requirement: Share-server API
The share-server SHALL expose:

| Method & Path | Behavior |
|---|---|
| `POST /api/share` | Accept gzipped report JSON (≤ 10 MB compressed) + optional `password`, `expiresAt`, `private`. Validate schema. Return `{ id, url, expiresAt }`. |
| `GET /r/:id` | Return the rendered viewer HTML. The viewer fetches `GET /api/r/:id` for the JSON. Apply password gate if set. |
| `GET /api/r/:id` | Return the report JSON (with `Cache-Control: private, max-age=300`). |
| `GET /r/:id/trace` | Return a 302 redirect to a presigned R2 URL for the trace artifact (only if uploaded). 5-minute presign. |
| `DELETE /api/r/:id` | Owner-only soft-delete. Returns 204. The record is tombstoned for DSAR. |
| `GET /api/dsar/:email` | DSAR endpoint: enqueues a scan and returns a tracking ticket. |
| `GET /healthz` | Liveness probe. |

The server SHALL set `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff` on every response.

#### Scenario: Successful POST
- **WHEN** `POST /api/share` is invoked with a valid gzipped report and `expiresAt: <30 days from now>`
- **THEN** the response is 201 Created with body `{ id, url, expiresAt }`
- **AND** subsequent `GET /api/r/:id` returns the report JSON

#### Scenario: Oversized upload rejected
- **WHEN** `POST /api/share` is invoked with a gzipped body > 10 MB
- **THEN** the response is 413 Payload Too Large with a JSON `{ error, maxBytes }`
- **AND** no R2 PUT is performed

#### Scenario: Password-protected access
- **WHEN** a report was created with `password: 'secret'`
- **AND** `GET /api/r/:id` is invoked without an `Authorization: OhMyPerf <token>` header
- **THEN** the response is 401 Unauthorized
- **AND** the body contains no report fields beyond a generic error message

### Requirement: Self-host parity
The share-server source SHALL build into a Docker image (`ohmyperf/share-server:<version>`) that runs the same Hono application on Node, backed by S3-compatible object storage (MinIO, Wasabi, AWS S3) + Postgres. The R2/D1 vs S3/Postgres split SHALL be encapsulated in a `~200 LOC` adapter; the rest of the codebase SHALL be backend-agnostic.

#### Scenario: Self-host stack works
- **WHEN** an integrator deploys `ohmyperf/share-server:1.0.0` against MinIO + Postgres
- **THEN** the same end-to-end share flow works (POST → GET → DELETE → DSAR)
- **AND** all integration tests pass against this self-host stack in CI

### Requirement: Default TTLs
The share-server SHALL apply a default expiry of 30 days when the client supplies no `expiresAt`. The maximum allowable expiry SHALL be 1 year. Trace artifacts SHALL have a separate, shorter default TTL (7 days) to manage storage cost; expired traces SHALL be deleted while their parent report remains readable (with a "trace artifact expired" notice in the viewer).

#### Scenario: Default TTL applied
- **WHEN** a client POSTs without `expiresAt`
- **THEN** the stored row has `expiresAt = createdAt + 30 days`

#### Scenario: Trace expiry independent of report expiry
- **WHEN** 8 days after share creation the user navigates `/r/:id`
- **THEN** the report renders normally
- **AND** the "View trace" button shows "trace artifact expired" instead of returning 404 for the parent report

### Requirement: Abuse prevention
The share-server SHALL apply per-IP and per-account-where-known rate limits (default: 10 successful POSTs / hour / IP, configurable). The server SHALL maintain a denylist for repeat-abuse IPs and a known-bad-domain list (e.g. obvious phishing-target URLs). Reports against denylisted domains MAY be rejected at upload time.

#### Scenario: Rate limit triggers
- **WHEN** a single IP performs 11 POST /api/share calls in one hour
- **THEN** the 11th call returns 429 Too Many Requests with `Retry-After`
