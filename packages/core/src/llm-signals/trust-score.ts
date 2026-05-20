import type {
  AggregatedMetric,
  MetricTrustVerdict,
  Report,
  TrustLevel,
  TrustScore,
} from "../types.js";

const CWV_METRICS = ["lcp", "fcp", "ttfb", "inp", "cls", "tbt"] as const;

const HIGH_COV = 0.10;
const MEDIUM_COV = 0.25;
const MIN_RUNS_FOR_HIGH_CONFIDENCE = 5;

function classifyMetric(name: string, agg: AggregatedMetric): MetricTrustVerdict {
  const reasons: string[] = [];
  const n = agg.runs;
  const cov = Number.isFinite(agg.cov) ? agg.cov : Number.POSITIVE_INFINITY;

  if (n < 2) {
    return {
      level: "unreliable",
      reasons: [`only_${String(n)}_run`],
      recommendedAction: "Increase --runs to at least 5 for any statistical claim.",
    };
  }

  reasons.push(`n=${String(n)}`);
  reasons.push(`cov=${(cov * 100).toFixed(1)}%`);

  if (n < MIN_RUNS_FOR_HIGH_CONFIDENCE) {
    if (cov <= HIGH_COV) {
      return {
        level: "medium",
        reasons,
        recommendedAction: `Sample size (n=${String(n)}) below 5 — Mann-Whitney U cannot reach p<0.05. Rerun with --runs ${String(MIN_RUNS_FOR_HIGH_CONFIDENCE)} for verify_fix gates.`,
      };
    }
    return {
      level: "low",
      reasons,
      recommendedAction: `Sample size too small AND CoV high (${(cov * 100).toFixed(1)}%). Rerun with --runs ${String(MIN_RUNS_FOR_HIGH_CONFIDENCE)} minimum.`,
    };
  }

  if (cov <= HIGH_COV) return { level: "high", reasons };
  if (cov <= MEDIUM_COV) {
    return {
      level: "medium",
      reasons,
      recommendedAction: `CoV ${(cov * 100).toFixed(1)}% suggests run-to-run noise. Consider --mode ci-stable for CPU calibration + Fast 4G throttle.`,
    };
  }

  return {
    level: "unreliable",
    reasons,
    recommendedAction: `CoV ${(cov * 100).toFixed(1)}% exceeds 25% — measurement too noisy for reliable comparison. Use --runs 10+ AND --mode ci-stable.`,
  };
}

const TRUST_ORDER: ReadonlyArray<TrustLevel> = ["unreliable", "low", "medium", "high"];

function worstLevel(levels: ReadonlyArray<TrustLevel>): TrustLevel {
  if (levels.length === 0) return "unreliable";
  let worstIdx = TRUST_ORDER.length - 1;
  for (const l of levels) {
    const idx = TRUST_ORDER.indexOf(l);
    if (idx < worstIdx) worstIdx = idx;
  }
  return TRUST_ORDER[worstIdx]!;
}

export function computeTrustScore(report: Report): TrustScore {
  const perMetric: Record<string, MetricTrustVerdict> = {};
  const observedLevels: TrustLevel[] = [];

  for (const name of CWV_METRICS) {
    const agg = report.aggregated[name];
    if (!agg) continue;
    const verdict = classifyMetric(name, agg);
    perMetric[name] = verdict;
    observedLevels.push(verdict.level);
  }

  if (observedLevels.length === 0) {
    return {
      overall: "unreliable",
      reasons: ["no_cwv_metrics_in_report"],
      perMetric,
      recommendedAction: "No Core Web Vitals were measured. Check that the page loaded successfully.",
    };
  }

  const overall = worstLevel(observedLevels);
  const reasons: string[] = [];
  reasons.push(`n=${String(report.meta.runs)}`);
  reasons.push(`mode=${report.meta.mode}`);
  if (report.meta.calibration) {
    reasons.push(`calibrated_throttle=${String(report.meta.calibration.throttleRate)}x`);
  } else {
    reasons.push("no_calibration");
  }
  if (report.meta.unstable) reasons.push("unstable_flag_set");

  const unreliableCount = observedLevels.filter((l) => l === "unreliable").length;
  if (unreliableCount > 0) {
    reasons.push(`${String(unreliableCount)}_metric(s)_unreliable`);
  }

  let recommendedAction: string | undefined;
  if (overall === "unreliable") {
    recommendedAction =
      "At least one metric is too noisy or undersampled to trust. Rerun with `--runs 10 --mode ci-stable` before calling propose_patch or verify_fix.";
  } else if (overall === "low") {
    recommendedAction = "Sample size is below the recommended 5-run minimum. Rerun with `--runs 5` for statistical-significance gates.";
  } else if (overall === "medium" && !report.meta.calibration) {
    recommendedAction = "Consider `--mode ci-stable` for reproducible budgets across hosts.";
  }

  const result: TrustScore = {
    overall,
    reasons,
    perMetric,
    ...(recommendedAction !== undefined ? { recommendedAction } : {}),
  };
  return result;
}
