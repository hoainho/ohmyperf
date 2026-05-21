import type { Opportunity, Report } from "@ohmyperf/core";
import type { ArchetypeFn, Patch } from "../types.js";

function basename(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.split("/");
    const tail = p[p.length - 1];
    if (tail && tail.length > 0) return tail;
    return u.host;
  } catch {
    return url;
  }
}

function isImage(url: string): boolean {
  const lower = url.toLowerCase().split("?")[0] ?? "";
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".avif") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".svg")
  );
}

export const lcpImagePreloadArchetype: ArchetypeFn = (opp: Opportunity, _report: Report) => {
  if (opp.id !== "largest-contentful-paint-image" && opp.id !== "preload-lcp-image") return [];
  const patches: Patch[] = [];
  for (const item of opp.items) {
    if (!isImage(item.url)) continue;
    const base = basename(item.url);
    patches.push({
      archetype: "lcp-image-fetchpriority-high",
      url: item.url,
      search: `<img src="${base}"`,
      replace: `<img src="${base}" fetchpriority="high" loading="eager"`,
      rationale:
        "The LCP candidate <img> is being deprioritized by the browser preload scanner. fetchpriority=high tells the browser to prioritize this image above other resources; loading=eager prevents lazy-load deferral.",
      ...(item.wastedMs !== undefined ? { expectedImpactMs: item.wastedMs } : {}),
      expectedMetric: "lcp" as const,
      confidence: "high" as const,
    });
    patches.push({
      archetype: "lcp-image-link-preload",
      url: item.url,
      search: "</head>",
      replace: `  <link rel="preload" as="image" href="${item.url}" fetchpriority="high">\n</head>`,
      rationale:
        "Adding <link rel='preload' as='image'> in <head> instructs the browser to start fetching the LCP image as early as possible, even before HTML parsing reaches the <img> tag.",
      ...(item.wastedMs !== undefined ? { expectedImpactMs: item.wastedMs } : {}),
      expectedMetric: "lcp" as const,
      confidence: "medium" as const,
    });
  }
  return patches;
};
