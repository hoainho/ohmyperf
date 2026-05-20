import type { SourceLocation } from "./types.js";

const SOURCE_MAPPING_RE = /\/\/[@#]\s*sourceMappingURL\s*=\s*([^\s'"]+)/;

export interface SourceMapResolverOptions {
  readonly repoRoot?: string;
  readonly enabled?: boolean;
}

export function resolveSourceMappingUrl(scriptBody: string): string | undefined {
  const match = SOURCE_MAPPING_RE.exec(scriptBody);
  return match?.[1];
}

export function buildSourceLocation(
  scriptUrl: string,
  scriptBody?: string,
): SourceLocation | undefined {
  if (!scriptUrl) return undefined;

  let parsed: URL | null = null;
  try {
    parsed = new URL(scriptUrl);
  } catch {
    return undefined;
  }
  const pathname = parsed.pathname;
  const file = pathname.split("/").pop() ?? pathname;

  const sourceMapUrl = scriptBody ? resolveSourceMappingUrl(scriptBody) : undefined;

  return {
    file,
    resolved: false,
    ...(sourceMapUrl ? { sourceMapUrl } : {}),
  };
}

export function buildSourceLocationFromUrl(
  url: string,
  opts: SourceMapResolverOptions = {},
): SourceLocation | undefined {
  if (opts.enabled === false) return undefined;
  return buildSourceLocation(url);
}
