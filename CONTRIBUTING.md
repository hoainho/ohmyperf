# Contributing to OhMyPerf

Thanks for considering a contribution. This document captures the conventions
that keep the codebase honest and the agent loop reliable.

## Quick start

```bash
git clone https://github.com/hoainho/ohmyperf
cd ohmyperf
pnpm install
pnpm build
pnpm test          # 387 tests across 18 workspaces
pnpm typecheck     # strict TS with exactOptionalPropertyTypes
pnpm lint          # import-layering + style rules
```

Node ≥ 22, pnpm ≥ 10.

## What this project values

OhMyPerf measures real performance on real browsers. The codebase reflects that
discipline: **every numeric claim is grounded in a tool call, never in agent
intuition**. PRs that paper over real measurement variance to make numbers look
better will be rejected.

Specifically:

- **No synthetic numbers in real-mode.** If a metric is unreliable, the report
  must say `unstable: true` and surface the CoV. Don't hide noise.
- **No silent fallbacks.** If `Input.dispatchMouseEvent` can't find a target,
  the report explicitly says so — it does not silently return INP=0.
- **No type-safety escape hatches.** `as any`, `@ts-ignore`, and
  `@ts-expect-error` are blocked at lint time. Same goes for empty
  `catch (e) {}` blocks.
- **Tests fail fast.** Deleting or skipping a failing test to ship a PR is
  considered a Forbidden Practice (see `docs/HARNESS.md`).

## Submitting a change

1. **Open an issue first** for non-trivial work. Even a one-line description is
   enough — the issue ID becomes the audit trail.
2. **Branch from `main`**, with one of these prefixes: `feat/`, `fix/`,
   `docs/`, `refactor/`, `chore/`, `test/`, `perf/`.
3. **Match existing patterns.** Sample 2-3 similar files before introducing a
   new convention. If you genuinely need a new pattern, propose it in the
   issue.
4. **Run the validation ladder before pushing**:
   - `pnpm typecheck` (clean across all 18 workspaces)
   - `pnpm lint` (no new warnings)
   - `pnpm test` (no new failures, no new skips)
   - `pnpm build` (exit code 0 in turbo)
5. **Keep commits atomic.** One logical change per commit, with a message that
   explains the *why*, not the *what*.
6. **Open a pull request.** The PR template will ask you to confirm the
   ladder ran green.

## OpenSpec proposals

Significant changes — anything that touches the public API surface, the report
schema, or the plugin interface — must include an OpenSpec proposal in
`openspec/`. See an example at `openspec/specs/`.

For tiny PRs (typo, dependency bump, internal refactor), an OpenSpec is not
required.

## Tested-in-production discipline

Every PR that adds a user-facing feature must include either:

- A test against a real production URL (`test:real-world` validation layer
  from `docs/HARNESS.md`), or
- An explanation in the PR description of why a synthetic fixture is
  sufficient.

"It compiled" is not evidence the feature works.

## Reporting performance bugs in the measurement engine

If you find a case where OhMyPerf reports a CWV value materially different
from the real user experience (>15% drift after `mode: "ci-stable"` with
runs=10), please file an issue with:

1. Full repro URL.
2. The full `report.json` (drag-drop onto `https://ohmyperf.dev/viewer` to
   verify it's parseable, then paste).
3. The expected value + how you measured it independently (RUM data,
   Lighthouse score, WebPageTest run, etc.).

Measurement bugs are P0.

## Security

See [SECURITY.md](./SECURITY.md). Do not file security issues in public.

## License

By contributing, you agree your contribution is licensed under Apache-2.0
(matching the repo).

Thank you.
