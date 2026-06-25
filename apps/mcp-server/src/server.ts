import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  diffReports,
  formatDiff,
  runEngine,
  selectLargestResources,
  type FullLoadConfig,
  type Opportunity,
  type PerfSummary,
  type Report,
} from "@ohmyperf/core";
import { createPlaywrightAdapter } from "@ohmyperf/driver-playwright";
import { proposePatches } from "@ohmyperf/fixers";
import {
  axePlugin,
  cwvPlugin,
  customMetricExamplePlugin,
  thirdPartiesPlugin,
} from "@ohmyperf/plugins-builtin";
import { BRAND_IDS, BRAND_MANIFEST, isBrandId, type BrandId } from "@ohmyperf/design-tokens";
import { writeDeckReport } from "@ohmyperf/reporter-deck";
import { writeHtmlReport } from "@ohmyperf/reporter-html";
import { writeJsonReport } from "@ohmyperf/reporter-json";
import { renderMarkdown } from "@ohmyperf/reporter-markdown";
import {
  analyzeRegressionCause,
  type RegressionCauseReport,
} from "./regression-cause.js";
import {
  appendTimeSeriesPoint,
  detectAllTrends,
  readTimeSeries,
  type TimeSeriesPoint,
  type TrendVerdict,
} from "./timeseries.js";

export interface McpServerOptions {
  readonly reportsDir?: string;
  readonly maxReports?: number;
}

const DEFAULT_REPORTS_DIR = join(homedir(), ".ohmyperf-mcp", "reports");
const DEFAULT_MAX_REPORTS = 50;

type PluginId = "cwv" | "axe" | "third-parties" | "custom-metric-example";

const PLUGIN_IDS: readonly PluginId[] = [
  "cwv",
  "axe",
  "third-parties",
  "custom-metric-example",
] as const;

export interface MeasureInput {
  url: string;
  runs?: number;
  mode?: "real" | "ci-stable";
  plugins?: ReadonlyArray<PluginId>;
  browserPath?: string;
  collectTrace?: boolean;
  /** Capture DOM topology + compute component hotspots (Full-Load gating attribution). */
  diagnose?: boolean;
  /** Compute prescriptive remediations (implies diagnose). */
  rx?: boolean;
  /** Full-Load Time settle overrides, merged over the engine defaults. */
  fullLoad?: Partial<FullLoadConfig>;
}

interface DiffInput {
  baseline: string;
  candidate: string;
  failOnRegression?: boolean;
}

export type InsightName =
  | "lcp-breakdown"
  | "render-blocking"
  | "long-tasks"
  | "third-parties"
  | "opportunities"
  | "audits"
  | "resources"
  | "frames"
  | "full-load-breakdown"
  | "hotspots"
  | "remediation"
  | "network"
  | "javascript"
  | "errors"
  | "perf-summary";

const INSIGHT_NAMES: readonly InsightName[] = [
  "lcp-breakdown",
  "render-blocking",
  "long-tasks",
  "third-parties",
  "opportunities",
  "audits",
  "resources",
  "frames",
  "full-load-breakdown",
  "hotspots",
  "remediation",
  "network",
  "javascript",
  "errors",
  "perf-summary",
] as const;

export function createOhmyperfMcpServer(opts: McpServerOptions = {}): Server {
  const reportsDir = resolve(opts.reportsDir ?? DEFAULT_REPORTS_DIR);
  const maxReports = opts.maxReports ?? DEFAULT_MAX_REPORTS;

  const server = new Server(
    { name: "ohmyperf", version: "0.3.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "measure",
        description:
          "Entry point for every performance investigation. Measure a URL on a real Chromium browser and persist the Report JSON to the MCP server's reports dir (~/.ohmyperf-mcp/reports by default); the report is also exposed as an MCP resource. Returns CWV medians (LCP, FCP, TTFB, CLS, TBT), audits, frame tree, and per-resource timing. **Call this first** — every downstream tool (`diff`, `diff_resources`, `analyze_report`, `propose_patch`, `verify_fix`, `get_fix_plan`, `get_trust_score`, `get_servability`, `enforce_budget`, `track_url`) consumes the saved report by filesystem path or `ohmyperf://reports/<file>.json` URI. Use `mode='ci-stable'` (pre-flight CPU calibration + Fast 4G throttling) for any AB comparison or budget enforcement; use `mode='real'` only for quick dev iteration. `collectTrace=true` adds ~5-20MB/run and enables long-task attribution + render-blocking diagnostics in `analyze_report`. Throws on non-http(s) URL or `runs` outside [1, 30].",
        inputSchema: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              description: "HTTP(S) URL to measure",
            },
            runs: {
              type: "integer",
              minimum: 1,
              maximum: 30,
              default: 3,
              description: "Number of measurement runs (default 3)",
            },
            mode: {
              type: "string",
              enum: ["real", "ci-stable"],
              default: "real",
              description:
                "real = no throttling (dev loop); ci-stable = pre-flight CPU calibration + Fast 4G network",
            },
            plugins: {
              type: "array",
              items: { type: "string", enum: PLUGIN_IDS as unknown as string[] },
              default: ["cwv", "axe"],
              description:
                "Built-in plugins to enable. 'third-parties' classifies resources by vendor (gtm, analytics, ads, etc.).",
            },
            browserPath: {
              type: "string",
              description:
                "Override the Chromium binary path (e.g. for full Chromium vs headless-shell)",
            },
            collectTrace: {
              type: "boolean",
              default: false,
              description:
                "Capture Chrome DevTools trace for diagnostic insights (render-blocking, long-tasks, INP breakdown). Adds ~5-20MB per run.",
            },
            diagnose: {
              type: "boolean",
              default: false,
              description:
                "Capture a per-run DOM-topology snapshot and compute component `hotspots` (settle-based Full-Load gating attribution). Surface via `analyze_report` insightName='hotspots'. Adds one in-page DOM snapshot per run (small). `fullLoad` (FLT) is computed for every report regardless of this flag.",
            },
            rx: {
              type: "boolean",
              default: false,
              description:
                "Compute prescriptive `recommendations` (implies diagnose). Each rec has a target, estimated FLT impact, confidence, and whether it sits on the gating path. Surface via `analyze_report` insightName='remediation'. No extra browser work beyond diagnose.",
            },
            fullLoad: {
              type: "object",
              additionalProperties: true,
              description:
                "Full-Load Time settle overrides, merged over engine defaults. Keys: until ('load-event'|'network-idle-2'|'fully-loaded'|'visually-complete'), settleWindowMs, maxWaitMs, netIdleThreshold, mutationNoiseFloor, longLivedGraceMs, visual (set true for a filmstrip / visually-complete signal), visualIntervalMs, visualDiffEpsilon, strictNetwork.",
            },
          },
        },
      },
      {
        name: "diff",
        description:
          "Compare two saved reports (filesystem paths) using a Mann-Whitney U significance test. Returns per-CWV-metric verdict (regression | improvement | neutral) with p-values and median deltas, plus a `hasRegressions` boolean. **Use this for AB comparisons of two saved reports** — for example, main vs a feature branch, or last week vs this week. If both reports are already on hand as MCP resources (from a prior `list_runs` or `ListResources` call), prefer `diff_resources` to skip path resolution. Pair with `find_regression_cause` to attribute regressions to specific resources/scripts, or with `verify_fix` to gate a candidate deploy against a baseline. Throws if either path is unreadable or not a valid report.json. `failOnRegression=true` (default) is purely advisory in this tool — it surfaces the verdict prominently but does NOT throw.",
        inputSchema: {
          type: "object",
          required: ["baseline", "candidate"],
          properties: {
            baseline: { type: "string", description: "Path to baseline report.json" },
            candidate: { type: "string", description: "Path to candidate report.json" },
            failOnRegression: {
              type: "boolean",
              default: true,
              description: "If true, surface 'verdict: regression detected' prominently",
            },
          },
        },
      },
      {
        name: "analyze_report",
        description:
          "Drill into ONE specific slice of a saved report — returns a compact summary + the relevant JSON subset, NOT the full 50KB+ report. **Use this whenever a single insight is needed** — far cheaper than reading the full report via `ReadResource`. The 15 `insightName` values: `lcp-breakdown` (median/p75/cov + element attribution), `render-blocking` (top N by response time), `long-tasks` (≥50ms tasks sorted by duration), `third-parties` (vendor breakdown — requires `measure` with `plugins:['cwv','axe','third-parties']`), `opportunities` (top N by wastedMs), `audits` (failed first), `resources` (top N by transfer size), `frames` (frame tree), `full-load-breakdown` (settle-based Full-Load Time, gating phase, gating distribution, sub-timeline incl. visuallyCompleteAt — present for every v0.2.0+ report), `hotspots` (ranked component/region cost table — requires `measure` with `diagnose:true`), `remediation` (prescriptive ranked fixes with est. FLT impact + gating — requires `measure` with `rx:true`), `perf-summary` (the FULL comprehensive rollup: timing + network + javascript + main-thread + errors + stability — present for every v0.3.0+ report), `network` (requests/bytes by type, cache, 1st/3rd-party, render-blocking, failed requests), `javascript` (JS transfer bytes, parse/compile + execution time, main-thread blocking), `errors` (JS errors + console error/warning counts + failed requests, first-party attributed). That is **15** values total. Insights that need data the report lacks degrade gracefully (non-throwing slice with a re-measure hint). For a human-readable summary of the whole report use `generate_markdown_summary`; for a printable deck use `generate_deck`. Throws on unknown insightName.",
        inputSchema: {
          type: "object",
          required: ["insightName"],
          properties: {
            reportPath: {
              type: "string",
              description: "Filesystem path to report.json (alternative to 'uri')",
            },
            uri: {
              type: "string",
              description:
                "Resource URI like 'ohmyperf://reports/<file>.json' (alternative to 'reportPath')",
            },
            insightName: {
              type: "string",
              enum: INSIGHT_NAMES as unknown as string[],
              description: "Which slice of the report to return",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 20,
              description: "Max items for list-shaped insights (resources, long-tasks, etc.)",
            },
          },
        },
      },
      {
        name: "generate_markdown_summary",
        description:
          "Render a saved report as a single Markdown document (~2KB) using the same format as `ohmyperf run --reporter markdown`. **Use this for PR comments, chat replies, or any plain-text surface** — for visual artifacts use `generate_html_report` (interactive single-page viewer) or `generate_deck` (multi-slide print-to-PDF deck). Returns the Markdown as the only content block (no separate JSON sidecar). If you only need ONE specific insight (LCP attribution, opportunities, long-tasks, etc.), prefer `analyze_report` to avoid loading the full report. Customizable via `title` (default: 'OhMyPerf report').",
        inputSchema: {
          type: "object",
          properties: {
            reportPath: {
              type: "string",
              description: "Filesystem path to report.json (alternative to 'uri')",
            },
            uri: {
              type: "string",
              description: "Resource URI like 'ohmyperf://reports/<file>.json'",
            },
            title: {
              type: "string",
              description: "Override the H2 title (default: 'OhMyPerf report')",
            },
          },
        },
      },
      {
        name: "generate_deck",
        description:
          "Render a saved report as a multi-slide HTML presentation, write it to disk, and return the file path (NOT the body inline — decks are 30-500KB and would overflow MCP response budgets). **Use this for stakeholder distribution**: open in any browser, navigate with arrow keys, ⌘P → Save as PDF. Default location: `<reportsDir>/decks/<measurementId>.html`. **For interactive single-page viewing with CWV traffic-lights and a third-parties donut, use `generate_html_report` instead**; for plain Markdown use `generate_markdown_summary`. Light-locked by design (print-to-PDF is the primary distribution channel). Available `style` values: `calibre` (default), `linear-app`, `stripe`, `vercel` — call `list_styles` to see all brand metadata (displayName, supported themes).",
        inputSchema: {
          type: "object",
          properties: {
            reportPath: {
              type: "string",
              description: "Filesystem path to report.json (alternative to 'uri')",
            },
            uri: {
              type: "string",
              description: "Resource URI like 'ohmyperf://reports/<file>.json'",
            },
            outputDir: {
              type: "string",
              description: "Override the output directory (default: <reportsDir>/decks/).",
            },
            title: {
              type: "string",
              description: "Override the deck title (default: 'OhMyPerf — <hostname>').",
            },
            style: {
              type: "string",
              enum: ["calibre", "linear-app", "stripe", "vercel"],
              default: "calibre",
              description:
                "Visual brand style. Defaults to 'calibre'. Call 'list_styles' to discover available brands + their manifests.",
            },
          },
        },
      },
      {
        name: "generate_html_report",
        description:
          "Render a saved report as a single-file interactive HTML viewer, write it to disk, and return the file path (NOT the body inline — same response-budget pattern as `generate_deck`). **Use this for interactive web viewing**: hero + CWV traffic-light + third-parties donut + audits tables. Default location: `<reportsDir>/html/<measurementId>.html`. Dark mode follows `prefers-color-scheme` by default; override via `theme` (`light` | `dark` | `system`). **For multi-slide stakeholder decks, use `generate_deck` instead**; for plain Markdown use `generate_markdown_summary`. Available `style` values: `calibre` (default), `linear-app`, `stripe`, `vercel` — call `list_styles` for brand metadata. Unsupported (brand, theme) pairs fall back to the brand's preferred theme with a warning in the output.",
        inputSchema: {
          type: "object",
          properties: {
            reportPath: { type: "string", description: "Filesystem path to report.json" },
            uri: { type: "string", description: "Resource URI like 'ohmyperf://reports/<file>.json'" },
            outputDir: {
              type: "string",
              description: "Override the output directory (default: <reportsDir>/html/).",
            },
            title: {
              type: "string",
              description: "Override the viewer title (default: 'OhMyPerf — <hostname>').",
            },
            style: {
              type: "string",
              enum: ["calibre", "linear-app", "stripe", "vercel"],
              default: "calibre",
              description: "Visual brand style. Defaults to 'calibre'.",
            },
            theme: {
              type: "string",
              enum: ["light", "dark", "system"],
              default: "system",
              description:
                "Theme override. 'system' uses the brand's preferred theme. Unsupported (brand, theme) pairs fall back to the brand's preferred theme with a warning.",
            },
          },
        },
      },
      {
        name: "list_styles",
        description:
          "List the 4 available visual brand styles (BrandId + displayName + preferredTheme + light/dark support) for `generate_deck` and `generate_html_report`. **Call this when you need to pick a `style` value** — the enums in those tools' inputSchemas reflect the same set. Returns a tabular text summary plus the full `BRAND_MANIFEST` JSON sidecar. No parameters. Current brands: `calibre` (default), `linear-app`, `stripe`, `vercel`.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_runs",
        description:
          "List saved reports from the MCP server's reports dir, most recent first, with measurementId, URL, mode, runs, startedAt, file, and sizeBytes per entry. **Use this when you need the full report metadata** (mode, runs, startedAt) — equivalent to `ListResources` but returns richer rows for clients that don't browse MCP resources. To then read or diff specific reports, pass the `uri` (e.g. `ohmyperf://reports/<file>.json`) to `ReadResource`, `analyze_report`, `diff_resources`, `propose_patch`, `get_fix_plan`, `get_trust_score`, or `get_servability`. Corrupt/unreadable reports are surfaced as `(unreadable)` rows with mode `(unknown)` rather than failing the whole call. `limit` defaults to 25 (max 200).",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 25,
              description: "Max number of reports to list (most recent first)",
            },
          },
        },
      },
      {
        name: "diff_resources",
        description:
          "Identical to `diff` (Mann-Whitney U, per-metric verdicts with p-values and median deltas) but accepts MCP resource URIs (`ohmyperf://reports/<file>.json`) instead of filesystem paths. **Prefer this over `diff` when both reports are already on hand from a prior `list_runs` or `ListResources` call** — skips path resolution. Path-traversal in URI names is rejected (e.g. `../etc/passwd` → throws). Pair with `find_regression_cause` for causal attribution, or with `verify_fix` to gate a candidate deploy.",
        inputSchema: {
          type: "object",
          required: ["baselineUri", "candidateUri"],
          properties: {
            baselineUri: { type: "string", description: "Baseline resource URI" },
            candidateUri: { type: "string", description: "Candidate resource URI" },
            failOnRegression: {
              type: "boolean",
              default: true,
              description: "If true, surface 'verdict: regression detected' prominently",
            },
          },
        },
      },
      {
        name: "track_url",
        description:
          "Longitudinal monitoring: measure a URL AND append the new point to a per-URL time-series log at `~/.ohmyperf-mcp/timeseries/<sha256-url>.ndjson` (a sibling of the reports dir). **Use this INSTEAD of `measure` whenever the agent needs to reason about performance over time** — returns a trend verdict (improving | stable | regressing) per CWV metric over the full history, plus the new measurement point. Defaults to `mode='ci-stable'` (comparability across runs matters most for trend detection) and `plugins=['cwv']` (only the CWV plugin by default — add `third-parties` if you want vendor trend data). **Unique to ohmyperf** — chrome-devtools-mcp and similar servers have no persistence layer. History is capped at `historyLimit` (default 100, max 500) points. If a trend shows regression with high confidence, escalate to `find_regression_cause` between an old + new report.",
        inputSchema: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", description: "HTTP(S) URL to measure and track" },
            runs: {
              type: "integer",
              minimum: 1,
              maximum: 30,
              default: 3,
              description: "Number of measurement runs (default 3)",
            },
            mode: {
              type: "string",
              enum: ["real", "ci-stable"],
              default: "ci-stable",
              description:
                "ci-stable recommended for tracking: pre-flight CPU calibration + Fast 4G ensures comparability across runs.",
            },
            plugins: {
              type: "array",
              items: { type: "string", enum: PLUGIN_IDS as unknown as string[] },
              default: ["cwv"],
              description: "Built-in plugins to enable during the tracked measurement",
            },
            collectTrace: {
              type: "boolean",
              default: false,
              description: "Capture trace for the new point (adds ~5-20MB).",
            },
            browserPath: {
              type: "string",
              description: "Override the Chromium binary path (same as 'measure').",
            },
            historyLimit: {
              type: "integer",
              minimum: 5,
              maximum: 500,
              default: 100,
              description: "Max history points to consider when computing the trend.",
            },
          },
        },
      },
      {
        name: "find_regression_cause",
        description:
          "Causal investigation beyond a raw metric diff. Given two reports where a metric regressed, returns **RANKED HYPOTHESES with evidence**: new render-blocking resources, grown/slowed assets, new long tasks attributed to scripts, and new third-party vendors. **Use this AFTER `diff` or `diff_resources` surfaces a regression** — the L1 question is 'did a metric regress?'; the L2 question is 'why?', and this tool answers L2. Each hypothesis is prioritized by the regressed metric (LCP/INP/CLS heuristics). Accepts either filesystem paths or MCP resource URIs for both `baseline` and `candidate`. **Unique to ohmyperf** — devtools-mcp and similar servers only return raw diffs. For a one-line actionable narrative, consider the `investigate_regression` prompt instead, which chains this with `analyze_report`.",
        inputSchema: {
          type: "object",
          properties: {
            baseline: { type: "string", description: "Baseline filesystem path OR resource URI" },
            candidate: { type: "string", description: "Candidate filesystem path OR resource URI" },
          },
          required: ["baseline", "candidate"],
        },
      },
      {
        name: "enforce_budget",
        description:
          "Contract-as-code for CI: measure a URL, then evaluate the report against a perf budget object. Returns structured pass/fail per metric with an exit-code-style verdict: `status='PASS'|'FAIL'`, `exitCode=0` (pass), `12` (budget exceeded), or **`13` (gated/unmeasurable)**. **Use this to gate PRs** in CI — the exitCode mirrors Unix convention so scripts can `set -e` on it. **Trust gate**: if the measurement is a bot-challenge/error page (`servability != real-page`) or statistically `unreliable`, the verdict is `gated:true` with `exitCode=13` and `gateReason` — these numbers must NOT gate CI (the budget pass/fail is meaningless on a challenge page). Pass `force:true` to bypass the gate. Default budget: `lcp ≤ 2500ms, inp ≤ 200ms, cls ≤ 0.1, tbt ≤ 200ms, fcp ≤ 1800ms, ttfb ≤ 800ms`; override per-metric with the `budget` object (missing keys use defaults). Always uses `mode='ci-stable'` (default) for reproducibility. Optionally `track=true` to also append the measurement to the time-series log. **Unique to ohmyperf** — devtools-mcp and similar servers have no budget primitive. For a per-report post-hoc check on a saved file, use the `check_budget` prompt instead.",
        inputSchema: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", description: "HTTP(S) URL to measure" },
            budget: {
              type: "object",
              description:
                "Per-metric budget in metric units. Missing metrics use defaults. Example: { lcp: 2000, inp: 150 }",
              additionalProperties: { type: "number" },
            },
            runs: {
              type: "integer",
              minimum: 1,
              maximum: 30,
              default: 3,
              description: "Number of measurement runs (default 3)",
            },
            mode: {
              type: "string",
              enum: ["real", "ci-stable"],
              default: "ci-stable",
              description: "ci-stable recommended for budget enforcement",
            },
            plugins: {
              type: "array",
              items: { type: "string", enum: PLUGIN_IDS as unknown as string[] },
              default: ["cwv"],
            },
            browserPath: {
              type: "string",
              description: "Override the Chromium binary path (same as 'measure').",
            },
            track: {
              type: "boolean",
              default: false,
              description: "If true, also append this measurement to the time-series log.",
            },
            force: {
              type: "boolean",
              default: false,
              description:
                "Bypass the trust/servability gate (exitCode 13). Use only when you accept that the measurement may be a bot-challenge/error page or statistically unreliable.",
            },
          },
        },
      },
      {
        name: "propose_patch",
        description:
          "Generate concrete, grep-and-replace patches for actionable opportunities in a saved report. Each patch has `{archetype, url, search, replace, rationale, expectedImpactMs, confidence}` — the agent can `grep` the `search` string in the repo and apply the `replace`. **Use this after `measure` (or `analyze_report` with insightName='opportunities') to close the loop from data to code change.** Pair with `verify_fix` to re-measure after applying. **Always check `get_trust_score` first** — patches on a report with `overall: unreliable` are likely based on noisy data. Currently supported archetypes: `render-blocking-script-add-defer`, `render-blocking-stylesheet-media-print`, `lcp-image-fetchpriority-high`, `lcp-image-link-preload`. When an entry has `targets[]` (multiple URLs collapsed by archetype), `expectedImpactMs` is the SUM across all targets; per-URL impact lives in `targets[i].expectedImpactMs`. For a higher-level ranked list (not patches), use `get_fix_plan`.",
        inputSchema: {
          type: "object",
          properties: {
            reportPath: {
              type: "string",
              description: "Filesystem path to report.json (alternative to 'uri')",
            },
            uri: {
              type: "string",
              description: "Resource URI like 'ohmyperf://reports/<file>.json' (alternative to 'reportPath')",
            },
            opportunityId: {
              type: "string",
              description:
                "Limit patches to one opportunity id (e.g. 'render-blocking-resources', 'largest-contentful-paint-image'). Omit to propose patches for all matching opportunities.",
            },
            url: {
              type: "string",
              description: "Limit patches to one resource URL (e.g. the LCP image or a specific render-blocking script).",
            },
            maxPatches: {
              type: "integer",
              minimum: 1,
              maximum: 50,
              default: 10,
              description: "Max patches to return, sorted by expectedImpactMs desc (default 10)",
            },
          },
        },
      },
      {
        name: "verify_fix",
        description:
          "Closes the agent fix loop: re-measure a candidate URL (typically a preview/staging deploy of patched code) and diff it against a baseline report using Mann-Whitney U. Returns a structured pass/fail/neutral verdict per CWV metric plus a top-line `hasRegressions` boolean and a human-readable verdict line. **Use this AFTER applying a `propose_patch` suggestion** to confirm the fix actually moved metrics — never trust a single before/after pair without the significance test. Always uses `mode='ci-stable'` (default) so the candidate is comparable to a ci-stable baseline. **`runs` defaults to 5** — the minimum needed for Mann-Whitney U to reach statistical significance at α=0.05; with `runs<5` all metrics will (correctly) report 'neutral' because tiny samples can't distinguish real effects from noise. Throws on missing/invalid `candidateUrl` (must be http(s)). For a deeper root-cause analysis of any regression surfaced, follow up with `find_regression_cause`.",
        inputSchema: {
          type: "object",
          required: ["candidateUrl"],
          properties: {
            baselineReportPath: {
              type: "string",
              description: "Filesystem path to baseline report.json (alternative to 'baselineUri'). The 'before' measurement.",
            },
            baselineUri: {
              type: "string",
              description: "Baseline resource URI like 'ohmyperf://reports/<file>.json' (alternative to 'baselineReportPath').",
            },
            candidateUrl: {
              type: "string",
              description: "HTTP(S) URL to measure as the candidate (the 'after'). Typically a preview/staging deploy URL where the proposed patch has been applied.",
            },
            runs: {
              type: "integer",
              minimum: 1,
              maximum: 30,
              default: 5,
              description: "Number of measurement runs for the candidate. Default 5 (minimum required for the Mann-Whitney U test to reach statistical significance under default alpha=0.05). With runs<5, even perfect separation between baseline and candidate cannot be classified as 'improvement' or 'regression' — all metrics will report 'neutral' (correctly: tiny samples are genuinely too small to distinguish real effects from noise).",
            },
            mode: {
              type: "string",
              enum: ["real", "ci-stable"],
              default: "ci-stable",
              description: "ci-stable recommended for verify_fix — pre-flight CPU calibration + Fast 4G ensures the candidate is comparable to a ci-stable baseline.",
            },
            browserPath: {
              type: "string",
              description: "Override the Chromium binary path (same as 'measure').",
            },
            collectTrace: {
              type: "boolean",
              default: false,
              description: "Capture trace for the candidate run (adds ~5-20MB).",
            },
          },
        },
      },
      {
        name: "get_fix_plan",
        description:
          "**The agent's primary decision tool**: 'what is my #1 highest-leverage fix?' Returns ONLY the precomputed `fixPlan` from a saved report — a ranked, ROI-scored, deduped list of actionable fixes with `rank`, `archetype`, `target.url`, `target.originClass`, `expectedImpactMs`, `confidence`, `applicability` (first-party / third-party-cannot-apply / unknown), `effort`, and a one-line `patchPreview`. **Prefer this over `propose_patch` when you want a ranked list rather than grep-and-replace patches** — `propose_patch` is for execution; `get_fix_plan` is for prioritization. The plan is sorted by `applicability` (first-party first — things the dev team can actually change) then by ROI. Same-archetype URLs are collapsed into a single grouped entry: when `targets[]` is present, `expectedImpactMs` is the SUM across all targets (per-URL in `targets[i].expectedImpactMs`) and `confidence` is the WORST among siblings. `applicabilityFilter='first-party'` excludes third-party CDN URLs (mark your own CDNs as first-party via `OHMYPERF_ORG_DOMAINS`). Returns empty plan with a hint if the report predates v0.2.0 — rerun `measure` to refresh.",
        inputSchema: {
          type: "object",
          properties: {
            reportPath: { type: "string", description: "Filesystem path to report.json" },
            uri: { type: "string", description: "Resource URI like 'ohmyperf://reports/<file>.json'" },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 50,
              default: 5,
              description: "Max entries to return (default 5). Entries are pre-sorted by rank.",
            },
            applicabilityFilter: {
              type: "string",
              enum: ["first-party", "any"],
              default: "any",
              description: "Filter by applicability. 'first-party' returns only fixes the dev team can apply (excludes third-party CDN URLs).",
            },
          },
        },
      },
      {
        name: "get_trust_score",
        description:
          "Returns the precomputed `trustScore` from a saved report — `overall: high | medium | low | unreliable`, per-metric verdicts (sample confidence + effect confidence), a `reasons` array, and a `recommendedAction` when the measurement is too noisy/undersampled for downstream tools. **Call this BEFORE `propose_patch` or `verify_fix` on any report you're not sure about** — if `overall === 'unreliable'`, the report's CWV metrics aren't statistically stable enough to drive decisions; rerun `measure` with more runs or `mode='ci-stable'` first. **Distinct from `get_servability`**: trust is about *statistical* validity (sample size, effect size, variance), servability is about *what was measured* (real page vs bot-challenge vs error page). For a comprehensive pre-flight check, call BOTH. Returns a hint if the report predates v0.2.0 — rerun `measure` to refresh.",
        inputSchema: {
          type: "object",
          properties: {
            reportPath: { type: "string", description: "Filesystem path to report.json" },
            uri: { type: "string", description: "Resource URI like 'ohmyperf://reports/<file>.json'" },
          },
        },
      },
      {
        name: "get_servability",
        description:
          "Returns the precomputed `meta.servability` from a saved report — answers 'did I measure the real page, or a bot-challenge / error page / timeout?'. Classifications: `real-page` (safe to gate CI), `bot-challenge-suspected` (Cloudflare/PerimeterX/hCaptcha page — CWV metrics are NOT representative of real users, must NOT gate CI), `error-page` (404/5xx served), `timeout-partial` (some runs timed out), `unknown`. **Call this BEFORE drawing conclusions from a report** — a `bot-challenge-suspected` report's CWV numbers measure the challenge page, not your product. **Distinct from `get_trust_score`**: servability is about *what was measured*, trust is about *statistical* validity. For a comprehensive pre-flight check, call BOTH. Returns a hint if the report predates v0.2.0 — rerun `measure` with a different `mode` or `runs` if the classification is suspect.",
        inputSchema: {
          type: "object",
          properties: {
            reportPath: { type: "string", description: "Filesystem path to report.json" },
            uri: { type: "string", description: "Resource URI like 'ohmyperf://reports/<file>.json'" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (name === "measure") {
      const input = parseMeasureInput(args);
      const report = await measure(input);
      const path = await saveReport(reportsDir, report);
      await trimReports(reportsDir, maxReports);
      return {
        content: [
          { type: "text", text: summarize(report, path) },
          { type: "text", text: JSON.stringify(report.aggregated, null, 2) },
        ],
      };
    }

    if (name === "diff") {
      const input = parseDiffInput(args);
      const baseline = await loadReport(input.baseline);
      const candidate = await loadReport(input.candidate);
      const diff = diffReports(baseline, candidate);
      return {
        content: [
          { type: "text", text: formatDiff(diff) },
          {
            type: "text",
            text: JSON.stringify(
              {
                hasRegressions: diff.hasRegressions,
                metrics: diff.metrics,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "analyze_report") {
      const path = resolveReportRef(reportsDir, args);
      const insightName = parseInsightName(args["insightName"]);
      const limit = parseLimit(args["limit"], 20);
      const report = await loadReport(path);
      const slice = extractInsight(report, insightName, limit);
      return {
        content: [
          { type: "text", text: slice.summary },
          { type: "text", text: JSON.stringify(slice.data, null, 2) },
        ],
      };
    }

    if (name === "generate_markdown_summary") {
      const path = resolveReportRef(reportsDir, args);
      const report = await loadReport(path);
      const title = typeof args["title"] === "string" ? args["title"] : undefined;
      const md = renderMarkdown(report, title ? { title } : {});
      return { content: [{ type: "text", text: md }] };
    }

    if (name === "generate_deck") {
      const path = resolveReportRef(reportsDir, args);
      const report = await loadReport(path);
      const outputDir = typeof args["outputDir"] === "string" && args["outputDir"]
        ? resolve(args["outputDir"])
        : join(reportsDir, "decks");
      const title = typeof args["title"] === "string" ? args["title"] : undefined;
      const style = parseStyleArg(args["style"]);
      const fileName = `${report.meta.measurementId}.html`;
      const result = await writeDeckReport(report, outputDir, {
        fileName,
        style,
        ...(title ? { title } : {}),
      });
      return {
        content: [
          {
            type: "text",
            text: `Wrote deck to ${result.path} (${String(result.bytes)} bytes, style=${style}). Open in a browser, navigate via ArrowLeft/Right, ⌘P → Save as PDF for stakeholder distribution.`,
          },
          { type: "text", text: JSON.stringify({ ...result, style }, null, 2) },
        ],
      };
    }

    if (name === "generate_html_report") {
      const path = resolveReportRef(reportsDir, args);
      const report = await loadReport(path);
      const outputDir = typeof args["outputDir"] === "string" && args["outputDir"]
        ? resolve(args["outputDir"])
        : join(reportsDir, "html");
      const title = typeof args["title"] === "string" ? args["title"] : undefined;
      const style = parseStyleArg(args["style"]);
      const themeRaw = typeof args["theme"] === "string" ? args["theme"] : "system";
      const theme: "light" | "dark" | "system" =
        themeRaw === "light" || themeRaw === "dark" ? themeRaw : "system";
      const fileName = `${report.meta.measurementId}.html`;
      const result = await writeHtmlReport(report, outputDir, {
        fileName,
        style,
        theme,
        ...(title ? { title } : {}),
      });
      return {
        content: [
          {
            type: "text",
            text: `Wrote HTML viewer to ${result.path} (${String(result.bytes)} bytes, style=${style}, theme=${theme}). Open in any browser.`,
          },
          { type: "text", text: JSON.stringify({ ...result, style, theme }, null, 2) },
        ],
      };
    }

    if (name === "list_styles") {
      const summary = BRAND_IDS.map((id) => {
        const m = BRAND_MANIFEST[id];
        return `  ${id.padEnd(12)} ${m.displayName.padEnd(8)} preferred=${m.preferredTheme} light=${m.supportsLight ? "✓" : "✗"} dark=${m.supportsDark ? "✓" : "✗"}`;
      }).join("\n");
      return {
        content: [
          { type: "text", text: `4 visual brand styles available:\n${summary}` },
          { type: "text", text: JSON.stringify(BRAND_MANIFEST, null, 2) },
        ],
      };
    }

    if (name === "list_runs") {
      const limit = parseLimit(args["limit"], 25);
      const files = await listReportFiles(reportsDir);
      const limited = files.slice(0, limit);
      const rows = await Promise.all(
        limited.map(async (f) => {
          try {
            const r = await loadReport(join(reportsDir, f.name));
            return {
              file: f.name,
              uri: `ohmyperf://reports/${f.name}`,
              url: r.meta.url,
              mode: r.meta.mode,
              runs: r.meta.runs,
              startedAt: r.meta.startedAt,
              measurementId: r.meta.measurementId,
              sizeBytes: f.sizeBytes,
            };
          } catch {
            return {
              file: f.name,
              uri: `ohmyperf://reports/${f.name}`,
              url: "(unreadable)",
              mode: "(unknown)",
              runs: 0,
              startedAt: new Date(f.mtimeMs).toISOString(),
              measurementId: "",
              sizeBytes: f.sizeBytes,
            };
          }
        }),
      );
      const summary = [
        `${String(rows.length)} of ${String(files.length)} reports (most recent first):`,
        ...rows.map(
          (r) =>
            `  ${r.startedAt} · ${r.mode} · runs=${String(r.runs)} · ${r.url} → ${r.uri}`,
        ),
      ].join("\n");
      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(rows, null, 2) },
        ],
      };
    }

    if (name === "diff_resources") {
      const baselinePath = resolveResourceUri(reportsDir, args["baselineUri"]);
      const candidatePath = resolveResourceUri(reportsDir, args["candidateUri"]);
      const baseline = await loadReport(baselinePath);
      const candidate = await loadReport(candidatePath);
      const diff = diffReports(baseline, candidate);
      return {
        content: [
          { type: "text", text: formatDiff(diff) },
          {
            type: "text",
            text: JSON.stringify(
              { hasRegressions: diff.hasRegressions, metrics: diff.metrics },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "track_url") {
      const input = parseMeasureInput({ ...args, mode: args["mode"] ?? "ci-stable" });
      const report = await measure(input);
      const savedPath = await saveReport(reportsDir, report);
      await trimReports(reportsDir, maxReports);
      const point = await appendTimeSeriesPoint(reportsDir, report);
      const historyLimit = parseLimit(args["historyLimit"], 100);
      const history = await readTimeSeries(reportsDir, input.url, historyLimit);
      const trends = detectAllTrends(history);
      return {
        content: [
          { type: "text", text: formatTrendSummary(point, history, trends, savedPath) },
          { type: "text", text: JSON.stringify({ point, trends, historyN: history.length }, null, 2) },
        ],
      };
    }

    if (name === "find_regression_cause") {
      const baseline = await loadReport(
        resolveReportRef(reportsDir, { reportPath: args["baseline"], uri: args["baseline"] }),
      );
      const candidate = await loadReport(
        resolveReportRef(reportsDir, { reportPath: args["candidate"], uri: args["candidate"] }),
      );
      const analysis = analyzeRegressionCause(baseline, candidate);
      return {
        content: [
          { type: "text", text: analysis.summary },
          { type: "text", text: JSON.stringify(toCompactCause(analysis), null, 2) },
        ],
      };
    }

    if (name === "enforce_budget") {
      const input = parseMeasureInput({ ...args, mode: args["mode"] ?? "ci-stable" });
      const report = await measure(input);
      const savedPath = await saveReport(reportsDir, report);
      await trimReports(reportsDir, maxReports);
      if (args["track"] === true) {
        await appendTimeSeriesPoint(reportsDir, report);
      }
      const budget = parseBudget(args["budget"]);
      const verdict = evaluateBudget(report, budget, args["force"] === true);
      return {
        content: [
          { type: "text", text: formatBudgetVerdict(verdict, savedPath) },
          { type: "text", text: JSON.stringify(verdict, null, 2) },
        ],
      };
    }

    if (name === "propose_patch") {
      const path = resolveReportRef(reportsDir, args);
      const report = await loadReport(path);
      const opportunityId = typeof args["opportunityId"] === "string" ? args["opportunityId"] : undefined;
      const filterUrl = typeof args["url"] === "string" ? args["url"] : undefined;
      const maxPatches = parseLimit(args["maxPatches"], 10);
      const result = proposePatches({
        report,
        ...(opportunityId ? { opportunityId } : {}),
        ...(filterUrl ? { url: filterUrl } : {}),
        maxPatches,
      });
      const summaryLines: string[] = [];
      const trustWarning = unreliableTrustWarning(report);
      if (trustWarning) summaryLines.push(trustWarning);
      summaryLines.push(`propose_patch: ${String(result.patches.length)} patch(es) for ${report.meta.url}`);
      for (const p of result.patches) {
        const impact = p.expectedImpactMs !== undefined ? `~${p.expectedImpactMs.toFixed(0)}ms ${p.expectedMetric ?? ""}` : "impact unknown";
        summaryLines.push(`  • [${p.archetype}] ${p.url} (${impact}, confidence=${p.confidence})`);
      }
      if (result.skipped.length > 0) {
        summaryLines.push("Skipped:");
        for (const s of result.skipped) {
          summaryLines.push(`  • ${s.opportunityId}: ${s.reason}`);
        }
      }
      return {
        content: [
          { type: "text", text: summaryLines.join("\n") },
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    }

    if (name === "verify_fix") {
      const candidateUrl = typeof args["candidateUrl"] === "string" ? args["candidateUrl"] : "";
      if (!candidateUrl || !/^https?:\/\//.test(candidateUrl)) {
        throw new Error("verify_fix: 'candidateUrl' must be an http(s) URL");
      }
      const baselineArgs: Record<string, unknown> = {};
      if (typeof args["baselineReportPath"] === "string") baselineArgs["reportPath"] = args["baselineReportPath"];
      if (typeof args["baselineUri"] === "string") baselineArgs["uri"] = args["baselineUri"];
      const baselinePath = resolveReportRef(reportsDir, baselineArgs);
      const baseline = await loadReport(baselinePath);

      const measureArgs: Record<string, unknown> = {
        url: candidateUrl,
        runs: args["runs"] ?? 5,
        mode: args["mode"] ?? "ci-stable",
      };
      if (typeof args["browserPath"] === "string") measureArgs["browserPath"] = args["browserPath"];
      if (args["collectTrace"] === true) measureArgs["collectTrace"] = true;

      const candidateInput = parseMeasureInput(measureArgs);
      const candidate = await measure(candidateInput);
      const candidatePath = await saveReport(reportsDir, candidate);
      await trimReports(reportsDir, maxReports);

      const diff = diffReports(baseline, candidate);
      const classified = classifyVerifyFix(candidate, diff.hasRegressions);
      const summary = [
        classified.line,
        `Baseline: ${baseline.meta.url} (measurementId=${baseline.meta.measurementId})`,
        `Candidate: ${candidate.meta.url} (measurementId=${candidate.meta.measurementId}) → ${candidatePath}`,
        "",
        formatDiff(diff),
      ].join("\n");
      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify(
              {
                verdict: classified.verdict,
                hasRegressions: diff.hasRegressions,
                candidateTrust: candidate.trustScore?.overall ?? null,
                candidatePath,
                metrics: diff.metrics,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "get_fix_plan") {
      const path = resolveReportRef(reportsDir, args);
      const report = await loadReport(path);
      const limit = Math.min(parseLimit(args["limit"], 5), 50);
      const applicabilityFilter = args["applicabilityFilter"] === "first-party" ? "first-party" : "any";
      const fullPlan = report.fixPlan;
      const lines: string[] = [];
      if (fullPlan === undefined) {
        lines.push("fix plan: not present (report predates v0.2.0 — rerun `measure` to generate a v0.2.0 report with fixPlan)");
        return {
          content: [
            { type: "text", text: lines.join("\n") },
            { type: "text", text: JSON.stringify({ entries: [], total: 0 }, null, 2) },
          ],
        };
      }
      const filtered = applicabilityFilter === "first-party"
        ? fullPlan.filter((e) => e.applicability === "first-party")
        : fullPlan;
      const entries = filtered.slice(0, limit);
      if (entries.length === 0) {
        lines.push("fix plan: 0 entries");
        if (applicabilityFilter === "first-party" && fullPlan.length > 0) {
          lines.push(`(${String(fullPlan.length)} entries exist but all are third-party — try applicabilityFilter=any to see them, or set OHMYPERF_ORG_DOMAINS to mark org-owned CDNs as first-party)`);
        }
      } else {
        lines.push(`fix plan: ${String(entries.length)} of ${String(fullPlan.length)} entries${applicabilityFilter === "first-party" ? " (first-party only)" : ""}`);
        for (const e of entries) {
          lines.push(`  #${String(e.rank)} [${e.archetype}] ${e.target.url}`);
          lines.push(`     impact: ~${e.expectedImpactMs.toFixed(0)}ms ${e.expectedMetric} · confidence: ${e.confidence} · applicability: ${e.applicability} · effort: ${e.effort}`);
          lines.push(`     preview: ${e.patchPreview}`);
        }
      }
      return {
        content: [
          { type: "text", text: lines.join("\n") },
          { type: "text", text: JSON.stringify({ entries, total: fullPlan.length }, null, 2) },
        ],
      };
    }

    if (name === "get_trust_score") {
      const path = resolveReportRef(reportsDir, args);
      const report = await loadReport(path);
      const trust = report.trustScore;
      if (!trust) {
        return {
          content: [
            { type: "text", text: "trustScore not present (report predates v0.2.0 — rerun `measure` to generate a v0.2.0 report with trustScore)" },
            { type: "text", text: JSON.stringify(null) },
          ],
        };
      }
      const lines: string[] = [];
      lines.push(`Trust score: ${trust.overall}`);
      lines.push(`Reasons: ${trust.reasons.join(", ")}`);
      if (trust.recommendedAction) lines.push(`Recommended: ${trust.recommendedAction}`);
      lines.push("Per metric:");
      for (const [metricName, v] of Object.entries(trust.perMetric)) {
        lines.push(
          `  ${metricName.toUpperCase().padEnd(5)} overall=${v.level} (sample=${v.sampleConfidence}, effect=${v.effectConfidence})${v.recommendedAction ? ` — ${v.recommendedAction}` : ""}`,
        );
      }
      return {
        content: [
          { type: "text", text: lines.join("\n") },
          { type: "text", text: JSON.stringify(trust, null, 2) },
        ],
      };
    }

    if (name === "get_servability") {
      const path = resolveReportRef(reportsDir, args);
      const report = await loadReport(path);
      const s = report.meta.servability;
      if (!s) {
        return {
          content: [
            { type: "text", text: "servability not present (report predates v0.2.0 — rerun `measure` to generate a v0.2.0 report with servability)" },
            { type: "text", text: JSON.stringify(null) },
          ],
        };
      }
      const lines: string[] = [];
      lines.push(`Servability: ${s.classification}`);
      if (s.signals.length > 0) lines.push(`Signals: ${s.signals.join(", ")}`);
      if (s.recommendedAction) lines.push(`Recommended: ${s.recommendedAction}`);
      return {
        content: [
          { type: "text", text: lines.join("\n") },
          { type: "text", text: JSON.stringify(s, null, 2) },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const files = await listReportFiles(reportsDir);
    return {
      resources: files.map((f) => ({
        uri: `ohmyperf://reports/${f.name}`,
        name: f.name,
        description: `Saved report (${new Date(f.mtimeMs).toISOString()}, ${String(f.sizeBytes)} bytes)`,
        mimeType: "application/json",
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const path = resolveResourceUri(reportsDir, uri);
    const body = await readFile(path, "utf8");
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: body,
        },
      ],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [
      {
        name: "diagnose_report",
        description:
          "Walk through a saved report end-to-end: CWV verdict, top opportunities, long-tasks, render-blocking resources, third-party impact. **Use this when you want a comprehensive diagnosis from a single report** — chains `analyze_report` across 5 insights (lcp-breakdown, opportunities, render-blocking, long-tasks, third-parties) in priority order, then produces an actionable root-cause hypothesis with 3 verification steps. Output is a narrative investigation plan, not raw data. For comparing TWO reports, use `compare_runs` instead.",
        arguments: [
          { name: "reportPath", description: "Filesystem path or `ohmyperf://reports/<file>.json` URI to a saved report.json", required: true },
        ],
      },
      {
        name: "compare_runs",
        description:
          "Compare a baseline and candidate report, identify regressions, attribute them to specific metrics, suggest likely causes. **Use this when you have two reports and want a regression narrative** — chains `diff_resources` (or `diff`) with `analyze_report` on the matching insight for each regressed metric (e.g. lcp-breakdown for an LCP regression). Output is the most likely cause + the minimal change that would reverse the regression. For deeper causal ranking, use `investigate_regression` (which adds `find_regression_cause`). For a single-report diagnosis, use `diagnose_report`.",
        arguments: [
          { name: "baseline", description: "Baseline report path or `ohmyperf://reports/<file>.json` URI", required: true },
          { name: "candidate", description: "Candidate report path or `ohmyperf://reports/<file>.json` URI", required: true },
        ],
      },
      {
        name: "suggest_fixes",
        description:
          "Given a saved report, propose concrete code-level fixes prioritized by metric impact (LCP > INP > CLS > TBT > TTFB) and effort (S/M/L). **Use this when you want a prioritized fix list, not just a diff** — chains `analyze_report` for opportunities and render-blocking, then estimates file/area, expected impact, effort, and a validation step (rerun `measure` with the same URL). For grep-and-replace patches ready to apply, use `propose_patch` (execution); for an even more concise ranked list use `get_fix_plan` (prioritization).",
        arguments: [
          { name: "reportPath", description: "Filesystem path or `ohmyperf://reports/<file>.json` URI to a saved report.json", required: true },
        ],
      },
      {
        name: "audit_third_parties",
        description:
          "Surface third-party scripts dragging down the page. **Use this when the report was measured with `plugins:['cwv','axe','third-parties']`** (without that plugin, the audit will instruct the user to rerun). Chains `analyze_report` with insightName='third-parties' to list top vendors by main-thread time AND by transfer size, and cross-references render-blocking to flag any vendor that blocks LCP. Output is a vendor-by-vendor impact breakdown, not a code patch list.",
        arguments: [
          { name: "reportPath", description: "Filesystem path or `ohmyperf://reports/<file>.json` URI to a saved report.json. Must have been measured with the 'third-parties' plugin enabled.", required: true },
        ],
      },
      {
        name: "check_budget",
        description:
          "Evaluate a saved report against the project's perf budget (default: lcp ≤ 2500ms, inp ≤ 200ms, cls ≤ 0.1, tbt ≤ 200ms, fcp ≤ 1800ms, ttfb ≤ 800ms). **Use this for post-hoc budget checks on existing reports** — for live CI enforcement (measure + evaluate in one shot), use the `enforce_budget` tool instead. Output is pass/fail per metric with the actual delta from the budget.",
        arguments: [
          { name: "reportPath", description: "Filesystem path or `ohmyperf://reports/<file>.json` URI to a saved report.json", required: true },
          {
            name: "budget",
            description:
              "Optional JSON budget object, e.g. '{\"lcp\":2500,\"inp\":200,\"cls\":0.1,\"tbt\":200,\"fcp\":1800,\"ttfb\":800}'. Missing keys fall back to the defaults above.",
            required: false,
          },
        ],
      },
      {
        name: "investigate_regression",
        description:
          "Causal investigation flow that produces an actionable root-cause narrative, not raw data. **Use this when `compare_runs` or `diff_resources` surfaced a regression and you want to know WHY** — chains `find_regression_cause` (ranked hypotheses with evidence) with `analyze_report` on the top-1 hypothesis (e.g. drill into the new render-blocking script or third-party vendor). Differs from `compare_runs`: compare_runs is metric-level (what regressed), investigate_regression is hypothesis-level (what caused it). For a confidence check on the underlying data first, call `get_trust_score`.",
        arguments: [
          { name: "baseline", description: "Baseline report path or `ohmyperf://reports/<file>.json` URI", required: true },
          { name: "candidate", description: "Candidate report path or `ohmyperf://reports/<file>.json` URI", required: true },
        ],
      },
      {
        name: "monitor_trend",
        description:
          "Longitudinal monitoring flow. **Use this for periodic perf tracking** — chains `track_url` (append new measurement + per-metric trend verdict) and escalates to `find_regression_cause` if any metric is regressing with high confidence. Differs from a one-shot `measure`: measure has no memory, monitor_trend builds a time series at `~/.ohmyperf-mcp/timeseries/<sha256-url>.ndjson` and reasons over history. For a one-time comparison of two saved reports, use `compare_runs` instead.",
        arguments: [
          { name: "url", description: "HTTP(S) URL to monitor. Will be measured and appended to the per-URL time-series log.", required: true },
        ],
      },
      {
        name: "measure_and_diagnose",
        description:
          "Full v0.3.0 diagnostic flow for a LIVE URL: measure with Full-Load Time + component hotspots + prescriptive remediations, gated on trust/servability. **Use this when you want the complete settle-based picture in one flow** — chains `measure` (with diagnose+rx) → `get_servability`/`get_trust_score` → `analyze_report` across full-load-breakdown, hotspots, remediation. Output is a settle-based load diagnosis (NOT just LCP): what gates Full-Load, which components cost the most, and the ranked fixes (lazy-load / virtualize / viewport-only / unblock). For a single SAVED report use `diagnose_report`; for two reports use `compare_runs`.",
        arguments: [
          { name: "url", description: "HTTP(S) URL to measure and diagnose end-to-end.", required: true },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const promptName = request.params.name;
    const args = request.params.arguments ?? {};
    const messages = buildPromptMessages(promptName, args);
    return { messages };
  });

  return server;
}

export function parseMeasureInput(args: Record<string, unknown>): MeasureInput {
  const url = typeof args["url"] === "string" ? args["url"] : "";
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error("measure: 'url' must be an http(s) URL");
  }
  const runs = typeof args["runs"] === "number" && Number.isInteger(args["runs"]) ? args["runs"] : 3;
  if (runs < 1 || runs > 30) {
    throw new Error("measure: 'runs' must be 1..30");
  }
  const mode = args["mode"] === "ci-stable" ? "ci-stable" : "real";
  const plugins = Array.isArray(args["plugins"])
    ? args["plugins"].filter((p): p is PluginId =>
        (PLUGIN_IDS as readonly string[]).includes(p as string),
      )
    : (["cwv", "axe"] as const);
  const browserPath = typeof args["browserPath"] === "string" ? args["browserPath"] : undefined;
  const collectTrace = args["collectTrace"] === true;
  const diagnose = args["diagnose"] === true;
  const rx = args["rx"] === true;
  const fullLoad = parseFullLoadConfig(args["fullLoad"]);
  return {
    url,
    runs,
    mode,
    plugins,
    ...(browserPath !== undefined ? { browserPath } : {}),
    ...(collectTrace ? { collectTrace: true } : {}),
    ...(diagnose ? { diagnose: true } : {}),
    ...(rx ? { rx: true } : {}),
    ...(fullLoad ? { fullLoad } : {}),
  };
}

const FULL_LOAD_KEYS = [
  "until",
  "settleWindowMs",
  "maxWaitMs",
  "netIdleThreshold",
  "mutationNoiseFloor",
  "longLivedGraceMs",
  "visual",
  "visualIntervalMs",
  "visualDiffEpsilon",
  "strictNetwork",
] as const;

/** Pick only known FullLoadConfig keys from a client-supplied object. Returns undefined when empty. */
function parseFullLoadConfig(raw: unknown): Partial<FullLoadConfig> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of FULL_LOAD_KEYS) {
    if (k in src && src[k] !== undefined) out[k] = src[k];
  }
  return Object.keys(out).length > 0 ? (out as Partial<FullLoadConfig>) : undefined;
}

/** A re-measure warning to prepend to propose_patch output when the report's trust is unreliable. */
export function unreliableTrustWarning(report: Report): string | undefined {
  return report.trustScore?.overall === "unreliable"
    ? "⚠ Trust is UNRELIABLE — these patches are based on statistically noisy data. Re-measure with more runs (mode='ci-stable') before applying."
    : undefined;
}

export type VerifyVerdict = "inconclusive" | "regression" | "ok";

/** verify_fix verdict. An unreliable candidate trust forces 'inconclusive' (cannot confirm the fix). */
export function classifyVerifyFix(
  candidate: Report,
  hasRegressions: boolean,
): { verdict: VerifyVerdict; line: string } {
  if (candidate.trustScore?.overall === "unreliable") {
    return {
      verdict: "inconclusive",
      line: "verify_fix: ⚠ INCONCLUSIVE — candidate measurement trust is unreliable; cannot confirm the fix. Re-measure the candidate with more runs (mode='ci-stable').",
    };
  }
  return hasRegressions
    ? {
        verdict: "regression",
        line: "verify_fix: ❌ REGRESSION DETECTED — candidate is significantly worse than baseline on at least one CWV metric",
      }
    : {
        verdict: "ok",
        line: "verify_fix: ✅ no regression — candidate is at least as good as baseline",
      };
}

function parseDiffInput(args: Record<string, unknown>): DiffInput {
  const baseline = typeof args["baseline"] === "string" ? args["baseline"] : "";
  const candidate = typeof args["candidate"] === "string" ? args["candidate"] : "";
  if (!baseline || !candidate) {
    throw new Error("diff: 'baseline' and 'candidate' must be filesystem paths");
  }
  return {
    baseline,
    candidate,
    failOnRegression: args["failOnRegression"] !== false,
  };
}

function parseInsightName(raw: unknown): InsightName {
  if (typeof raw !== "string" || !(INSIGHT_NAMES as readonly string[]).includes(raw)) {
    throw new Error(
      `analyze_report: 'insightName' must be one of: ${INSIGHT_NAMES.join(", ")}`,
    );
  }
  return raw as InsightName;
}

function parseStyleArg(raw: unknown): BrandId {
  if (isBrandId(raw)) return raw;
  return "calibre";
}

function parseLimit(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 200) return raw;
  return fallback;
}

function resolveReportRef(reportsDir: string, args: Record<string, unknown>): string {
  if (typeof args["reportPath"] === "string" && args["reportPath"]) {
    return resolve(args["reportPath"]);
  }
  if (typeof args["uri"] === "string" && args["uri"]) {
    return resolveResourceUri(reportsDir, args["uri"]);
  }
  throw new Error("Provide either 'reportPath' (filesystem) or 'uri' (ohmyperf://reports/...)");
}

function resolveResourceUri(reportsDir: string, uri: unknown): string {
  if (typeof uri !== "string") {
    throw new Error("Resource URI must be a string");
  }
  const m = /^ohmyperf:\/\/reports\/([\w.-]+)$/.exec(uri);
  if (!m) throw new Error(`Unknown resource URI: ${uri}`);
  const name = m[1]!;
  if (name.includes("..") || name.includes("/")) {
    throw new Error(`Refusing path-traversal in resource name: ${name}`);
  }
  return join(reportsDir, name);
}

export interface InsightSlice {
  summary: string;
  data: unknown;
}

export function extractInsight(report: Report, name: InsightName, limit: number): InsightSlice {
  switch (name) {
    case "lcp-breakdown": {
      const lcp = report.aggregated["lcp"];
      const attribution = report.runs[0]?.metrics["lcp"]?.attribution;
      return {
        summary: lcp
          ? `LCP: median=${lcp.median.toFixed(0)}ms p75=${lcp.p75.toFixed(0)}ms cov=${(lcp.cov * 100).toFixed(1)}% (${String(lcp.runs)} runs)`
          : "LCP not measured.",
        data: { aggregated: lcp ?? null, attribution: attribution ?? null },
      };
    }
    case "render-blocking": {
      const blocking = report.runs[0]?.resources.filter((r) => r.renderBlocking) ?? [];
      const top = blocking.slice(0, limit).map((r) => ({
        url: r.url,
        mimeType: r.mimeType,
        responseMs: r.responseMs,
        transferSizeBytes: r.transferSizeBytes,
      }));
      return {
        summary: `${String(blocking.length)} render-blocking resource(s); showing top ${String(top.length)}.`,
        data: top,
      };
    }
    case "long-tasks": {
      const tasks = report.runs[0]?.longTasks ?? [];
      const sorted = [...tasks].sort((a, b) => b.duration - a.duration).slice(0, limit);
      return {
        summary: `${String(tasks.length)} long task(s) ≥ 50ms; showing top ${String(sorted.length)} by duration.`,
        data: sorted,
      };
    }
    case "third-parties": {
      // Canonical source: the `third-parties` plugin writes an audit (id="third-parties")
      // with details.{items}. (The engine's own hotspots reader uses this same path —
      // hotspots.ts:86.) The old `pluginData["thirdParties"]` key was never populated.
      const details = report.audits.find((a) => a.id === "third-parties")?.details ?? null;
      return {
        summary: details
          ? "Third-party breakdown from the `third-parties` audit (vendors by main-thread time + transfer size)."
          : "No third-party data — measure with plugins=['cwv','axe','third-parties'] to populate.",
        data: details,
      };
    }
    case "opportunities": {
      const opps: ReadonlyArray<Opportunity> = report.opportunities ?? [];
      const top = [...opps]
        .sort((a, b) => (b.wastedMs ?? 0) - (a.wastedMs ?? 0))
        .slice(0, limit);
      return {
        summary: `${String(opps.length)} opportunity/opportunities; showing top ${String(top.length)}.`,
        data: top,
      };
    }
    case "audits": {
      const audits = report.audits;
      const failed = audits.filter((a) => !a.passed);
      const sliced = [...audits]
        .sort((a, b) => Number(a.passed) - Number(b.passed))
        .slice(0, limit);
      return {
        summary: `${String(audits.length)} audit(s), ${String(failed.length)} failed; showing ${String(sliced.length)} (failed first).`,
        data: sliced,
      };
    }
    case "resources": {
      const all = report.runs[0]?.resources ?? [];
      // Shared selector with `perfSummary.network.largestResources` (same sort+slice) so the
      // two surfaces never disagree on the resource ranking.
      const top = selectLargestResources(all, limit)
        .map((r) => ({
          url: r.url,
          mimeType: r.mimeType,
          transferSizeBytes: r.transferSizeBytes,
          responseMs: r.responseMs,
          renderBlocking: r.renderBlocking,
        }));
      return {
        summary: `${String(all.length)} resource(s); showing top ${String(top.length)} by transfer size.`,
        data: top,
      };
    }
    case "frames": {
      const frames = report.frames;
      const nodes = Object.values(frames.nodes).map((n) => ({
        frameId: n.frameId,
        url: n.url,
        isOOPIF: n.isOOPIF,
        isCrossOrigin: n.isCrossOrigin,
      }));
      return {
        summary: `Frame tree: ${String(nodes.length)} frame(s), root=${frames.root}.`,
        data: { root: frames.root, frames: nodes },
      };
    }
    case "full-load-breakdown": {
      const fl = report.fullLoad;
      if (!fl) {
        return {
          summary:
            "Full-Load Time not present (report predates v0.2.0) — rerun `measure` to generate a settle-based Full-Load breakdown.",
          data: null,
        };
      }
      const st = fl.subTimeline;
      const summaryLines = [
        `Full-Load Time: ${fl.fltMs.toFixed(0)}ms — gating: ${fl.gatingPhase}${fl.capped ? " (CAPPED at maxWait)" : ""}`,
      ];
      if (st.lcp != null) summaryLines.push(`  LCP floor: ${st.lcp.toFixed(0)}ms`);
      if (st.loadEventEnd != null) summaryLines.push(`  load event: ${st.loadEventEnd.toFixed(0)}ms`);
      if (st.networkIdleAt != null) summaryLines.push(`  network idle: ${st.networkIdleAt.toFixed(0)}ms`);
      if (st.visuallyCompleteAt != null) summaryLines.push(`  visually complete: ${st.visuallyCompleteAt.toFixed(0)}ms`);
      if (fl.trustReason) summaryLines.push(`  ⚠ ${fl.trustReason}`);
      return {
        summary: summaryLines.join("\n"),
        data: {
          fltMs: fl.fltMs,
          capped: fl.capped,
          gatingPhase: fl.gatingPhase,
          gatingDistribution: fl.gatingDistribution,
          subTimeline: fl.subTimeline,
          ...(fl.aggregated ? { aggregated: fl.aggregated } : {}),
          ...(fl.trustReason ? { trustReason: fl.trustReason } : {}),
        },
      };
    }
    case "hotspots": {
      const hs = report.hotspots;
      if (!hs) {
        return {
          summary:
            "No component hotspots — rerun `measure` with diagnose:true (the component cost table is computed at measure time from a DOM-topology snapshot).",
          data: null,
        };
      }
      const top = [...hs].sort((a, b) => b.costMs - a.costMs).slice(0, limit);
      return {
        summary: `${String(hs.length)} hotspot(s); showing top ${String(top.length)} by cost (ms).`,
        data: top,
      };
    }
    case "remediation": {
      const recs = report.recommendations;
      if (!recs) {
        return {
          summary:
            "No remediations — rerun `measure` with diagnose:true AND rx:true (the remediation engine runs at measure time).",
          data: report.remediationNote ? { recommendations: [], note: report.remediationNote } : null,
        };
      }
      const top = [...recs].sort((a, b) => b.estFltDeltaMs - a.estFltDeltaMs).slice(0, limit);
      const summaryLines = [
        `${String(recs.length)} recommendation(s); showing top ${String(top.length)} by est. FLT impact.`,
      ];
      if (report.remediationNote) summaryLines.push(`⚠ ${report.remediationNote}`);
      return {
        summary: summaryLines.join("\n"),
        data: {
          recommendations: top,
          ...(report.remediationNote ? { note: report.remediationNote } : {}),
        },
      };
    }
    case "perf-summary": {
      const ps = report.perfSummary;
      if (!ps) {
        return { summary: "No perf summary (report predates v0.3.0) — rerun `measure`.", data: null };
      }
      return {
        summary: [
          `Full-Load ${ps.timing.fullLoadMs !== null ? `${ps.timing.fullLoadMs.toFixed(0)}ms` : "n/a"} (gating: ${ps.timing.gatingPhase ?? "n/a"})`,
          `Network: ${String(ps.network.totalRequests)} reqs, ${kb(ps.network.totalTransferBytes)} (1P ${kb(ps.network.firstPartyBytes)} / 3P ${kb(ps.network.thirdPartyBytes)})`,
          `JavaScript: ${kb(ps.javascript.transferBytes)}, main-thread blocking ${String(ps.javascript.mainThreadBlockingMs)}ms`,
          `Errors: ${String(ps.errors.jsErrorCount)} JS · ${String(ps.errors.consoleErrorCount)} console-err · ${String(ps.errors.consoleWarningCount)} warn · ${String(ps.errors.failedRequestCount)} failed-req (${String(ps.errors.firstPartyErrorCount)} first-party)`,
        ].join("\n"),
        data: ps,
      };
    }
    case "network": {
      const n = report.perfSummary?.network;
      if (!n) {
        return { summary: "No network summary (report predates v0.3.0) — rerun `measure`.", data: null };
      }
      return {
        summary: `${String(n.totalRequests)} request(s), ${kb(n.totalTransferBytes)} · ${String(n.renderBlockingCount)} render-blocking · ${String(n.failedRequestCount)} failed · 1P ${kb(n.firstPartyBytes)} / 3P ${kb(n.thirdPartyBytes)}`,
        data: n,
      };
    }
    case "javascript": {
      const j = report.perfSummary?.javascript;
      if (!j) {
        return { summary: "No JavaScript summary (report predates v0.3.0) — rerun `measure`.", data: null };
      }
      return {
        summary: `JS ${kb(j.transferBytes)} (${String(j.requestCount)} file(s)) · exec ${j.executionMs !== null ? `${j.executionMs.toFixed(0)}ms` : "n/a"} · parse/compile ${j.parseCompileMs !== null ? `${j.parseCompileMs.toFixed(0)}ms` : "n/a"} · main-thread blocking ${String(j.mainThreadBlockingMs)}ms`,
        data: j,
      };
    }
    case "errors": {
      const e = report.perfSummary?.errors;
      if (!e) {
        return { summary: "No errors summary (report predates v0.3.0) — rerun `measure`.", data: null };
      }
      return {
        summary: `${String(e.jsErrorCount)} JS error(s) · ${String(e.consoleErrorCount)} console error(s) · ${String(e.consoleWarningCount)} warning(s) · ${String(e.failedRequestCount)} failed request(s) (${String(e.firstPartyErrorCount)} first-party)`,
        data: e,
      };
    }
  }
}

/** Format bytes as a compact KB/MB string for insight summaries. */
function kb(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${String(bytes)} B`;
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export function buildPromptMessages(
  name: string,
  args: Record<string, string | undefined>,
): PromptMessage[] {
  const reportPath = args["reportPath"] ?? "<reportPath>";
  const baseline = args["baseline"] ?? "<baseline>";
  const candidate = args["candidate"] ?? "<candidate>";
  const budget = args["budget"] ?? "{}";
  const url = args["url"] ?? "<url>";

  switch (name) {
    case "diagnose_report":
      return [
        msg(
          "user",
          [
            `Diagnose the OhMyPerf report at \`${reportPath}\`.`,
            "",
            "Use these MCP tools in order:",
            "1. `analyze_report` with insightName=\"lcp-breakdown\" → state the LCP verdict (good/needs-improvement/poor: <2.5s/<4s/≥4s).",
            "2. `analyze_report` with insightName=\"opportunities\" → list top 3 by wastedMs.",
            "3. `analyze_report` with insightName=\"render-blocking\" → top 5.",
            "4. `analyze_report` with insightName=\"long-tasks\" → tasks > 200ms.",
            "5. `analyze_report` with insightName=\"third-parties\" → top vendors (if plugin enabled).",
            "",
            "Then produce a concise investigation plan: root-cause hypothesis + 3 verification steps.",
          ].join("\n"),
        ),
      ];
    case "compare_runs":
      return [
        msg(
          "user",
          [
            `Compare baseline \`${baseline}\` vs candidate \`${candidate}\`.`,
            "",
            "Steps:",
            "1. Call `diff_resources` (or `diff`) on the two reports.",
            "2. For each regressed metric, call `analyze_report` on both reports for the matching insight (e.g. lcp-breakdown for LCP regression).",
            "3. State the most likely cause based on resource diff, long-task diff, render-blocking diff.",
            "4. Suggest the minimal change that would reverse the regression.",
          ].join("\n"),
        ),
      ];
    case "suggest_fixes":
      return [
        msg(
          "user",
          [
            `For the report at \`${reportPath}\`, propose concrete code-level fixes.`,
            "",
            "Priority order: LCP > INP > CLS > TBT > TTFB.",
            "Use `analyze_report` with insightName=\"opportunities\" and \"render-blocking\" to ground every suggestion in actual data.",
            "",
            "For each fix:",
            "- File/area to change",
            "- Expected metric impact (ms saved)",
            "- Effort (S/M/L)",
            "- Validation step (rerun `measure` with the same URL)",
          ].join("\n"),
        ),
      ];
    case "audit_third_parties":
      return [
        msg(
          "user",
          [
            `Audit third-party impact for the report at \`${reportPath}\`.`,
            "",
            "1. Call `analyze_report` with insightName=\"third-parties\".",
            "2. If the data is null, instruct the user to rerun `measure` with plugins=['cwv','axe','third-parties'].",
            "3. Otherwise, list top vendors by main-thread time AND by transfer size.",
            "4. Flag any vendor that blocks LCP (cross-reference with render-blocking insight).",
            "5. Recommend defer/async/remove for each, with rationale.",
          ].join("\n"),
        ),
      ];
    case "check_budget":
      return [
        msg(
          "user",
          [
            `Check the report at \`${reportPath}\` against this performance budget:`,
            "",
            `\`\`\`json\n${budget}\n\`\`\``,
            "",
            "If the budget arg is `{}` or missing, use the defaults: { lcp: 2500, inp: 200, cls: 0.1, tbt: 200 }.",
            "",
            "1. Use `analyze_report` with insightName=\"lcp-breakdown\" (and similar for other metrics if needed).",
            "2. For each metric, compare median against the budget. Report pass/fail + Δ (observed − budget).",
            "3. End with a verdict line: 'PASS' or 'FAIL (N metric(s) over budget)'.",
          ].join("\n"),
        ),
      ];
    case "investigate_regression":
      return [
        msg(
          "user",
          [
            `Investigate the regression between baseline \`${baseline}\` and candidate \`${candidate}\`.`,
            "",
            "Steps:",
            "1. Call `find_regression_cause` with both reports — it returns ranked hypotheses with evidence (new render-blocking, grown resources, new long-tasks, new third-parties).",
            "2. Take the top-1 hypothesis. State its metric, relative delta, and the strongest piece of evidence.",
            "3. For the regressed metric, call `analyze_report` on the CANDIDATE with the matching insightName (e.g. lcp-breakdown for LCP, long-tasks for INP/TBT, opportunities for general guidance).",
            "4. Cross-check whether the analyze_report data confirms or weakens the hypothesis.",
            "5. Produce a final root-cause narrative: (a) the change, (b) why it impacts the metric, (c) the smallest reversal/mitigation.",
          ].join("\n"),
        ),
      ];
    case "monitor_trend":
      return [
        msg(
          "user",
          [
            `Monitor the performance trend for \`${url}\`.`,
            "",
            "Steps:",
            "1. Call `track_url` with the URL — it measures + appends to the time-series log and returns per-metric trend verdicts.",
            "2. For each metric, state direction (improving/stable/regressing), confidence, and Δ vs the baseline window.",
            "3. If any metric is 'regressing' with confidence 'high' or 'medium' AND there are ≥ 2 historical points, escalate: identify the two most-recent saved reports for this URL via `list_runs`, then call `find_regression_cause` on them.",
            "4. If trend is stable/improving, end with: 'No action needed — N points monitored, trend stable.'",
          ].join("\n"),
        ),
      ];
    case "measure_and_diagnose":
      return [
        msg(
          "user",
          [
            `Measure and diagnose the live URL \`${url}\` end-to-end (settle-based Full-Load, not just LCP).`,
            "",
            "Use these MCP tools in order:",
            "1. `measure` with { url, diagnose: true, rx: true, mode: \"ci-stable\" } → persists a report with fullLoad, hotspots, and recommendations.",
            "2. `get_servability` on the saved report → if classification != 'real-page' (bot-challenge / error page), STOP and report that the numbers are NOT representative of real users.",
            "3. `get_trust_score` → if overall == 'unreliable', warn the diagnosis is low-confidence and recommend more runs (mode='ci-stable').",
            "4. `analyze_report` with insightName=\"full-load-breakdown\" → state Full-Load Time (ms), the gating phase, and the gating distribution. This is the settle-based load time (network + DOM + main-thread + paint all quiet), NOT LCP.",
            "5. `analyze_report` with insightName=\"hotspots\" → list the top component/region costs and their gating phase.",
            "6. `analyze_report` with insightName=\"remediation\" → list the top ranked fixes (target, est. FLT impact, confidence, whether each is on the gating path).",
            "",
            "Then produce a diagnosis: (a) what gates Full-Load, (b) the 1-3 highest-leverage fixes (prefer gating + high-confidence + first-party), (c) the concrete strategy for each (lazy-load / virtualize / viewport-only render / unblock the main thread).",
          ].join("\n"),
        ),
      ];
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

function msg(role: "user" | "assistant", text: string): PromptMessage {
  return { role, content: { type: "text", text } };
}

async function measure(input: MeasureInput): Promise<Report> {
  const { driver, adapter } = createPlaywrightAdapter({
    url: input.url,
    kind: "chromium",
    ...(input.browserPath ? { executablePath: input.browserPath } : {}),
  });
  const plugins = (input.plugins ?? []).map((id) => {
    if (id === "cwv") return cwvPlugin();
    if (id === "axe") return axePlugin();
    if (id === "third-parties") return thirdPartiesPlugin();
    return customMetricExamplePlugin();
  });
  return await runEngine({
    opts: {
      url: input.url,
      runs: input.runs ?? 3,
      mode: input.mode ?? "real",
      plugins,
      ...(input.collectTrace ? { collectTrace: true } : {}),
      ...(input.diagnose ? { diagnose: true } : {}),
      ...(input.rx ? { rx: true } : {}),
      ...(input.fullLoad ? { fullLoad: input.fullLoad } : {}),
    },
    driver,
    adapter,
  });
}

async function loadReport(path: string): Promise<Report> {
  const body = await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(body) as Report;
  if (parsed.schemaVersion !== "1.0.0") {
    throw new Error(`Unsupported schemaVersion: ${String(parsed.schemaVersion)}`);
  }
  return parsed;
}

async function saveReport(dir: string, report: Report): Promise<string> {
  await mkdir(dir, { recursive: true });
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${report.meta.measurementId.slice(0, 8)}.json`;
  const path = join(dir, fileName);
  const result = await writeJsonReport(report, dirname(path), { fileName });
  return result.path;
}

interface ReportFileInfo {
  name: string;
  mtimeMs: number;
  sizeBytes: number;
}

async function listReportFiles(dir: string): Promise<ReportFileInfo[]> {
  try {
    const names = await readdir(dir);
    const stats: ReportFileInfo[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const s = await stat(join(dir, name));
      stats.push({ name, mtimeMs: s.mtimeMs, sizeBytes: s.size });
    }
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return stats;
  } catch {
    return [];
  }
}

async function trimReports(dir: string, max: number): Promise<void> {
  const files = await listReportFiles(dir);
  if (files.length <= max) return;
  const { unlink } = await import("node:fs/promises");
  for (const f of files.slice(max)) {
    await unlink(join(dir, f.name)).catch(() => undefined);
  }
}

export function summarize(report: Report, savedPath: string): string {
  const lines: string[] = [];
  lines.push(`Measured ${report.meta.url}`);
  lines.push(`Saved to: ${savedPath}`);
  lines.push(
    `Mode: ${report.meta.mode}; runs: ${String(report.meta.runs)}; duration: ${String(report.meta.durationMs)}ms; measurementId: ${report.meta.measurementId}`,
  );
  lines.push(
    `Browser: ${report.meta.browser.name} ${report.meta.browser.version} (${report.meta.browser.source})`,
  );
  if (report.meta.calibration) {
    lines.push(
      `Calibration: throttle ${String(report.meta.calibration.throttleRate)}x, network ${report.meta.calibration.networkProfile}`,
    );
  }
  if (report.meta.unstable) {
    lines.push("⚠ Unstable run (CoV > 20% on at least one CWV).");
  }
  if (report.meta.servability && report.meta.servability.classification !== "real-page") {
    lines.push(`⚠ Servability: ${report.meta.servability.classification}`);
    if (report.meta.servability.recommendedAction) {
      lines.push(`   → ${report.meta.servability.recommendedAction}`);
    }
  }
  if (report.trustScore) {
    lines.push(`Trust: ${report.trustScore.overall} (${report.trustScore.reasons.slice(0, 4).join(", ")})`);
    if (report.trustScore.recommendedAction) {
      lines.push(`   → ${report.trustScore.recommendedAction}`);
    }
  }
  for (const [name, agg] of Object.entries(report.aggregated)) {
    const digits = name === "cls" ? 3 : 1;
    lines.push(
      `  ${name.toUpperCase().padEnd(5)} median=${agg.median.toFixed(digits)} cov=${(agg.cov * 100).toFixed(1)}% n=${String(agg.runs)}`,
    );
  }
  if (report.fullLoad) {
    const fl = report.fullLoad;
    lines.push(
      `Full-Load: ${fl.fltMs.toFixed(0)}ms (gating: ${fl.gatingPhase}${fl.capped ? ", capped" : ""}) — settle-based, not LCP`,
    );
  }
  if (report.perfSummary) {
    const ps = report.perfSummary;
    lines.push(
      `Network: ${String(ps.network.totalRequests)} reqs, ${kb(ps.network.totalTransferBytes)} (JS ${kb(ps.javascript.transferBytes)}, ${String(ps.network.renderBlockingCount)} render-blocking, ${String(ps.network.failedRequestCount)} failed)`,
    );
    lines.push(
      `Errors: ${String(ps.errors.jsErrorCount)} JS · ${String(ps.errors.consoleErrorCount)} console-err · ${String(ps.errors.consoleWarningCount)} warn (${String(ps.errors.firstPartyErrorCount)} first-party)`,
    );
  }
  if (report.hotspots && report.hotspots.length > 0) {
    const top = [...report.hotspots].sort((a, b) => b.costMs - a.costMs).slice(0, 3);
    lines.push(`Hotspots: ${String(report.hotspots.length)} (top ${String(top.length)} by cost):`);
    for (const h of top) {
      lines.push(`  • [${h.cause}] ${h.label} — ${h.costMs.toFixed(0)}ms (gating: ${h.gatingPhase})`);
    }
  }
  if (report.recommendations && report.recommendations.length > 0) {
    const top = [...report.recommendations].sort((a, b) => b.estFltDeltaMs - a.estFltDeltaMs).slice(0, 3);
    lines.push(`Recommendations: ${String(report.recommendations.length)} (top ${String(top.length)} by est. FLT impact):`);
    for (const r of top) {
      lines.push(`  • [${r.rule}] ${r.title} — ~${r.estFltDeltaMs.toFixed(0)}ms${r.gating ? " (gating)" : ""}, ${r.confidence}`);
    }
  }
  if (report.fixPlan && report.fixPlan.length > 0) {
    lines.push(`Fix plan: ${String(report.fixPlan.length)} ranked patches (top 3 shown):`);
    for (const entry of report.fixPlan.slice(0, 3)) {
      const impact = `~${entry.expectedImpactMs.toFixed(0)}ms ${entry.expectedMetric}`;
      lines.push(`  #${String(entry.rank)} [${entry.archetype}] ${entry.target.url.slice(0, 60)} (${impact}, ${entry.confidence}, ${entry.applicability})`);
    }
  }
  if (report.audits.length > 0) {
    lines.push(`Audits: ${String(report.audits.length)}`);
    for (const a of report.audits) {
      lines.push(`  [${a.passed ? "PASS" : "FAIL"}] ${a.id} — ${a.title}`);
    }
  }
  return lines.join("\n");
}

function formatTrendSummary(
  point: TimeSeriesPoint,
  history: readonly TimeSeriesPoint[],
  trends: readonly TrendVerdict[],
  savedPath: string,
): string {
  const lines: string[] = [];
  lines.push(`Tracked ${point.url}`);
  lines.push(`History: ${String(history.length)} point(s) (this run: ${point.at})`);
  lines.push("");
  lines.push("Trend per metric:");
  for (const t of trends) {
    if (t.direction === "insufficient-data") {
      lines.push(`  ${t.metric.toUpperCase().padEnd(5)} insufficient-data (n=${String(t.n)})`);
      continue;
    }
    const pct = (t.relativeChange * 100).toFixed(1);
    const sign = t.relativeChange > 0 ? "+" : "";
    const tag =
      t.direction === "regressing" ? "❌" : t.direction === "improving" ? "✅" : "·";
    lines.push(
      `  ${tag} ${t.metric.toUpperCase().padEnd(5)} ${t.direction.padEnd(11)} ${sign}${pct}% (baseline=${t.baselineMedian.toFixed(1)}, recent=${t.recentMedian.toFixed(1)}, n=${String(t.n)}, confidence=${t.confidence})`,
    );
  }
  lines.push(`Saved: ${savedPath}`);
  return lines.join("\n");
}

interface CompactCause {
  verdict: RegressionCauseReport["verdict"];
  hypotheses: ReadonlyArray<{
    rank: number;
    metric: string;
    relativeDelta: number;
    likelyCauses: ReadonlyArray<string>;
    evidence: {
      newRenderBlockingCount: number;
      grownResourcesCount: number;
      newLongTasksCount: number;
      newThirdParties: ReadonlyArray<string>;
      topNewRenderBlocking: ReadonlyArray<{ url: string; mimeType: string; transferBytesDelta: number }>;
      topGrownResources: ReadonlyArray<{ url: string; transferBytesDelta: number; responseMsDelta: number }>;
      topNewLongTasks: ReadonlyArray<{ attribution: string; url?: string; durationMsDelta: number }>;
    };
  }>;
}

function toCompactCause(analysis: RegressionCauseReport): CompactCause {
  return {
    verdict: analysis.verdict,
    hypotheses: analysis.hypotheses.map((h) => ({
      rank: h.rank,
      metric: h.metric,
      relativeDelta: h.relativeDelta,
      likelyCauses: h.likelyCauses,
      evidence: {
        newRenderBlockingCount: h.evidence.newRenderBlocking.length,
        grownResourcesCount: h.evidence.grownResources.length,
        newLongTasksCount: h.evidence.newLongTasks.length,
        newThirdParties: h.evidence.newThirdParties,
        topNewRenderBlocking: h.evidence.newRenderBlocking.slice(0, 5).map((r) => ({
          url: r.url,
          mimeType: r.mimeType,
          transferBytesDelta: r.transferBytesDelta,
        })),
        topGrownResources: h.evidence.grownResources.slice(0, 5).map((r) => ({
          url: r.url,
          transferBytesDelta: r.transferBytesDelta,
          responseMsDelta: r.responseMsDelta,
        })),
        topNewLongTasks: h.evidence.newLongTasks.slice(0, 5).map((t) => ({
          attribution: t.attribution,
          ...(t.url !== undefined ? { url: t.url } : {}),
          durationMsDelta: t.durationMsDelta,
        })),
      },
    })),
  };
}

const DEFAULT_BUDGET: Readonly<Record<string, number>> = {
  lcp: 2500,
  inp: 200,
  cls: 0.1,
  tbt: 200,
  fcp: 1800,
  ttfb: 800,
};

function parseBudget(raw: unknown): Record<string, number> {
  const out: Record<string, number> = { ...DEFAULT_BUDGET };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k.toLowerCase()] = v;
    }
  }
  return out;
}

export interface BudgetMetricResult {
  metric: string;
  observed: number;
  threshold: number;
  delta: number;
  relativeDelta: number;
  passed: boolean;
}

export interface BudgetVerdict {
  status: "PASS" | "FAIL";
  /** 0 = pass, 12 = budget exceeded, 13 = gated (trust/servability — not safe to gate CI). */
  exitCode: 0 | 12 | 13;
  /** True when the measurement is not safe to gate CI (bot-challenge/error page or unreliable). */
  gated: boolean;
  gateReason?: string;
  url: string;
  mode: string;
  unstable: boolean;
  metrics: ReadonlyArray<BudgetMetricResult>;
  failedCount: number;
}

/** Determine the trust/servability gate reason, if any. servability != real-page wins over trust. */
function budgetGateReason(report: Report): string | undefined {
  const servability = report.meta.servability?.classification;
  if (servability && servability !== "real-page") return servability;
  if (report.trustScore?.overall === "unreliable") return "unreliable";
  return undefined;
}

export function evaluateBudget(
  report: Report,
  budget: Record<string, number>,
  force = false,
): BudgetVerdict {
  const results: BudgetMetricResult[] = [];
  for (const [metric, threshold] of Object.entries(budget)) {
    const agg = report.aggregated[metric];
    if (!agg) continue;
    const observed = agg.median;
    const delta = observed - threshold;
    const relativeDelta = threshold === 0 ? 0 : delta / threshold;
    results.push({
      metric,
      observed,
      threshold,
      delta,
      relativeDelta,
      passed: observed <= threshold,
    });
  }
  const failedCount = results.filter((r) => !r.passed).length;
  const gateReason = force ? undefined : budgetGateReason(report);
  const gated = gateReason !== undefined;
  // Gating takes precedence over the metric verdict: a bot-challenge/error/unreliable page's
  // budget pass/fail is meaningless, so signal exitCode 13 distinct from 12 (budget exceeded).
  const exitCode: 0 | 12 | 13 = gated ? 13 : failedCount === 0 ? 0 : 12;
  return {
    status: failedCount === 0 ? "PASS" : "FAIL",
    exitCode,
    gated,
    ...(gateReason ? { gateReason } : {}),
    url: report.meta.url,
    mode: report.meta.mode,
    unstable: Boolean(report.meta.unstable),
    metrics: results,
    failedCount,
  };
}

function formatBudgetVerdict(verdict: BudgetVerdict, savedPath: string): string {
  const lines: string[] = [];
  lines.push(`Budget check for ${verdict.url} (mode=${verdict.mode})`);
  lines.push(`Status: ${verdict.status} · exitCode=${String(verdict.exitCode)}${verdict.gated ? " · ⛔ GATED" : ""}`);
  if (verdict.gated) {
    lines.push(
      `⛔ Gated (exitCode 13): servability/trust = ${verdict.gateReason} — this measurement must NOT gate CI; the budget verdict below is not representative. Pass force:true to override.`,
    );
  }
  if (verdict.unstable) lines.push("⚠ Run was unstable (CoV > 20% on at least one CWV).");
  lines.push("");
  for (const m of verdict.metrics) {
    const digits = m.metric === "cls" ? 3 : 1;
    const tag = m.passed ? "✅" : "❌";
    const pct = (m.relativeDelta * 100).toFixed(1);
    const sign = m.delta >= 0 ? "+" : "";
    lines.push(
      `  ${tag} ${m.metric.toUpperCase().padEnd(5)} observed=${m.observed.toFixed(digits)} ≤ budget=${m.threshold.toFixed(digits)} · Δ=${sign}${m.delta.toFixed(digits)} (${sign}${pct}%)`,
    );
  }
  if (verdict.failedCount > 0) {
    lines.push("");
    lines.push(`Verdict: FAIL — ${String(verdict.failedCount)} metric(s) over budget.`);
  } else {
    lines.push("");
    lines.push("Verdict: PASS — all metrics within budget.");
  }
  lines.push(`Saved: ${savedPath}`);
  return lines.join("\n");
}

export async function ensureReportsDir(dir?: string): Promise<string> {
  const target = resolve(dir ?? DEFAULT_REPORTS_DIR);
  await mkdir(target, { recursive: true });
  return target;
}

export async function readReportFromDisk(path: string): Promise<Report> {
  return loadReport(path);
}

export async function writeReportToDisk(path: string, report: Report): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
}
