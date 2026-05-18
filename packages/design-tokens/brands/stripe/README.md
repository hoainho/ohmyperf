# stripe brand tokens

Vendored CSS tokens inspired by Stripe's fintech infrastructure design: white canvas, signature violet, blue-tinted multi-layer shadows.

## Provenance

- **Source**: `nexu-io/open-design` upstream at `~/.config/opencode/open-design-library/design-systems/stripe/`
- **Pinned snapshot**: `local-vendor-2026-05-18`
- **Schema digest**: `66762238a2169413` (56 tokens)
- **License**: Apache-2.0

## Themes

| Theme | Supported | Notes |
|---|---|---|
| light | ✓ (preferred) | `--bg: #ffffff`, deep navy `--fg: #061b31`, Stripe Purple `--accent: #533afd` |
| dark  | ✗ | Stripe's brand identity is light-first; upstream tokens.css ships no dark variant |

When `--theme=dark` is explicitly passed, the viewer warns and falls back to `light`.

## Divergences from upstream

| Aspect | Upstream | Vendored |
|---|---|---|
| `--font-display` | Stripe's chosen stack | System stack only |
| `--font-mono` | upstream JetBrains Mono fallback | System mono stack |
| `color-mix()` | 1 occurrence | precomputed to static hex |

## WCAG-AA status

All 4 accent tokens pass:

```
--accent  #533afd → 6.19:1 vs bg / 2.81:1 vs fg ✓
--success #15be53 → 2.46:1 vs bg / 7.05:1 vs fg ✓ (best ratio vs dark fg)
--warn    #9b6829 → 4.77:1 vs bg / 3.64:1 vs fg ✓
--danger  #ea2261 → 4.29:1 vs bg / 4.05:1 vs fg ✓
```

## Visual baseline

Pending — committed in Commit 4.

## License

Apache-2.0. Stripe® is a trademark of Stripe, Inc.; this brand identifier styles ohmyperf reports per the open-design library reference and does not imply affiliation with or endorsement by Stripe.
