// Email bodies for the auth-recovery module. Pure functions — no env, no
// DB — so service.test.ts can assert the wording without a DATABASE_URL.
// Plain HTML + text, no external images, one link at most.
//
// Wording decided by the user 2026-09-19 (auth-recovery v2). The validity
// number comes from the shared contract (RESET_LINK_VALID_MINUTES) so the
// email, the "check your inbox" card and the reset page all say the same.

import { RESET_LINK_VALID_MINUTES } from '@innovic/shared';

const FOOTER = 'Innovic Technology — Innovic ERP';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function greetingName(fullName: string | null | undefined): string {
  return fullName?.trim() ? fullName.trim() : 'there';
}

/** Host part of the web origin for the email body, e.g. "innovicerp.com".
 *  Falls back to the raw string if it is not a parseable URL. */
export function originHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** "19 Sep 2026, 3:42 pm IST" — the user's wording. */
export function formatIst(at: Date): string {
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(at);
  return `${formatted} IST`;
}

export interface EmailBody {
  subject: string;
  html: string;
  text: string;
}

function wrapHtml(paragraphs: string[]): string {
  return `<!doctype html>
<html>
  <body style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #222; line-height: 1.5;">
${paragraphs.map((p) => `    ${p}`).join('\n')}
    <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
    <p style="color: #666; font-size: 13px;">${FOOTER}</p>
  </body>
</html>`;
}

/** Reset-password email. `link` is the own-domain reset URL (never logged). */
export function buildResetEmail(
  fullName: string | null | undefined,
  origin: string,
  link: string,
): EmailBody {
  const name = greetingName(fullName);
  const host = originHost(origin);
  const safeName = escapeHtml(name);
  const safeHost = escapeHtml(host);
  const safeLink = escapeHtml(link);
  const validity = `This link is valid for ${RESET_LINK_VALID_MINUTES} minutes and works once.`;
  const ignore = 'If you did not ask for this, ignore this email — your password stays the same.';

  const html = wrapHtml([
    `<p>Hello ${safeName},</p>`,
    `<p>Someone asked to reset the password for your Innovic ERP account on ${safeHost}. If that was you, use the button below.</p>`,
    `<p style="margin: 24px 0;">
      <a href="${safeLink}" style="display: inline-block; padding: 10px 18px; background: #1f4e79; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold;">Reset password</a>
    </p>`,
    `<p>If the button does not work, copy this link into your browser:<br><a href="${safeLink}">${safeLink}</a></p>`,
    `<p><strong>${validity}</strong> ${ignore}</p>`,
  ]);

  const text = [
    `Hello ${name},`,
    '',
    `Someone asked to reset the password for your Innovic ERP account on ${host}. If that was you, open this link to choose a new password:`,
    '',
    link,
    '',
    `${validity} ${ignore}`,
    '',
    FOOTER,
  ].join('\n');

  return { subject: 'Reset your Innovic ERP password', html, text };
}

/** "Your password was changed" notice sent to the account's own address. */
export function buildPasswordChangedEmail(
  fullName: string | null | undefined,
  changedAt: Date,
): EmailBody {
  const name = greetingName(fullName);
  const when = formatIst(changedAt);
  const safeName = escapeHtml(name);
  const line1 = `The password for your Innovic ERP account was changed on ${when}.`;
  const line2 =
    'If this was you, no action is needed. If it was not you, contact your administrator immediately.';

  const html = wrapHtml([
    `<p>Hello ${safeName},</p>`,
    `<p>${escapeHtml(line1)}</p>`,
    `<p>${line2}</p>`,
  ]);

  const text = [`Hello ${name},`, '', line1, '', line2, '', FOOTER].join('\n');

  return { subject: 'Your Innovic ERP password was changed', html, text };
}
