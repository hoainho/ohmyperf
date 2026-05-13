import { z } from 'zod';

const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^127\./,
  /^fc/i,
  /^fd/i,
  /^fe80/i,
];

export type PrivateHostHint =
  | { kind: 'none' }
  | { kind: 'loopback'; host: string }
  | { kind: 'private'; host: string };

export function detectPrivateHost(rawUrl: string): PrivateHostHint {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (PRIVATE_HOSTS.has(host)) return { kind: 'loopback', host };
    if (PRIVATE_RANGES.some((rx) => rx.test(host))) return { kind: 'private', host };
    return { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
}

export const urlFormSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Enter a URL to measure')
    .max(2048, 'URL too long')
    .refine(
      (v) => {
        try {
          const u = new URL(v);
          return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Must be a valid http(s) URL' },
    ),
});

export type UrlFormValues = z.infer<typeof urlFormSchema>;
