'use client';

import { UNSTABLE_COV_THRESHOLD } from '@/lib/format';

interface Props {
  runs: number;
}

export function VarianceBanner({ runs }: Props) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
      <span className="mt-0.5">⚠️</span>
      <p>
        <strong>High variance.</strong> At least one Core Web Vital has CoV &gt;{' '}
        {String(UNSTABLE_COV_THRESHOLD * 100)}% across {String(runs)} run(s). Consider increasing{' '}
        <code className="text-xs">--runs</code> or using{' '}
        <code className="text-xs">--mode ci-stable</code>.
      </p>
    </div>
  );
}
