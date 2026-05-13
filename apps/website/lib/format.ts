export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${String(Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatMs(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)} ms`;
}

export function formatScore(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function formatCov(cov: number): string {
  if (!Number.isFinite(cov)) return '—';
  return `${(cov * 100).toFixed(1)}%`;
}

export function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

export type MetricUnit = 'ms' | 'score';

export const HEADLINE_METRICS: ReadonlyArray<{ name: string; unit: MetricUnit; digits: number }> = [
  { name: 'lcp', unit: 'ms', digits: 1 },
  { name: 'fcp', unit: 'ms', digits: 1 },
  { name: 'ttfb', unit: 'ms', digits: 1 },
  { name: 'inp', unit: 'ms', digits: 1 },
  { name: 'cls', unit: 'score', digits: 3 },
  { name: 'tbt', unit: 'ms', digits: 1 },
];

export const UNSTABLE_COV_THRESHOLD = 0.2;

export type MetricRating = 'good' | 'ni' | 'poor';

const THRESHOLDS: Record<string, [number, number]> = {
  lcp:  [2500, 4000],
  fcp:  [1800, 3000],
  ttfb: [800,  1800],
  inp:  [200,  500],
  cls:  [0.1,  0.25],
  tbt:  [200,  600],
};

export function rateMetric(name: string, value: number): MetricRating {
  const t = THRESHOLDS[name];
  if (!t) return 'good';
  if (value <= t[0]) return 'good';
  if (value <= t[1]) return 'ni';
  return 'poor';
}

export const RATING_COLORS: Record<MetricRating, string> = {
  good: '#0cce6b',
  ni:   '#ffa400',
  poor: '#ff4e42',
};
