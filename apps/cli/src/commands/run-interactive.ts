import * as p from "@clack/prompts";
import pc from "picocolors";
import { BRAND_IDS, BRAND_MANIFEST, type BrandId } from "@ohmyperf/design-tokens";

export interface InteractiveAnswers {
  readonly url: string;
  readonly style: BrandId;
  readonly mode: "real" | "ci-stable";
  readonly runs: number;
  readonly format: string;
  readonly browserPath: string | undefined;
  readonly output: string;
  readonly plugins: string;
  readonly collectTrace: boolean;
}

const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/;

export async function promptInteractive(initial: {
  url?: string;
  style?: BrandId;
  mode?: string;
  runs?: number;
  format?: string;
  browserPath?: string;
  output?: string;
}): Promise<InteractiveAnswers | null> {
  p.intro(`${pc.bgCyan(pc.black(" OhMyPerf "))} ${pc.dim("interactive run")}`);

  const url = await p.text({
    message: "URL to measure",
    placeholder: "https://example.com",
    ...(initial.url ? { initialValue: initial.url } : {}),
    validate(value) {
      if (!value) return "URL is required";
      if (!HTTP_URL_PATTERN.test(value)) return "Must be a valid http(s) URL";
      return undefined;
    },
  });
  if (p.isCancel(url)) {
    p.cancel("Cancelled.");
    return null;
  }

  const style = await p.select({
    message: "Visual style",
    initialValue: initial.style ?? "calibre",
    options: BRAND_IDS.map((id) => {
      const m = BRAND_MANIFEST[id];
      const themeHint = `${m.supportsLight ? "light" : ""}${m.supportsLight && m.supportsDark ? "+" : ""}${m.supportsDark ? "dark" : ""}`;
      return {
        value: id,
        label: m.displayName,
        hint: `${themeHint} · preferred ${m.preferredTheme} · ${m.description.slice(0, 60)}${m.description.length > 60 ? "…" : ""}`,
      };
    }),
  });
  if (p.isCancel(style)) {
    p.cancel("Cancelled.");
    return null;
  }

  const mode = await p.select({
    message: "Measurement mode",
    initialValue: (initial.mode as "real" | "ci-stable") ?? "real",
    options: [
      {
        value: "real",
        label: "real",
        hint: "No throttling. Fast feedback for dev loop.",
      },
      {
        value: "ci-stable",
        label: "ci-stable",
        hint: "Pre-flight CPU calibration + Fast 4G throttle. Reproducible for CI.",
      },
    ],
  });
  if (p.isCancel(mode)) {
    p.cancel("Cancelled.");
    return null;
  }

  const runsRaw = await p.text({
    message: "Number of runs (1-30)",
    placeholder: "3",
    initialValue: String(initial.runs ?? 3),
    validate(value) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 30) return "Must be an integer 1-30";
      return undefined;
    },
  });
  if (p.isCancel(runsRaw)) {
    p.cancel("Cancelled.");
    return null;
  }
  const runs = Number(runsRaw);

  const formats = await p.multiselect({
    message: "Output formats",
    initialValues: (initial.format ?? "json,html,deck").split(",").map((s) => s.trim()),
    required: true,
    options: [
      { value: "json", label: "json", hint: "machine-readable Report (always recommended)" },
      { value: "html", label: "html", hint: "single-file interactive viewer" },
      { value: "deck", label: "deck", hint: "multi-slide presentation deck" },
      { value: "markdown", label: "markdown", hint: "PR-comment friendly summary" },
      { value: "junit", label: "junit", hint: "CI test runner XML" },
      { value: "csv", label: "csv", hint: "spreadsheet-friendly metrics" },
    ],
  });
  if (p.isCancel(formats)) {
    p.cancel("Cancelled.");
    return null;
  }

  const plugins = await p.select({
    message: "Plugin set",
    initialValue: "all",
    options: [
      { value: "all", label: "all", hint: "cwv + axe + custom-metric-example" },
      { value: "cwv+axe", label: "cwv+axe", hint: "skip the example plugin" },
      { value: "cwv", label: "cwv", hint: "Core Web Vitals only (fastest)" },
      { value: "none", label: "none", hint: "no plugins" },
    ],
  });
  if (p.isCancel(plugins)) {
    p.cancel("Cancelled.");
    return null;
  }

  const browserPath = await p.text({
    message: "Chromium binary path (optional)",
    placeholder: "leave blank to use Playwright bundled",
    initialValue: initial.browserPath ?? "",
  });
  if (p.isCancel(browserPath)) {
    p.cancel("Cancelled.");
    return null;
  }

  const collectTrace = await p.confirm({
    message: "Collect trace (advanced)?",
    initialValue: false,
  });
  if (p.isCancel(collectTrace)) {
    p.cancel("Cancelled.");
    return null;
  }

  const output = await p.text({
    message: "Output directory",
    placeholder: "./ohmyperf-out",
    initialValue: initial.output ?? "./ohmyperf-out",
  });
  if (p.isCancel(output)) {
    p.cancel("Cancelled.");
    return null;
  }

  const summaryLines: string[] = [
    `${pc.dim("URL:")}      ${pc.cyan(url as string)}`,
    `${pc.dim("Style:")}    ${pc.cyan(BRAND_MANIFEST[style as BrandId].displayName)} ${pc.dim(`(${String(style)})`)}`,
    `${pc.dim("Mode:")}     ${pc.cyan(mode as string)}`,
    `${pc.dim("Runs:")}     ${pc.cyan(String(runs))}`,
    `${pc.dim("Formats:")}  ${pc.cyan((formats as string[]).join(", "))}`,
    `${pc.dim("Plugins:")}  ${pc.cyan(plugins as string)}`,
    `${pc.dim("Output:")}   ${pc.cyan(output as string)}`,
  ];
  if (browserPath) summaryLines.push(`${pc.dim("Browser:")}  ${pc.cyan(browserPath as string)}`);
  if (collectTrace) summaryLines.push(`${pc.dim("Trace:")}    ${pc.cyan("enabled")}`);

  p.note(summaryLines.join("\n"), "Run summary");

  const confirmed = await p.confirm({
    message: "Start measurement?",
    initialValue: true,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled before measurement started.");
    return null;
  }

  return {
    url: url as string,
    style: style as BrandId,
    mode: (mode as string) === "ci-stable" ? "ci-stable" : "real",
    runs,
    format: (formats as string[]).join(","),
    browserPath: typeof browserPath === "string" && browserPath.length > 0 ? browserPath : undefined,
    output: output as string,
    plugins: plugins as string,
    collectTrace: Boolean(collectTrace),
  };
}

export function isInteractiveContext(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
