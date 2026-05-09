# ADR-005: Report `schemaVersion`-versioned; shareable links via Cloudflare Workers + R2 + D1; Hono + S3 + Postgres parity for self-host

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: Sisyphus, Oracle (architecture), Metis (scope/risk)
- **Related design**: `design.md` D8; spec `reporting-and-sharing`; metrics-spec `metric-collection`

## Context

OhMyPerf reports must be shareable: a URL that anyone can open to see the measurement. The shareable-link feature carries non-trivial implications:

- **Backend ownership**: a hosted endpoint requires infra cost, ops, abuse-prevention, GDPR responsibilities (data-controller status), retention policy, optional auth.
- **Data shape evolution**: reports will change as the engine evolves. Without versioning, every refactor breaks every shared report ever produced.
- **Self-host requirement**: enterprise users will refuse cloud sharing; we need self-host parity from day one.

Storage primitive choice (relational DB vs object storage vs serverless KV) drives cost, scalability, and self-host complexity.

## Decision

### Schema versioning

Every emitted `Report` carries `schemaVersion: '1.0.0'` at the top level. The viewer is pinned to a major version and rejects unknown majors with a clear message. Future breaking changes bump the major (`2.0.0`) and ship a one-shot migration tool to upgrade older reports.

### Hosted backend stack

**Cloudflare Workers + R2 + D1.**

- `POST /api/share` — Worker validates schema, gzips, writes JSON blob to R2 (key = uuid), inserts a row in D1 (`id`, `r2Key`, `expiresAt`, `password_hash?`, `private?`, `owner?`).
- `GET /r/:id` — viewer route; `GET /api/r/:id` — JSON read.
- `GET /r/:id/trace` — 302 to a 5-minute presigned R2 URL.
- `DELETE /api/r/:id` — owner-only; soft-delete + tombstone for DSAR.
- `GET /api/dsar/:email` — DSAR enqueue.

EU users → R2 EU jurisdiction (set via Worker geo-routing). Default TTL 30 days; max 1 year. Trace artifacts have a separate, shorter TTL (7 days) to manage storage cost.

### Self-host parity

The same Hono application runs on Node + S3-compatible (MinIO, AWS S3, Wasabi) + Postgres, behind a ~200 LOC adapter (R2↔S3, D1↔Postgres). Published as `ohmyperf/share-server:<version>` Docker image. Integration-tested in CI against MinIO + Postgres.

### Why these primitives

- **Reports are immutable blobs.** Object storage is the right shape; relational DB only holds the index.
- **CF free tier covers indie launch** (R2: 10GB free, 1M ops/mo; D1: 5GB free; Workers: 100k/day) — operational risk is low.
- **Edge-distributed**: viewer feels instant globally.
- **Self-host parity is mandatory** for enterprise adoption.

## Alternatives considered

- **Postgres + Fly.io as primary**: overkill for blob storage, costs more, not edge-distributed. Postgres is still used for self-host.
- **Pure presigned-URL + object storage, no DB**: no auth/expiry/password/DSAR enforcement; URLs leak via referrer.
- **Vercel + KV**: more expensive at scale; tighter vendor lock-in than CF; less generous free tier for our shape.
- **AWS Lambda + S3 + RDS**: works, but costs more and self-host parity is harder when the cloud version is bound to AWS-specific services.

## Consequences

- (+) Cheap to operate at indie scale; edge latency global.
- (+) Self-host parity from day one; enterprise users have a clear path.
- (+) Schema versioning catches breaking changes early.
- (+) Object-storage primitive matches the data shape (immutable blobs).
- (-) Vendor commitment to Cloudflare for the hosted version (mitigated by self-host parity).
- (-) GDPR data-controller responsibilities once hosted shares ship (P4): Privacy Policy + DPA + DSAR + retention policy + counsel review BEFORE GA.
- (-) Trace artifact storage cost can grow unboundedly; mitigated by separate shorter TTL and cap on uncompressed size.

## Compliance / Validation

- `Report.schemaVersion` checked in JSON-schema validator on every test run; viewers reject unknown majors.
- Self-host integration test in CI against MinIO + Postgres; failure blocks release.
- Pre-GA legal checklist (Tasks 14.2): Privacy / Terms / DPA / DSAR pages reviewed by counsel BEFORE P4 ships hosted shares.
- Abuse prevention: 10 successful POSTs / hour / IP default; runtime denylist for repeat-abuse IPs and known phishing-target domains.
