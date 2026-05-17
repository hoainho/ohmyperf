# Pull Request

## Summary

<!-- One sentence: what changes and why. -->

## Surfaces touched

Tick every surface this PR touches. PRs that touch `packages/core/` MUST fill in the cross-surface impact review below.

- [ ] `packages/core/` — engine, types, plugin runtime (**frozen API — see impact review below**)
- [ ] `packages/driver-playwright/`
- [ ] `packages/driver-extension/`
- [ ] `packages/plugins-builtin/`
- [ ] `packages/reporter-*`
- [ ] `packages/trace-utils/`
- [ ] `packages/viewer/`
- [ ] `packages/share-client/`
- [ ] `packages/share-server/`
- [ ] `apps/cli/`
- [ ] `apps/runner/`
- [ ] `apps/website/`
- [ ] `apps/extension-chrome/`
- [ ] `apps/ide-vscode/`
- [ ] `apps/mcp-server/`
- [ ] OpenSpec change / spec (`openspec/changes/**` or `openspec/specs/**`)
- [ ] CI / tooling (`.github/`, `scripts/`, `eslint.config.js`, etc.)

## Cross-surface impact review (mandatory for `packages/core/` changes)

Engine changes have downstream impact on every surface. Address each:

- **API surface (api-extractor)**: any `core.api.md` diff? Additive only? Or breaking?
- **CLI**: any `EXIT_CODES` change, new flag, behaviour change?
- **Extension**: does the `driver-extension` capability set still satisfy the new engine contract?
- **MCP server**: any new args / response fields in the `measure` tool?
- **Share-client / share-server**: schema version change? new redaction surface?
- **Viewer (HTML reporter + SPA `report-viewer.tsx`)**: any new field a viewer must render?
- **Reporters (json/html/markdown)**: do they handle the new field gracefully when absent?

If any of the above is "yes", link to the matching follow-up task in OpenSpec or this PR.

## Acceptance

- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean (no `--no-warnings` workaround)
- [ ] `pnpm test` green on affected packages
- [ ] `pnpm api:check` clean (if `packages/core/` touched)
- [ ] `pnpm license:audit` clean (if dependencies changed)
- [ ] `pnpm test:smoke` and `pnpm test:a11y` green (if `apps/website/` touched)
- [ ] OpenSpec proposal / spec updated (if behaviour changes)
- [ ] No new color-contrast violations (if `globals.css` or component styling touched)

## Notes for reviewers

<!--
Anything reviewers should focus on?
Any decisions you're uncertain about?
Any tests that intentionally pass with conditions (skipped fixtures, deferred parity)?
-->
