import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  // PORT is the platform convention (Railway, Fly, Heroku all inject it). API_PORT
  // is the local-dev convention from .env.local. server.ts prefers PORT when set.
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_POOLED: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_JWT_SECRET: z.string().optional(),
  GIT_SHA: z.string().optional(),
  SENTRY_DSN: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Comma-separated list of allowed CORS origins (e.g.
  // "https://erp.innovic.in,https://erp-staging.innovic.in"). Empty list +
  // NODE_ENV=production will refuse to start; empty list + dev/test falls
  // back to permissive `origin: true` with a warning.
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    ),
  // Phase 7 alerts push delivery (T-041d Phase B, ADR-024). All four flags
  // optional; api boots without them. When ALERTS_PUSH_ENABLED=true:
  //   - REDIS_URL is required (worker schedules + dispatches via BullMQ)
  //   - RESEND_API_KEY is required (digest emails go out via Resend)
  //   - ALERTS_FROM_EMAIL is the sender (e.g. "alerts@erp.innovic.in")
  // Without ALERTS_PUSH_ENABLED, the queue.ts + email.ts wrappers no-op
  // (log-only). The eval engine + dashboard work the same regardless.
  REDIS_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  ALERTS_PUSH_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  ALERTS_FROM_EMAIL: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
