import * as Sentry from '@sentry/react';

let initialized = false;

// Reads import.meta.env directly (not the validated `env` object) so an empty
// DSN is statically dead-eliminated at build time — zero Sentry bytes ship
// until VITE_SENTRY_DSN is set. Once set, the SDK lands in vendor-sentry chunk.
export function initSentry(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || typeof dsn !== 'string' || dsn.length === 0) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_SHA,
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [Sentry.breadcrumbsIntegration(), Sentry.linkedErrorsIntegration()],
  });
  initialized = true;
}

export function setSentryUser(
  user: {
    id: string;
    email: string;
    companyId: string | null;
    role: string;
  } | null,
): void {
  if (!initialized) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id, email: user.email });
  Sentry.setTag('company_id', user.companyId ?? 'none');
  Sentry.setTag('role', user.role);
}

export function captureReactError(error: Error, info: { componentStack: string }): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    scope.setContext('react', { componentStack: info.componentStack });
    Sentry.captureException(error);
  });
}
