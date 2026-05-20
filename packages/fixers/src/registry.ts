import type { ArchetypeRegistration } from "./types.js";
import { renderBlockingArchetype } from "./archetypes/render-blocking.js";
import { lcpImagePreloadArchetype } from "./archetypes/lcp-image.js";

export const ARCHETYPES: ReadonlyArray<ArchetypeRegistration> = [
  {
    id: "render-blocking-resources",
    opportunityId: "render-blocking-resources",
    fn: renderBlockingArchetype,
  },
  {
    id: "lcp-image-preload",
    opportunityId: "largest-contentful-paint-image",
    fn: lcpImagePreloadArchetype,
  },
  {
    id: "lcp-image-preload-alt",
    opportunityId: "preload-lcp-image",
    fn: lcpImagePreloadArchetype,
  },
];

export function archetypesForOpportunityId(opportunityId: string): ReadonlyArray<ArchetypeRegistration> {
  return ARCHETYPES.filter((a) => a.opportunityId === opportunityId);
}
