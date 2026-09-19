import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../lib/env';
import { AuthenticationError } from '../../lib/errors';
import { forgotPasswordInputSchema } from './schema';
import type { ForgotPasswordResponse, PasswordChangedResponse } from './schema';
import * as service from './service';

const DEV_ORIGIN = 'http://localhost:5173';

/** The web origin the reset link should redirect to. Only an Origin header
 *  that is on the CORS allowlist is trusted; anything else falls back to the
 *  first allowed origin (or the Vite dev origin when the list is empty), so
 *  an arbitrary Origin can never be echoed into the emailed link. */
export function resolveRedirectOrigin(
  originHeader: string | undefined,
  allowed: readonly string[] = env.ALLOWED_ORIGINS,
): string {
  if (originHeader && allowed.includes(originHeader)) return originHeader;
  return allowed[0] ?? DEV_ORIGIN;
}

/** IP to charge the per-IP rate limit against. With `trustProxy: true`,
 *  `req.ip` is the LEFTMOST X-Forwarded-For entry — which the client can
 *  set itself, so it would let anyone dodge the bucket. The RIGHTMOST entry
 *  is the one Railway's own proxy appended (the peer it actually saw), so
 *  that is the one we key on; `req.ip` only when the header is absent. */
export function clientIp(req: Pick<FastifyRequest, 'headers' | 'ip'>): string {
  const raw = req.headers['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const last = header
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  return last ?? req.ip;
}

export async function authRecoveryRoutes(app: FastifyInstance): Promise<void> {
  // PUBLIC — no req.user check. The global auth hook never throws; it just
  // leaves req.user undefined for anonymous callers. Always 200 with the
  // same body (no user enumeration) — see service.ts.
  app.post('/auth/forgot-password', async (req): Promise<ForgotPasswordResponse> => {
    const { email } = forgotPasswordInputSchema.parse(req.body);
    const origin = resolveRedirectOrigin(req.headers.origin);
    return service.requestPasswordReset({ email, origin, ip: clientIp(req) });
  });

  // AUTHENTICATED — the reset page calls this right after `updateUser`
  // succeeds (the new session is already in hand). Emails the caller's OWN
  // address only; there is no body to validate. Always 200: a failed notice
  // must never make a successful reset look failed — see service.ts.
  app.post('/auth/password-changed', async (req): Promise<PasswordChangedResponse> => {
    if (!req.user) throw new AuthenticationError();
    return service.notifyPasswordChanged(req.user, clientIp(req));
  });
}
