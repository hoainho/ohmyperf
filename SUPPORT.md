# Getting Help with OhMyPerf

Thanks for using OhMyPerf. Here is the fastest path to an answer.

## 1. Quick checks (30 seconds)

- Are you on Node ≥ 22? Run `node --version`.
- Are you on the latest CLI? Run `npx -y @ohmyperf/cli@latest --version`.
- Did your problem start after upgrading? Check the [CHANGELOG](./CHANGELOG.md).

## 2. Read the docs

- [README](./README.md) — 30-second demo, install, MCP setup
- [Architecture overview](./README.md#architecture)
- [Accuracy notes](./docs/accuracy.md) — why your numbers may differ from Lighthouse
- [Beautiful report guide](./docs/beautiful-report.md) — what the JSON fields mean
- [Diagnostics guide](./docs/diagnostics.md) — long-tasks, render-blocking, INP attribution

## 3. Search before you ask

- Existing issues: [github.com/hoainho/ohmyperf/issues?q=is%3Aissue](https://github.com/hoainho/ohmyperf/issues?q=is%3Aissue)
- Discussions: [github.com/hoainho/ohmyperf/discussions](https://github.com/hoainho/ohmyperf/discussions)

## 4. Pick the right channel

| You want to | Open a |
|---|---|
| Report a bug or crash | [Bug report](https://github.com/hoainho/ohmyperf/issues/new?template=bug_report.yml) |
| Propose a new feature | [Feature request](https://github.com/hoainho/ohmyperf/issues/new?template=feature_request.yml) |
| Ask "how do I…" | [Discussion → Q&A](https://github.com/hoainho/ohmyperf/discussions/new?category=q-a) |
| Share what you measured | [Discussion → Show & tell](https://github.com/hoainho/ohmyperf/discussions/new?category=show-and-tell) |
| Report a security issue | [Private security advisory](https://github.com/hoainho/ohmyperf/security/advisories/new) (NOT a public issue) |

## 5. Response time expectations

- Bug reports with reproduction → typically answered within 24h
- Feature requests → triaged weekly
- Questions in Discussions → answered by maintainers + community, usually 24-72h

This is a single-maintainer project. If a question goes 72h without a response,
please ping in the issue — it's not ignored, just missed.

## 6. Commercial / consulting support

For one-on-one perf consulting, CI integration help, or custom plugin
development, contact **nhoxtvt@gmail.com**.
