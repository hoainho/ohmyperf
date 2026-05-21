import type { Opportunity, Report } from "@ohmyperf/core";
import type { ArchetypeFn, Patch } from "../types.js";

type ResourceKind = "script" | "stylesheet" | "document" | "unknown";

function classifyByMime(mimeType: string | undefined): ResourceKind {
  if (!mimeType) return "unknown";
  const lower = mimeType.toLowerCase();
  if (lower.includes("javascript") || lower === "application/ecmascript" || lower === "text/javascript") return "script";
  if (lower.includes("css")) return "stylesheet";
  if (lower.includes("html")) return "document";
  return "unknown";
}

function classifyByUrl(url: string): ResourceKind {
  const lower = url.toLowerCase();
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.includes(".js?")) return "script";
  if (lower.endsWith(".css") || lower.includes(".css?")) return "stylesheet";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "document";
  return "unknown";
}

function findResourceMime(report: Report, url: string): string | undefined {
  for (const run of report.runs) {
    for (const res of run.resources) {
      if (res.url === url) return res.mimeType;
    }
  }
  return undefined;
}

function classify(url: string, report: Report): ResourceKind {
  const byUrl = classifyByUrl(url);
  if (byUrl !== "unknown") return byUrl;
  const mime = findResourceMime(report, url);
  return classifyByMime(mime);
}

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

function patchForScript(url: string, wastedMs: number | undefined): Patch {
  const base = basename(url);
  return {
    archetype: "render-blocking-script-add-defer",
    url,
    search: `<script src="${base}"`,
    replace: `<script src="${base}" defer`,
    rationale:
      "Render-blocking <script> tags block HTML parsing. Adding defer lets the browser continue parsing while the script downloads; the script executes after parsing finishes, in document order.",
    ...(wastedMs !== undefined ? { expectedImpactMs: wastedMs } : {}),
    expectedMetric: "fcp" as const,
    confidence: "high" as const,
  };
}

function patchForStylesheet(url: string, wastedMs: number | undefined): Patch {
  const base = basename(url);
  return {
    archetype: "render-blocking-stylesheet-media-print",
    url,
    search: `<link rel="stylesheet" href="${base}"`,
    replace: `<link rel="stylesheet" href="${base}" media="print" onload="this.media='all'"`,
    rationale:
      "Render-blocking <link rel='stylesheet'> blocks first paint. The media='print' + onload swap trick downloads the stylesheet non-blocking, then applies it once loaded. Add a <noscript> fallback for JS-disabled clients.",
    ...(wastedMs !== undefined ? { expectedImpactMs: wastedMs } : {}),
    expectedMetric: "fcp" as const,
    confidence: "medium" as const,
  };
}

export const renderBlockingArchetype: ArchetypeFn = (opp: Opportunity, report: Report) => {
  if (opp.id !== "render-blocking-resources") return [];
  const patches: Patch[] = [];
  for (const item of opp.items) {
    const kind = classify(item.url, report);
    if (kind === "script") {
      patches.push(patchForScript(item.url, item.wastedMs));
    } else if (kind === "stylesheet") {
      patches.push(patchForStylesheet(item.url, item.wastedMs));
    }
  }
  return patches;
};
