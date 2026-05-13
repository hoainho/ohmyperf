import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_EXTENSION_ID: z
    .string()
    .regex(/^[a-p]{32}$/i, 'Must be a 32-char Chrome extension ID')
    .optional(),
  NEXT_PUBLIC_RUNNER_PORT: z.string().regex(/^\d{2,5}$/).default('5174'),
});

export const env = envSchema.parse({
  NEXT_PUBLIC_EXTENSION_ID: process.env['NEXT_PUBLIC_EXTENSION_ID'],
  NEXT_PUBLIC_RUNNER_PORT: process.env['NEXT_PUBLIC_RUNNER_PORT'],
});
