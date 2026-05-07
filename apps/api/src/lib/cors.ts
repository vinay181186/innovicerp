import { env } from './env';
import { logger } from './logger';

export type CorsOrigin = boolean | string[];

type ResolveOpts = {
  allowedOrigins: readonly string[];
  nodeEnv: 'development' | 'test' | 'production';
  log?: { warn: (obj: object, msg: string) => void };
};

// Resolves the CORS `origin` config from ALLOWED_ORIGINS + NODE_ENV.
// - Explicit list  → use the list (preferred for prod and staging)
// - Empty + dev    → permissive (`true`) with a warning so the gap is visible
// - Empty + prod   → throws; production must declare its allowed origins
export function resolveCorsOriginFrom(opts: ResolveOpts): CorsOrigin {
  if (opts.allowedOrigins.length > 0) return [...opts.allowedOrigins];

  if (opts.nodeEnv === 'production') {
    throw new Error(
      'ALLOWED_ORIGINS is required in production. Set it to a comma-separated list of allowed origins (e.g. "https://erp.example.com").',
    );
  }

  opts.log?.warn(
    { env: opts.nodeEnv },
    'ALLOWED_ORIGINS unset — falling back to permissive CORS for dev/test. Set ALLOWED_ORIGINS before deploying.',
  );
  return true;
}

export function resolveCorsOrigin(): CorsOrigin {
  return resolveCorsOriginFrom({
    allowedOrigins: env.ALLOWED_ORIGINS,
    nodeEnv: env.NODE_ENV,
    log: logger,
  });
}
