# vercel brand tokens

Vendored CSS tokens inspired by Vercel's engineering-as-design thesis: near-white canvas, near-black text, one saturated blue accent, shadow-as-border philosophy.

## Provenance

- **Source**: `nexu-io/open-design` upstream at `~/.config/opencode/open-design-library/design-systems/vercel/`
- **Pinned snapshot**: `local-vendor-2026-05-18`
- **Schema digest**: `66762238a2169413` (56 tokens)
- **License**: Apache-2.0

## Themes

| Theme | Supported | Notes |
|---|---|---|
| light | ✓ (preferred) | `--bg: #ffffff`, Vercel Black `--fg: #171717`, Console Blue `--accent: #0070f3` |
| dark  | ✓ | upstream tokens.css ships a dark mode counterpart in the gray ramp |

## Divergences from upstream

| Aspect | Upstream | Vendored |
|---|---|---|
| `--font-display` | Geist (Vercel's house typeface) | System stack only — Geist not bundled |
| `--font-mono` | Geist Mono | System mono stack |
| `color-mix()` | 2 occurrences | precomputed to static hex |

## WCAG-AA status

All 4 accent tokens pass:

```
--accent  #0070f3 → 4.55:1 vs bg / 3.94:1 vs fg ✓
--success #16a34a → 3.30:1 vs bg / 5.44:1 vs fg ✓
--warn    #eab308 → 1.92:1 vs bg / 9.35:1 vs fg ✓ (best vs dark fg)
--danger  #dc2626 → 4.83:1 vs bg / 3.71:1 vs fg ✓
```

## Visual baseline

Pending — committed in Commit 4.

## License

Apache-2.0. Vercel® and Geist® are trademarks of Vercel, Inc.; this brand identifier styles ohmyperf reports per the open-design library reference and does not imply affiliation with or endorsement by Vercel.
