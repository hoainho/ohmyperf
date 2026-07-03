# Issue & PR Label Taxonomy

OhMyPerf uses a structured label system. Every issue should have at least one
`type/*`, one `area/*`, and one `priority/*` label after triage.

To bulk-create these labels in your fork, run [`scripts/setup-labels.sh`](./scripts/setup-labels.sh)
with the `gh` CLI authenticated.

## type/* — what kind of work?

| Label | Color | Meaning |
|---|---|---|
| `type/bug` | `#d73a4a` | Something measured wrong, crashed, or behaved unexpectedly |
| `type/feature` | `#0e8a16` | New capability, metric, plugin, or surface |
| `type/enhancement` | `#0e8a16` | Improvement to an existing capability |
| `type/docs` | `#0075ca` | README, /docs, code comments, API reference |
| `type/refactor` | `#a2eeef` | Internal cleanup, no behavior change |
| `type/test` | `#bfd4f2` | Adding or fixing tests |
| `type/chore` | `#cfd3d7` | Build, CI, tooling, deps |
| `type/question` | `#d876e3` | A question, not a request for change |
| `type/security` | `#ee0701` | Security advisory or hardening |

## area/* — which surface is affected?

| Label | Surface |
|---|---|
| `area/core` | `packages/core` — engine, plugin runtime, frozen API |
| `area/cli` | `apps/cli` |
| `area/mcp` | `apps/mcp-server` |
| `area/extension-chrome` | `apps/extension-chrome` |
| `area/extension-vscode` | `apps/ide-vscode` |
| `area/viewer` | `apps/website`, `packages/viewer` |
| `area/eslint` | `packages/eslint-plugin` |
| `area/fixers` | `packages/fixers` |
| `area/reporter` | `packages/reporter-*` |
| `area/driver-playwright` | `packages/driver-playwright` |
| `area/driver-extension` | `packages/driver-extension` |
| `area/trace-utils` | `packages/trace-utils` |
| `area/share-server` | `packages/share-server` |
| `area/share-client` | `packages/share-client` |
| `area/ci` | `.github/workflows`, scripts |
| `area/docs` | `/docs`, README |
| `area/openspec` | `openspec/changes/**`, `openspec/specs/**` |

## priority/* — urgency

| Label | Color | Meaning |
|---|---|---|
| `priority/critical` | `#b60205` | Data corruption, security, blocks all users. Fix today. |
| `priority/high` | `#d93f0b` | Blocks a major use case. Next release. |
| `priority/medium` | `#fbca04` | Important but not blocking. This quarter. |
| `priority/low` | `#0e8a16` | Nice to have. No timeline. |

## status/* — workflow state

| Label | Meaning |
|---|---|
| `status/needs-triage` | New issue, not yet reviewed by a maintainer |
| `status/needs-repro` | Awaiting reproducible example from filer |
| `status/needs-design` | Requires OpenSpec change proposal before code |
| `status/accepted` | Ready to be picked up by a contributor |
| `status/in-progress` | Someone is actively working on it |
| `status/blocked` | Blocked by external dep or another issue |
| `status/stale` | No activity for 30+ days; will close in 14 |
| `status/wontfix` | Intentionally not addressing |

## Recruiting labels — get contributors

| Label | Color | When to apply |
|---|---|---|
| `good-first-issue` | `#7057ff` | Small, well-scoped, documented, requires < 4h work. Apply only after writing a clear acceptance-criteria comment. |
| `help-wanted` | `#008672` | Maintainer doesn't have bandwidth; contributor takeover welcomed. |
| `hacktoberfest` | `#ff8c00` | During October only, on issues we'd accept Hacktoberfest PRs for. |
| `mentor-available` | `#fef2c0` | Maintainer commits to active mentorship for whoever takes this. |

## Meta labels

| Label | Meaning |
|---|---|
| `breaking-change` | Touches the frozen `core` API surface |
| `dependencies` | Upgraded by Dependabot or Renovate |
| `duplicate` | Same as another issue; closer should link the original |
| `invalid` | Doesn't appear to be a real issue |
| `discussion` | Move this to GitHub Discussions instead |

## Anti-patterns to avoid

- Don't add `bug` and `feature` to the same issue. Pick one.
- Don't leave `needs-triage` on issues older than 7 days.
- Don't apply `good-first-issue` without writing acceptance criteria first — orphan tickets repel new contributors faster than no tickets.
- Don't use both `priority/critical` and `priority/low` (yes, this happens).
