'use client';

import type { AggregatedMetric } from '@ohmyperf/core';
import { formatMs, formatScore, formatCov, rateMetric, RATING_COLORS, type MetricUnit } from '@/lib/format';

interface Props {
  name: string;
  agg: AggregatedMetric;
  unit: MetricUnit;
  digits?: number;
}

export function MetricRow({ name, agg, unit, digits = 1 }: Props) {
  const rating = rateMetric(name, agg.median);
  const color = RATING_COLORS[rating];
  const medianStr = unit === 'ms' ? formatMs(agg.median, digits) : formatScore(agg.median, digits);
  const p75Str = unit === 'ms' ? formatMs(agg.p75, digits) : formatScore(agg.p75, digits);

  return (
    <tr className="border-t text-sm">
      <td className="px-3 py-2 font-mono font-medium" style={{ color }}>{name.toUpperCase()}</td>
      <td className="px-3 py-2 text-right font-mono">{medianStr}</td>
      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{p75Str}</td>
      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{formatCov(agg.cov)}</td>
      <td className="px-3 py-2 text-right text-muted-foreground">{String(agg.runs)}</td>
    </tr>
  );
}
