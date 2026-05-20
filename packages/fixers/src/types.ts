import type { Opportunity, Report } from "@ohmyperf/core";

export type Metric = "lcp" | "fcp" | "tbt" | "inp" | "cls";

export interface Patch {
  readonly archetype: string;
  readonly url: string;
  readonly search: string;
  readonly replace: string;
  readonly rationale: string;
  readonly expectedImpactMs?: number;
  readonly expectedMetric?: Metric;
  readonly confidence: "high" | "medium" | "low";
}

export type ArchetypeFn = (opp: Opportunity, report: Report) => ReadonlyArray<Patch>;

export interface ArchetypeRegistration {
  readonly id: string;
  readonly opportunityId: string;
  readonly fn: ArchetypeFn;
}

export interface ProposePatchInput {
  readonly report: Report;
  readonly opportunityId?: string;
  readonly url?: string;
  readonly maxPatches?: number;
}

export interface ProposePatchResult {
  readonly patches: ReadonlyArray<Patch>;
  readonly skipped: ReadonlyArray<{ readonly opportunityId: string; readonly reason: string }>;
}
