# Additions to merge into CONTRIBUTING.md

The existing `CONTRIBUTING.md` is solid. Add these two new sections.

---

## Your first PR (≈ 30 minutes from clone to merged)

### 1. Pick an issue

Browse [good-first-issues](https://github.com/hoainho/ohmyperf/labels/good-first-issue).
Each has acceptance criteria + hints. Comment "I'd like to take this" to
claim it — we'll assign you and label it `status/in-progress`.

### 2. Fork + clone + branch

```bash
gh repo fork hoainho/ohmyperf --clone --remote
cd ohmyperf
git checkout -b fix/issue-<NN>-short-description
```

### 3. Install + verify the toolchain works

```bash
# Node ≥ 22 required
nvm use 22

# pnpm is the package manager (pinned via `packageManager` in package.json)
corepack enable
pnpm install

# Bootstrap turbo cache
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

If any of these fail on a clean checkout BEFORE you change anything, open an
issue — that's a bug we want to know about.

### 4. Make the change

- Touch the smallest possible surface. Don't refactor unrelated code in the
  same PR.
- If you're touching `packages/core/`, you MUST fill in the cross-surface
  impact section of the PR template (it's not theatre — engine changes have
  real downstream impact on 8 surfaces).
- Add a test. PRs without tests get bounced unless the change is docs-only or
  the maintainer explicitly waives.

### 5. Pre-flight checks (must pass before opening PR)

```bash
pnpm build           # exit 0
pnpm test            # all green
pnpm typecheck       # no errors on touched packages
pnpm lint            # no errors on touched files
pnpm api:check       # only if you touched packages/core
```

### 6. Commit

Conventional commits, scope = touched package or surface:

```
feat(cli): add --quiet flag to suppress INFO logs

Closes #N
```

Common scopes: `cli`, `mcp`, `core`, `viewer`, `eslint`, `fixers`,
`reporter-markdown`, `extension-chrome`, `extension-vscode`, `docs`, `ci`.

### 7. Open the PR

```bash
gh pr create --fill --web
```

Fill in the PR template completely. The "Surfaces touched" checklist is
required — it's what reviewers use to scope their review.

### 8. Review cycle

- First maintainer response: typically < 24h.
- We label `status/needs-changes`, `status/approved`, or merge directly.
- If a reviewer asks for changes, push to the same branch — DON'T open a new PR.
- After merge, you get a thank-you in the next CHANGELOG entry and an
  invite to the contributors list.

## Mentorship

Issues labeled `mentor-available` come with a maintainer who commits to:

- Answering questions within 24h
- Reviewing your branch as you push, not just at the end
- Pairing for 30 min if you get stuck

Ping in the issue with "I'd like a mentor on this" and we'll set it up.

## Coding conventions

- **TypeScript strict mode everywhere.** No `any`, no `@ts-ignore`. If
  TypeScript fights you, ask in the PR — usually the type model needs updating.
- **Tests are co-located** with source: `src/foo.ts` ↔ `tests/foo.test.ts`.
- **Public APIs in `packages/core` are frozen.** Additive changes only; breaking
  changes require an OpenSpec proposal first.
- **No new top-level deps without discussion.** Comment on the issue first;
  every dep is an attack surface and a maintenance cost.
- **Reporter output is part of our API.** Changing a field name = breaking
  change. Adding a field = additive.

## What gets rejected

- PRs that touch 5+ unrelated files. Split into multiple PRs.
- PRs without tests for behavior changes.
- "Drive-by" refactors that change formatting/style for the sake of it.
- Adding dependencies without discussion.
- PRs that ignore the cross-surface impact review for `core` changes.
- Renaming public API fields without an OpenSpec migration plan.

## Hacktoberfest

During October, issues labeled `hacktoberfest` are explicitly opted in.
Standard rules apply: meaningful contributions only; spam/typo-fix PRs
that don't move the needle will be labeled `invalid` and not count.
