import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_EXTENSION_ID: z
    .string()
    .regex(/^[a-p]{32}$/i, 'Must be a 32-char Chrome extension ID')
    .optional(),
  NEXT_PUBLIC_RUNNER_PORT: z.string().regex(/^\d{2,5}$/).default('5174'),
});

function readRawEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.NEXT_PUBLIC_EXTENSION_ID) {
        out.NEXT_PUBLIC_EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID;
      }
      if (process.env.NEXT_PUBLIC_RUNNER_PORT) {
        out.NEXT_PUBLIC_RUNNER_PORT = process.env.NEXT_PUBLIC_RUNNER_PORT;
      }
    }
  } catch {
    /* process undefined in browser if DefinePlugin substitution missed — fall through */
  }
  return out;
}

export const env = envSchema.parse(readRawEnv());
