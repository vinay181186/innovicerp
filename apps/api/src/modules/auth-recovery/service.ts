// Forgot-password: the app sends its own reset email.
//
// Why: Supabase's built-in mailer (no custom SMTP on the project) only
// delivers to Supabase-org members and a few mails an hour, so
// `supabase.auth.resetPasswordForEmail` from the browser returned 200 and
// nothing arrived (traced 2026-09-19). Here the API mints the recovery link
// with the Auth Admin API and emails it through Resend. If Resend is not
// configured we fall back to Supabase's mailer — no worse than before.
//
// Security posture (see packages/shared/src/schemas/auth-recovery.ts):
//   - public route; ALWAYS resolves to the same `{ ok: true, mailer }`
//     whether or not the address exists, is active, is rate-limited, or the
//     send failed. The log line is the audit trail.
//   - `mailer` is computed from env BEFORE the lookup so it is identical for
//     every caller.
//   - rate-limited per address (3 / 15 min) and per client IP (10 / 15 min);
//     a blocked request is silently not sent — never a 429.
//   - the link / token is never logged.

import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { sendTransactionalEmail } from '../../lib/email';
import { env } from '../../lib/env';
import { logger } from '../../lib/logger';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { RateLimiter } from './rate-limit';
import type { ForgotPasswordMailer, ForgotPasswordResponse } from './schema';

const WINDOW_MS = 15 * 60 * 1000;
const emailLimiter = new RateLimiter({ max: 3, windowMs: WINDOW_MS });
const ipLimiter = new RateLimiter({ max: 10, windowMs: WINDOW_MS });

export interface RequestPasswordResetArgs {
  /** Already trimmed + lowercased by forgotPasswordInputSchema. */
  email: string;
  /** Web app origin the reset link should land on — validated by the route. */
  origin: string;
  /** Client IP (req.ip; trustProxy is on so this is the real client). */
  ip: string;
}

/** Sender for auth mail: AUTH_FROM_EMAIL, else the alerts sender, else the
 *  name the local env file uses. */
function resolveFromAddress(): string | undefined {
  return env.AUTH_FROM_EMAIL ?? env.ALERTS_FROM_EMAIL ?? env.RESEND_FROM_EMAIL;
}

/** Which mailer this deployment uses. Depends only on env, never on the
 *  request, so the response body reveals nothing about the address. */
export function configuredMailer(): ForgotPasswordMailer {
  return env.RESEND_API_KEY && resolveFromAddress() ? 'resend' : 'supabase';
}

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
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
    SELECT id, email, full_name, is_active
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
  // generateLink + Resend, a real address would answer measurably slower
  // than an unknown one and the timing would leak whether it exists.
  void sendResetEmail(user, `${origin}/auth/reset-password`, mailer);
  return response;
}

async function sendResetEmail(
  user: UserRow,
  redirectTo: string,
  mailer: ForgotPasswordMailer,
): Promise<void> {
  try {
    if (mailer === 'resend') {
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: user.email,
        options: { redirectTo },
      });
      const actionLink = data?.properties?.action_link;
      if (error || !actionLink) {
        throw new Error(`generateLink failed: ${error?.message ?? 'no action_link returned'}`);
      }
      const { messageId } = await sendTransactionalEmail({
        from: resolveFromAddress(),
        fromVar: 'AUTH_FROM_EMAIL / ALERTS_FROM_EMAIL / RESEND_FROM_EMAIL',
        to: user.email,
        subject: 'Reset your Innovic ERP password',
        ...buildResetEmail(user.full_name, actionLink),
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
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain HTML + text bodies. No external images, one link. */
export function buildResetEmail(
  fullName: string | null,
  actionLink: string,
): { html: string; text: string } {
  const name = fullName?.trim() ? fullName.trim() : 'there';
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(actionLink);
  const expiry =
    'This link works once and expires in about an hour. If you did not ask for this, ignore this email.';

  const html = `<!doctype html>
<html>
  <body style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #222; line-height: 1.5;">
    <p>Hello ${safeName},</p>
    <p>Someone asked to reset the password for your Innovic ERP account. Click the button below to choose a new password.</p>
    <p style="margin: 24px 0;">
      <a href="${safeLink}" style="display: inline-block; padding: 10px 18px; background: #1f4e79; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold;">Reset password</a>
    </p>
    <p>If the button does not work, copy this link into your browser:<br><a href="${safeLink}">${safeLink}</a></p>
    <p>${expiry}</p>
    <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
    <p style="color: #666; font-size: 13px;">Innovic ERP</p>
  </body>
</html>`;

  const text = [
    `Hello ${name},`,
    '',
    'Someone asked to reset the password for your Innovic ERP account. Open this link to choose a new password:',
    '',
    actionLink,
    '',
    expiry,
    '',
    'Innovic ERP',
  ].join('\n');

  return { html, text };
}
