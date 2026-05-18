import { CALIBRE_LIGHT } from "@ohmyperf/design-tokens";
import { escapeHtml, safeNumeric } from "../escape.js";

export interface DonutSlice {
  readonly label: string;
  readonly value: number;
  readonly color?: string;
}

export interface DonutOptions {
  readonly size?: number;
  readonly thickness?: number;
  readonly ariaLabel?: string;
}

const DEFAULT_COLORS: ReadonlyArray<string> = [
  CALIBRE_LIGHT.accentPrimary,
  CALIBRE_LIGHT.accentSuccess,
  CALIBRE_LIGHT.accentWarning,
  CALIBRE_LIGHT.accentDanger,
  CALIBRE_LIGHT.mutedForeground,
  CALIBRE_LIGHT.foreground,
];

export function renderDonut(
  slices: ReadonlyArray<DonutSlice>,
  opts: DonutOptions = {},
): string {
  const size = safeNumeric(opts.size, 200);
  const thickness = safeNumeric(opts.thickness, 28);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const total = slices.reduce((s, x) => s + Math.max(0, safeNumeric(x.value)), 0);
  const ariaLabel = escapeHtml(opts.ariaLabel ?? "Distribution chart");

  if (total <= 0 || slices.length === 0) {
    return `<svg viewBox="0 0 ${String(size)} ${String(size)}" width="${String(size)}" height="${String(size)}" role="img" aria-label="${ariaLabel}"><title>${ariaLabel}</title><circle cx="${String(cx)}" cy="${String(cy)}" r="${String(r)}" fill="none" stroke="${CALIBRE_LIGHT.muted}" stroke-width="${String(thickness)}" /></svg>`;
  }

  let angle = -Math.PI / 2;
  const segments: string[] = [];
  slices.forEach((slice, i) => {
    const value = Math.max(0, safeNumeric(slice.value));
    if (value === 0) return;
    const fraction = value / total;
    const sweep = fraction * Math.PI * 2;
    const next = angle + sweep;
    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(next) * r;
    const y2 = cy + Math.sin(next) * r;
    const largeArc = sweep > Math.PI ? 1 : 0;
    const color = slice.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]!;
    segments.push(
      `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${String(largeArc)} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${String(thickness)}" stroke-linecap="butt" />`,
    );
    angle = next;
  });
  return `<svg viewBox="0 0 ${String(size)} ${String(size)}" width="${String(size)}" height="${String(size)}" role="img" aria-label="${ariaLabel}"><title>${ariaLabel}</title>${segments.join("")}</svg>`;
}

export function donutColorAt(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length]!;
}
