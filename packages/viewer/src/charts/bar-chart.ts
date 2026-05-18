import { escapeHtml, safeNumeric } from "../escape.js";

export interface BarItem {
  readonly label: string;
  readonly value: number;
  readonly suffix?: string;
}

export interface HorizontalBarOptions {
  readonly width?: number;
  readonly barHeight?: number;
  readonly gap?: number;
  readonly ariaLabel?: string;
}

export function renderHorizontalBars(
  items: ReadonlyArray<BarItem>,
  opts: HorizontalBarOptions = {},
): string {
  const width = safeNumeric(opts.width, 600);
  const barHeight = safeNumeric(opts.barHeight, 22);
  const gap = safeNumeric(opts.gap, 6);
  const ariaLabel = escapeHtml(opts.ariaLabel ?? "Horizontal bar chart");
  if (items.length === 0) return "";

  const max = Math.max(1, ...items.map((i) => safeNumeric(i.value)));
  const labelWidth = 180;
  const valueWidth = 80;
  const trackWidth = Math.max(80, width - labelWidth - valueWidth - 20);
  const height = items.length * (barHeight + gap) - gap;

  const rows = items
    .map((item, idx) => {
      const v = safeNumeric(item.value);
      const w = (Math.max(0, v) / max) * trackWidth;
      const y = idx * (barHeight + gap);
      const suffix = item.suffix ? ` ${item.suffix}` : "";
      const label = escapeHtml(truncate(item.label, 32));
      const valueText = escapeHtml(`${v.toFixed(v < 10 ? 1 : 0)}${suffix}`);
      return `<g>
  <text x="0" y="${(y + barHeight * 0.65).toFixed(1)}" font-size="12" data-bar="label">${label}</text>
  <rect x="${String(labelWidth)}" y="${String(y)}" width="${String(trackWidth)}" height="${String(barHeight)}" rx="3" data-bar="track" />
  <rect x="${String(labelWidth)}" y="${String(y)}" width="${w.toFixed(2)}" height="${String(barHeight)}" rx="3" data-bar="filled" />
  <text x="${String(labelWidth + trackWidth + 10)}" y="${(y + barHeight * 0.65).toFixed(1)}" font-size="12" data-bar="value-text" font-variant-numeric="tabular-nums">${valueText}</text>
</g>`;
    })
    .join("");

  return `<svg class="ohmyperf-bars" viewBox="0 0 ${String(width)} ${String(height)}" width="${String(width)}" height="${String(height)}" role="img" aria-label="${ariaLabel}"><title>${ariaLabel}</title>${rows}</svg>`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
