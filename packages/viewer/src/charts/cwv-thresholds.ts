export type CwvStatus = "good" | "needs-improvement" | "poor" | "unknown";

export interface CwvThreshold {
  readonly good: number;
  readonly poor: number;
  readonly unit: "ms" | "score";
  readonly digits: number;
}

export const CWV_THRESHOLDS: Readonly<Record<string, CwvThreshold>> = {
  lcp: { good: 2500, poor: 4000, unit: "ms", digits: 0 },
  fcp: { good: 1800, poor: 3000, unit: "ms", digits: 0 },
  ttfb: { good: 800, poor: 1800, unit: "ms", digits: 0 },
  inp: { good: 200, poor: 500, unit: "ms", digits: 0 },
  cls: { good: 0.1, poor: 0.25, unit: "score", digits: 3 },
  tbt: { good: 200, poor: 600, unit: "ms", digits: 0 },
};

export function classifyCwv(metric: string, value: number): CwvStatus {
  const t = CWV_THRESHOLDS[metric.toLowerCase()];
  if (!t || !Number.isFinite(value)) return "unknown";
  if (value <= t.good) return "good";
  if (value <= t.poor) return "needs-improvement";
  return "poor";
}

export function cwvStatusIcon(status: CwvStatus): string {
  switch (status) {
    case "good":
      return "✓";
    case "needs-improvement":
      return "!";
    case "poor":
      return "✗";
    default:
      return "—";
  }
}

export function cwvStatusLabel(status: CwvStatus): string {
  switch (status) {
    case "good":
      return "Good";
    case "needs-improvement":
      return "Needs improvement";
    case "poor":
      return "Poor";
    default:
      return "Unknown";
  }
}

export function formatCwvValue(metric: string, value: number): string {
  const t = CWV_THRESHOLDS[metric.toLowerCase()];
  if (!t || !Number.isFinite(value)) return "—";
  if (t.unit === "ms") return `${value.toFixed(t.digits)} ms`;
  return value.toFixed(t.digits);
}

export function formatCwvThreshold(metric: string): string {
  const t = CWV_THRESHOLDS[metric.toLowerCase()];
  if (!t) return "";
  const goodStr = t.unit === "ms" ? `${String(t.good)}ms` : t.good.toFixed(t.digits);
  const poorStr = t.unit === "ms" ? `${String(t.poor)}ms` : t.poor.toFixed(t.digits);
  return `good ≤ ${goodStr} · poor > ${poorStr}`;
}
