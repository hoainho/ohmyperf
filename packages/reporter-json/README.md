# `@nhonh/reporter-json`

Canonical JSON reporter for ohmyperf. Schema 1.0.0 source of truth.

- Emits a `report.json` with `schemaVersion: '1.0.0'`. All other reporters consume this shape.
- Stable, frozen public schema — additive changes only.
- Used by every CLI/MCP run by default (`--format=json` is the implicit baseline).

Part of the [ohmyperf](https://github.com/hoainho/ohmyperf) monorepo. Most users install the [`@nhonh/cli`](https://www.npmjs.com/package/@nhonh/cli) or [`@nhonh/mcp-server`](https://www.npmjs.com/package/@nhonh/mcp-server) binary rather than this package directly.

## Install

```bash
npm install @nhonh/reporter-json
```

Requires Node ≥ 22.

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
