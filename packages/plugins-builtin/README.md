# `@nhonh/plugins-builtin`

Built-in plugin set for ohmyperf: Core Web Vitals, axe-core accessibility, third-party-web vendor classification.

- Exports `cwvPlugin`, `axePlugin`, `thirdPartiesPlugin`, `customMetricExamplePlugin`.
- Third-party classification via [`third-party-web` v0.29.2](https://github.com/patrickhulce/third-party-web) — categorizes resources by vendor (`gtm`, `analytics`, `ads`, `social`, etc.) with main-thread time + transfer size per vendor.
- Auto-loaded by `@nhonh/cli`. Custom plugins follow the `Plugin` interface from `@nhonh/core`.

Part of the [ohmyperf](https://github.com/hoainho/ohmyperf) monorepo. Most users install the [`@nhonh/cli`](https://www.npmjs.com/package/@nhonh/cli) or [`@nhonh/mcp-server`](https://www.npmjs.com/package/@nhonh/mcp-server) binary rather than this package directly.

## Install

```bash
npm install @nhonh/plugins-builtin
```

Requires Node ≥ 22.

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
