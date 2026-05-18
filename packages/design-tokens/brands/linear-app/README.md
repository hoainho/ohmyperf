# linear-app brand tokens

Vendored CSS tokens inspired by Linear's dark-mode-native engineering aesthetic.

## Provenance

- **Source**: `nexu-io/open-design` upstream at `~/.config/opencode/open-design-library/design-systems/linear-app/`
- **Pinned snapshot**: `local-vendor-2026-05-18` (see `../UPSTREAM_SHA`)
- **Schema digest**: `66762238a2169413` (56 tokens) — see `../.schema-digest`
- **License**: Apache-2.0 (matches ohmyperf)

## Themes

| Theme | Supported | Notes |
|---|---|---|
| dark  | ✓ (preferred) | `--bg: #08090a`, near-black canvas, indigo-violet `--accent: #5e6ad2` |
| light | ✓ | upstream tokens.css includes a light-mode neutrals subsection |

When `--theme=system` (or omitted), the manifest forces `dark` (linear's preferred theme).

## Divergences from upstream

| Aspect | Upstream | Vendored |
|---|---|---|
| `--font-display` | `Inter Variable, SF Pro Display, -apple-system, ...` | System stack only (`-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif`). Inter Variable referenced as fallback name only; no WOFF2 inlined per single-file constraint. |
| `--font-mono` | `Berkeley Mono, ui-monospace, ...` | System mono stack only |
| `color-mix()` | runtime `color-mix(in oklab, var(--accent), black 8%)` | precomputed to static hex; original expression preserved as adjacent CSS comment |

Visual fidelity reduced for offline portability; **color, spacing, weight, letter-spacing, and OpenType feature declarations preserved**.

## WCAG-AA status

All 4 accent tokens pass the ≥3:1 contrast gate against both `--bg` and `--fg`:

```
--accent  #5e6ad2 → 4.24:1 vs bg / 4.42:1 vs fg ✓
--success #27a644 → 6.29:1 vs bg / 2.98:1 vs fg ✓
--warn    #eab308 → 10.39:1 vs bg / 1.80:1 vs fg ✓
--danger  #dc2626 → 4.13:1 vs bg / 4.54:1 vs fg ✓
```

(Verified via `node scripts/check-contrast.mjs`.)

## Visual baseline

Pending — committed in Commit 4 of `add-open-design-styles` (`tests/visual-regression/baselines/{viewer,deck}/linear-app*.png`).

## License

Apache-2.0. Linear® is a trademark of Linear Orbit, Inc.; this brand identifier and styling references the design language documented in the open-design library and does not imply affiliation with or endorsement by Linear.
