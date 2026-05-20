import type { Report, ServabilityInfo } from "../types.js";

const MIN_RESOURCES_FOR_REAL_PAGE = 3;
const MIN_BYTES_FOR_REAL_PAGE = 10_000;
const SUSPICIOUS_TITLE_PATTERNS = [
  /just a moment/i,
  /attention required/i,
  /cloudflare/i,
  /access denied/i,
  /captcha/i,
  /please enable javascript/i,
];

export function classifyServability(report: Report): ServabilityInfo {
  const signals: string[] = [];
  const firstRun = report.runs[0];
  if (!firstRun) {
    return {
      classification: "unknown",
      signals: ["no_runs_completed"],
      recommendedAction: "Retry the measurement; first run did not complete.",
    };
  }

  const resources = firstRun.resources;
  const totalBytes = resources.reduce(
    (sum, r) => sum + (r.encodedSizeBytes || 0),
    0,
  );
  const hasScripts = resources.some((r) =>
    r.mimeType?.toLowerCase().includes("javascript"),
  );

  if (resources.length === 0) {
    return {
      classification: "error-page",
      signals: ["zero_resources"],
      recommendedAction: "The page returned no resources. Check URL or network connectivity.",
    };
  }

  if (
    resources.length <= MIN_RESOURCES_FOR_REAL_PAGE &&
    totalBytes < MIN_BYTES_FOR_REAL_PAGE
  ) {
    signals.push(`resource_count=${String(resources.length)}`);
    signals.push(`total_bytes=${String(totalBytes)}`);
    if (!hasScripts) signals.push("no_javascript_resources");
  }

  for (const r of resources) {
    const lower = r.url.toLowerCase();
    if (lower.includes("challenge-platform") || lower.includes("turnstile") || lower.includes("cf-chl")) {
      signals.push(`cloudflare_challenge_url:${r.url.slice(0, 60)}`);
    }
    if (lower.includes("/cdn-cgi/")) {
      signals.push("cloudflare_cdn_path");
    }
  }

  if (report.meta.durationMs > 0 && resources.length <= MIN_RESOURCES_FOR_REAL_PAGE) {
    const hasTimeout = report.meta.durationMs >= 25_000 && report.meta.durationMs <= 35_000;
    if (hasTimeout) {
      signals.push(`possible_navigation_timeout_durationMs=${String(report.meta.durationMs)}`);
    }
  }

  for (const audit of report.audits) {
    if (audit.id === "page-title" || audit.id === "document-title") {
      const detail = audit.details as { value?: string } | undefined;
      const title = detail?.value;
      if (title && SUSPICIOUS_TITLE_PATTERNS.some((p) => p.test(title))) {
        signals.push(`suspicious_title:${title.slice(0, 40)}`);
      }
    }
  }

  const challengeMatch = signals.some(
    (s) => s.startsWith("cloudflare_challenge_url") || s.startsWith("suspicious_title"),
  );
  if (challengeMatch) {
    return {
      classification: "bot-challenge-suspected",
      signals,
      recommendedAction:
        "This URL appears to have returned a bot-challenge page rather than the real site. Performance metrics measured against the challenge page are not representative of real users. Try (a) adding a realistic User-Agent via --emulation.userAgent, (b) measuring from infrastructure that already has Cloudflare allowlist, or (c) using a different staging URL that bypasses bot detection.",
    };
  }

  if (
    resources.length <= MIN_RESOURCES_FOR_REAL_PAGE &&
    totalBytes < MIN_BYTES_FOR_REAL_PAGE &&
    !hasScripts
  ) {
    return {
      classification: "bot-challenge-suspected",
      signals,
      recommendedAction:
        "Measured page is unusually small (≤3 resources, <10KB, no JS). Likely a bot challenge, error page, or empty response. Inspect runs[0].resources before drawing conclusions.",
    };
  }

  const layoutCount = firstRun.runtime?.["layoutCount"];
  if (typeof layoutCount === "number" && layoutCount < 3 && resources.length <= 4) {
    signals.push(`low_layout_count=${String(layoutCount)}`);
    signals.push(`low_resource_count=${String(resources.length)}`);
    return {
      classification: "bot-challenge-suspected",
      signals,
      recommendedAction:
        "Page has very few layout operations (<3) and only a handful of resources. This is unusual for a real interactive page and often indicates an authentication wall, paywall, or static landing replacement. Verify the URL renders the expected content in a browser before comparing metrics.",
    };
  }

  const mimeTypes = new Set(resources.map((r) => r.mimeType?.split(";")[0]?.trim().toLowerCase() ?? ""));
  if (
    resources.length <= 5 &&
    !hasScripts &&
    mimeTypes.size === 1 &&
    (mimeTypes.has("text/html") || mimeTypes.has("text/plain"))
  ) {
    signals.push("only_html_no_js_no_css");
    return {
      classification: "bot-challenge-suspected",
      signals,
      recommendedAction:
        "Page returned only HTML/plain-text resources with no JavaScript or stylesheets. Likely a non-interactive challenge or maintenance page.",
    };
  }

  if (signals.length === 0) {
    return {
      classification: "real-page",
      signals: [
        `resource_count=${String(resources.length)}`,
        `total_bytes=${String(totalBytes)}`,
      ],
    };
  }

  return { classification: "real-page", signals };
}
