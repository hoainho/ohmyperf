import type { Report } from "@ohmyperf/core";
import { renderCwvCard } from "../charts/cwv-traffic-light.js";

const CWV_ORDER: ReadonlyArray<string> = ["lcp", "inp", "cls", "fcp", "ttfb", "tbt"];
const UNSTABLE_COV_THRESHOLD = 0.2;

function extractPerRunValues(report: Report, metric: string): number[] {
  const values: number[] = [];
  for (const run of report.runs) {
    const m = run.metrics[metric];
    if (m && typeof m.value === "number" && Number.isFinite(m.value)) {
      values.push(m.value);
    }
  }
  return values;
}

export function renderCwvGrid(report: Report): string {
  const cards: string[] = [];
  for (const metric of CWV_ORDER) {
    const agg = report.aggregated[metric];
    if (!agg) continue;
    const unstable = agg.cov > UNSTABLE_COV_THRESHOLD;
    const perRun = extractPerRunValues(report, metric);
    cards.push(renderCwvCard(agg, { metric, unstable, perRunValues: perRun }));
  }
  if (cards.length === 0) return "";
  return `<section class="cwv-grid" aria-label="Core Web Vitals">${cards.join("")}</section>`;
}
