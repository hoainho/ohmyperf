import type { OriginClass } from "../types.js";

interface OriginInfo {
  readonly host: string;
  readonly registrableDomain: string;
}

function parseUrlSafe(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function registrableDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (!last || !secondLast) return host;
  const SECOND_LEVEL_TLDS = new Set([
    "co",
    "com",
    "org",
    "net",
    "gov",
    "edu",
    "ac",
  ]);
  if (parts.length >= 3 && SECOND_LEVEL_TLDS.has(secondLast)) {
    const thirdLast = parts[parts.length - 3];
    if (thirdLast) return `${thirdLast}.${secondLast}.${last}`;
  }
  return `${secondLast}.${last}`;
}

export function parseOriginInfo(url: string): OriginInfo | null {
  const u = parseUrlSafe(url);
  if (!u) return null;
  return { host: u.host, registrableDomain: registrableDomain(u.host) };
}

function hostMatchesOrgPattern(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (p === "") return false;
  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === p || host.endsWith(`.${p}`);
}

export function classifyOrigin(
  resourceUrl: string,
  primaryOrigin: OriginInfo | null,
  orgDomains?: ReadonlyArray<string>,
): OriginClass {
  if (!primaryOrigin) return "unknown";
  const r = parseOriginInfo(resourceUrl);
  if (!r) return "unknown";
  if (r.host === primaryOrigin.host) return "same-origin";
  if (r.registrableDomain === primaryOrigin.registrableDomain) return "same-site";
  if (orgDomains && orgDomains.length > 0) {
    const host = r.host.toLowerCase();
    for (const pat of orgDomains) {
      if (hostMatchesOrgPattern(host, pat)) return "same-org";
    }
  }
  return "cross-site";
}

export function resolveOrgDomains(
  fromOpts: ReadonlyArray<string> | undefined,
  env: NodeJS.ProcessEnv,
): ReadonlyArray<string> | undefined {
  if (fromOpts && fromOpts.length > 0) return fromOpts;
  const raw = env["OHMYPERF_ORG_DOMAINS"];
  if (!raw) return undefined;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}
