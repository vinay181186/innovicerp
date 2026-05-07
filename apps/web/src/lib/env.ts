import { z } from 'zod';

const envSchema = z.object({
  VITE_API_URL: z.string().url(),
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
  // VITE_SENTRY_DSN is intentionally read directly via import.meta.env in
  // lib/sentry.ts — Vite tree-shakes the SDK out of the bundle when the DSN
  // is empty at build time, which it should be until an account is provisioned.
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  console.error('Invalid VITE_* env vars:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid env. See console.');
}

export const env = parsed.data;
