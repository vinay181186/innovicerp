import * as Sentry from '@sentry/node';
import { env } from './env';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.GIT_SHA,
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [],
  });
  initialized = true;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

export type ErrorContext = {
  user?: { id: string; email: string; companyId: string | null; role: string } | undefined;
  requestId?: string | undefined;
  method?: string | undefined;
  url?: string | undefined;
};

export function captureUnhandledError(err: unknown, ctx: ErrorContext = {}): void {
  if (!initialized) return;

  Sentry.withScope((scope) => {
    if (ctx.user) {
      scope.setUser({ id: ctx.user.id, email: ctx.user.email });
      scope.setTag('company_id', ctx.user.companyId ?? 'none');
      scope.setTag('role', ctx.user.role);
    }
    if (ctx.requestId) scope.setTag('request_id', ctx.requestId);
    if (ctx.method) scope.setTag('http.method', ctx.method);
    if (ctx.url) scope.setTag('http.url', ctx.url);
    Sentry.captureException(err);
  });
}
