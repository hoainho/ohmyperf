'use client';

import { useState } from 'react';

export type MetricFilter = 'all' | 'lcp' | 'inp' | 'cls' | 'tbt' | 'fcp';

const OPTIONS: ReadonlyArray<{ value: MetricFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'lcp', label: 'LCP' },
  { value: 'inp', label: 'INP' },
  { value: 'cls', label: 'CLS' },
  { value: 'tbt', label: 'TBT' },
  { value: 'fcp', label: 'FCP' },
];

interface Props {
  value: MetricFilter;
  onChange: (next: MetricFilter) => void;
}

export function MetricFilterPills({ value, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Filter insights by metric" className="flex flex-wrap gap-2">
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
              (active
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-card-foreground hover:bg-muted')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function useMetricFilter(): {
  filter: MetricFilter;
  setFilter: (next: MetricFilter) => void;
} {
  const [filter, setFilter] = useState<MetricFilter>('all');
  return { filter, setFilter };
}
