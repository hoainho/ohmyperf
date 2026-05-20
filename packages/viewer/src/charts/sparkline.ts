export interface SparklineOptions {
  readonly values: ReadonlyArray<number>;
  readonly width?: number;
  readonly height?: number;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly fillColor?: string;
  readonly ariaLabel?: string;
}

export function renderSparkline(opts: SparklineOptions): string {
  const values = opts.values.filter((v) => Number.isFinite(v));
  if (values.length < 2) return "";

  const w = opts.width ?? 80;
  const h = opts.height ?? 20;
  const stroke = opts.strokeColor ?? "currentColor";
  const strokeWidth = opts.strokeWidth ?? 1.5;
  const fill = opts.fillColor ?? "none";
  const ariaLabel = opts.ariaLabel ?? `Per-run trend (${String(values.length)} runs)`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = strokeWidth + 0.5;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i * innerW) / (values.length - 1);
    const y = pad + innerH - ((v - min) / span) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const polyline = `<polyline points="${points.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${String(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;

  const lastIdx = values.length - 1;
  const lastX = pad + (lastIdx * innerW) / lastIdx;
  const lastY = pad + innerH - ((values[lastIdx]! - min) / span) * innerH;
  const dot = `<circle cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="${String(strokeWidth + 0.5)}" fill="${stroke}" />`;

  return `<svg class="cwv-sparkline" viewBox="0 0 ${String(w)} ${String(h)}" width="${String(w)}" height="${String(h)}" role="img" aria-label="${ariaLabel}" preserveAspectRatio="none">${polyline}${dot}</svg>`;
}
