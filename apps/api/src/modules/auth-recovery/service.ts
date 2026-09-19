// Forgot-password: the app sends its own reset email.
//
// Why: Supabase's built-in mailer (no custom SMTP on the project) only
// delivers to Supabase-org members and a few mails an hour, so
// `supabase.auth.resetPasswordForEmail` from the browser returned 200 and
// nothing arrived (traced 2026-09-19). Here the API mints the recovery
// token with the Auth Admin API and emails a link ON OUR OWN DOMAIN
// (`/auth/reset-password?token_hash=…&type=recovery`; the web page calls
// `verifyOtp`) through the app mailer — Resend, else SMTP (the company
// Gmail). With neither configured we fall back to Supabase's mailer — no
// worse than before. Mailer precedence: lib/mailer-config.ts.
//
// v2 (user decisions 2026-09-19): own-domain link + 10-minute wording,
// POST /auth/password-changed confirmation email, and activity-log rows for
// "reset requested" / "reset completed".
//
// Security posture (see packages/shared/src/schemas/auth-recovery.ts):
//   - public route; ALWAYS resolves to the same `{ ok: true, mailer }`
//     whether or not the address exists, is active, is rate-limited, or the
//     send failed. The log line is the audit trail.
//   - `mailer` is computed from env BEFORE the lookup so it is identical for
//     every caller.
//   - rate-limited per address (3 / 15 min) and per client IP (10 / 15 min);
//     a blocked request is silently not sent — never a 429.
//   - the link / token is never logged and never written to activity_log.

import { RESET_LINK_VALID_MINUTES } from '@innovic/shared';
import type { UserRole } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { withUserContext } from '../../db/with-user-context';
import type { AuthContext } from '../../db/with-user-context';
import { resolveMailer, sendTransactionalEmail } from '../../lib/email';
import { env } from '../../lib/env';
import { logger } from '../../lib/logger';
import { resendFromAddress } from '../../lib/mailer-config';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { emitActivityLog } from '../activity-log/service';
import { RateLimiter } from './rate-limit';
import type {
  ForgotPasswordMailer,
  ForgotPasswordResponse,
  PasswordChangedResponse,
} from './schema';
import { buildPasswordChangedEmail, buildResetEmail } from './templates';

const WINDOW_MS = 15 * 60 * 1000;
const emailLimiter = new RateLimiter({ max: 3, windowMs: WINDOW_MS });
const ipLimiter = new RateLimiter({ max: 10, windowMs: WINDOW_MS });
/** password-changed notices: 3 per user per 15 min, so a stolen session
 *  cannot turn the endpoint into an email spammer. */
const changedLimiter = new RateLimiter({ max: 3, windowMs: WINDOW_MS });

const RESET_PAGE_PATH = '/auth/reset-password';
const FROM_VAR = 'AUTH_FROM_EMAIL / ALERTS_FROM_EMAIL / RESEND_FROM_EMAIL';

export interface RequestPasswordResetArgs {
  /** Already trimmed + lowercased by forgotPasswordInputSchema. */
  email: string;
  /** Web app origin the reset link should land on — validated by the route. */
  origin: string;
  /** Client IP (rightmost X-Forwarded-For; see routes.ts clientIp). */
  ip: string;
}

/** Which mailer this deployment uses. Depends only on env, never on the
 *  request, so the response body reveals nothing about the address. */
export function configuredMailer(): ForgotPasswordMailer {
  return resolveMailer();
}

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  company_id: string | null;
  role: UserRole;
};

export async function requestPasswordReset(
  args: RequestPasswordResetArgs,
): Promise<ForgotPasswordResponse> {
  const { email, origin, ip } = args;
  const mailer = configuredMailer();
  const response: ForgotPasswordResponse = { ok: true, mailer };

  // Rate limits — both buckets are charged even when one blocks, so a
  // flood from one IP cannot be used to probe many addresses for free.
  const emailOk = emailLimiter.hit(email);
  const ipOk = ipLimiter.hit(ip);
  if (!emailOk || !ipOk) {
    logger.warn(
      { email, ip, emailLimited: !emailOk, ipLimited: !ipOk },
      'forgot-password rate-limited — not sending',
    );
    return response;
  }

  // Public route: no user context, so plain SQL against the users table.
  // Soft-deleted rows are ignored; deactivated users get nothing.
  const rows = await db.execute<UserRow>(sql`
    SELECT id, email, full_name, is_active, company_id, role
    FROM public.users
    WHERE lower(email) = ${email} AND deleted_at IS NULL
    LIMIT 1
  `);
  const user = rows[0];
  if (!user) {
    logger.info({ email, ip, mailer }, 'forgot-password for unknown address — not sending');
    return response;
  }
  if (!user.is_active) {
    logger.info({ userId: user.id, ip, mailer }, 'forgot-password for inactive user — not sending');
    return response;
  }

  // Respond NOW and do the generate+send detached. If the 200 waited for
  // generateLink + the mailer, a real address would answer measurably slower
  // than an unknown one and the timing would leak whether it exists.
  void sendResetEmail(user, origin, mailer, ip);
  return response;
}

/** Own-domain reset URL. The web page reads `token_hash` + `type` and calls
 *  `supabase.auth.verifyOtp` — Supabase's `action_link` is NOT used on the
 *  app-mailer path any more (it bounced through Supabase's /verify and its
 *  redirect allow-list). */
function buildResetLink(origin: string, hashedToken: string): string {
  return `${origin}${RESET_PAGE_PATH}?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;
}

async function sendResetEmail(
  user: UserRow,
  origin: string,
  mailer: ForgotPasswordMailer,
  ip: string,
): Promise<void> {
  const redirectTo = `${origin}${RESET_PAGE_PATH}`;
  try {
    if (mailer === 'resend' || mailer === 'smtp') {
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: user.email,
        options: { redirectTo },
      });
      const hashedToken = data?.properties?.hashed_token;
      if (error || !hashedToken) {
        throw new Error(`generateLink failed: ${error?.message ?? 'no hashed_token returned'}`);
      }
      const body = buildResetEmail(user.full_name, origin, buildResetLink(origin, hashedToken));
      const { messageId } = await sendTransactionalEmail({
        from: resendFromAddress(env),
        fromVar: FROM_VAR,
        to: user.email,
        ...body,
      });
      logger.info({ userId: user.id, mailer, messageId }, 'forgot-password email sent');
    } else {
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(user.email, {
        redirectTo,
      });
      if (error) throw new Error(`resetPasswordForEmail failed: ${error.message}`);
      logger.info({ userId: user.id, mailer, messageId: null }, 'forgot-password email sent');
    }
  } catch (err) {
    // Never surfaces to the browser (the 200 already went out) — the log is the audit.
    logger.error(
      { userId: user.id, mailer, reason: err instanceof Error ? err.message : String(err) },
      'forgot-password send failed',
    );
    return;
  }

  // Audit row — only after a real send, and only the facts (never the link).
  await recordActivity(
    {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      companyId: user.company_id,
      role: user.role,
      isActive: user.is_active,
    },
    'password_reset_requested',
    `Reset link sent via ${mailer} from IP ${ip}`,
  );
}

/** Writes one activity_log row for the user, in their own company. The
 *  public forgot-password path has no JWT: `withUserContext` only needs the
 *  claims object (it does `set_config('request.jwt.claims', …)` itself, and
 *  the API's `postgres` role is the table owner so RLS does not block it),
 *  so an AuthContext synthesised from the users row is enough. Failures are
 *  logged and swallowed — the audit row must never break the mail flow. */
async function recordActivity(user: AuthContext, action: string, detail: string): Promise<void> {
  if (!user.companyId) {
    logger.warn({ userId: user.id, action }, 'auth-recovery audit skipped — user has no company');
    return;
  }
  const companyId = user.companyId;
  try {
    await withUserContext(user, (tx) =>
      emitActivityLog(tx, { action, entity: 'users', detail, refId: user.id }, companyId, user),
    );
  } catch (err) {
    logger.error(
      { userId: user.id, action, reason: err instanceof Error ? err.message : String(err) },
      'auth-recovery audit row failed',
    );
  }
}

// ── Password changed (authenticated, called right after updateUser) ────────

/** A session may only claim "my password was changed" if Supabase agrees.
 *  GoTrue exposes no password-hash version, so this is a HEURISTIC for a
 *  courtesy email + audit row, built from two auth-user timestamps:
 *
 *    - `updated_at` must be within the last RESET_LINK_VALID_MINUTES (the
 *      reset page calls this endpoint immediately after `updateUser`);
 *    - `updated_at` must be at least 1 s LATER than `last_sign_in_at`. A
 *      password sign-in or a `verifyOtp` (the reset-link click) writes both
 *      columns together; `updateUser({ password })` afterwards bumps only
 *      `updated_at`.
 *
 *  Rejects: an ordinary logged-in session (updated_at old, or equal to its
 *  sign-in), a session that merely OPENED the reset link without setting a
 *  password (verifyOtp wrote both timestamps together), and anything the
 *  Admin API cannot read. Accepts a real change inside the window. Any
 *  rejected caller gets `emailed:false`, no email, no audit row — it must
 *  not be able to fabricate a "reset completed" entry or trigger the email.
 *  (`amr` / `recovery` claims are not available here: req.user carries the
 *  profile row, not the raw JWT.) */
const RECENT_CHANGE_WINDOW_MS = RESET_LINK_VALID_MINUTES * 60 * 1000;
/** Allow the API clock to run up to a minute behind Supabase's. */
const CLOCK_SKEW_MS = 60_000;
/** `updated_at` must lead `last_sign_in_at` by this much to count as a
 *  separate write (a sign-in / verifyOtp writes both in one statement). */
const MIN_CHANGE_AFTER_SIGN_IN_MS = 1000;

async function passwordChangedRecently(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  const updatedAt = data?.user?.updated_at;
  if (error || !updatedAt) {
    logger.warn(
      { userId, reason: error?.message ?? 'no updated_at on auth user' },
      'password-changed: could not read auth user',
    );
    return false;
  }
  const updatedMs = Date.parse(updatedAt);
  const ageMs = Date.now() - updatedMs;
  if (!Number.isFinite(ageMs) || ageMs < -CLOCK_SKEW_MS || ageMs > RECENT_CHANGE_WINDOW_MS) {
    return false;
  }
  const lastSignInAt = data.user.last_sign_in_at;
  const lastSignInMs = lastSignInAt ? Date.parse(lastSignInAt) : Number.NaN;
  // No sign-in on record at all: cannot tell a change from a sign-in — reject.
  if (!Number.isFinite(lastSignInMs)) return false;
  return updatedMs - lastSignInMs >= MIN_CHANGE_AFTER_SIGN_IN_MS;
}

/** Emails "your password was changed" to the caller's own address when an
 *  app mailer is configured; logs and skips with Supabase-only. Never throws
 *  — the reset already succeeded, this is a courtesy notice plus an audit row.
 *  The audit row is written for every verified change; only the EMAIL is
 *  rate-limited (3 per user per 15 min). */
export async function notifyPasswordChanged(
  user: AuthContext,
  ip: string,
): Promise<PasswordChangedResponse> {
  if (!(await passwordChangedRecently(user.id))) {
    logger.warn(
      { userId: user.id, ip },
      'password-changed called without a recent password change',
    );
    return { ok: true, emailed: false };
  }

  const mailer = configuredMailer();
  let emailed = false;
  let outcome: string;

  if (!changedLimiter.hit(user.id)) {
    logger.warn({ userId: user.id, ip }, 'password-changed notice rate-limited — not sending');
    outcome = 'not sent (rate-limited)';
  } else if (mailer === 'resend' || mailer === 'smtp') {
    try {
      const { messageId, realSend } = await sendTransactionalEmail({
        from: resendFromAddress(env),
        fromVar: FROM_VAR,
        to: user.email,
        ...buildPasswordChangedEmail(user.fullName, new Date()),
      });
      emailed = realSend;
      outcome = emailed ? 'sent' : 'not sent (no app mailer)';
      logger.info({ userId: user.id, mailer, messageId }, 'password-changed notice sent');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      outcome = `not sent (send failed: ${reason})`;
      logger.error({ userId: user.id, mailer, reason }, 'password-changed notice failed');
    }
  } else {
    outcome = 'not sent (no app mailer)';
    logger.info({ userId: user.id, mailer }, 'password-changed notice skipped — no app mailer');
  }

  await recordActivity(
    user,
    'password_reset_completed',
    `Password changed from IP ${ip}; confirmation email ${outcome}`,
  );

  return { ok: true, emailed };
}
