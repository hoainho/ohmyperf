import type { Opportunity, Report } from "@ohmyperf/core";
import { ARCHETYPES, archetypesForOpportunityId } from "./registry.js";
import type { Patch, ProposePatchInput, ProposePatchResult } from "./types.js";

function collectOpportunities(report: Report): ReadonlyArray<Opportunity> {
  const out: Opportunity[] = [];
  if (report.opportunities) {
    for (const o of report.opportunities) out.push(o);
  }
  for (const run of report.runs) {
    if (run.opportunities) {
      for (const o of run.opportunities) {
        if (!out.some((existing) => existing.id === o.id)) out.push(o);
      }
    }
  }
  return out;
}

export function proposePatches(input: ProposePatchInput): ProposePatchResult {
  const { report } = input;
  const max = input.maxPatches ?? 10;
  const skipped: Array<{ opportunityId: string; reason: string }> = [];
  const all: Patch[] = [];

  const opportunities = collectOpportunities(report);
  const targetOpps = input.opportunityId
    ? opportunities.filter((o) => o.id === input.opportunityId)
    : opportunities;

  if (input.opportunityId && targetOpps.length === 0) {
    skipped.push({
      opportunityId: input.opportunityId,
      reason: "Opportunity not present in this report.",
    });
  }

  for (const opp of targetOpps) {
    const matching = archetypesForOpportunityId(opp.id);
    if (matching.length === 0) {
      skipped.push({
        opportunityId: opp.id,
        reason: `No fixer archetype registered for opportunity "${opp.id}". Available: ${ARCHETYPES.map((a) => a.opportunityId).join(", ")}.`,
      });
      continue;
    }
    for (const arch of matching) {
      const produced = arch.fn(opp, report);
      for (const p of produced) {
        if (input.url && p.url !== input.url) continue;
        all.push(p);
      }
    }
  }

  all.sort((a, b) => (b.expectedImpactMs ?? 0) - (a.expectedImpactMs ?? 0));
  const patches = all.slice(0, max);

  return { patches, skipped };
}
