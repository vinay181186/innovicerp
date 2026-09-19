// Resend client wrapper for transactional email (T-041d Phase B,
// ADR-024). Two flags:
//
//   RESEND_API_KEY     — required for actual delivery. If unset we run in
//                        "log mode": sendAlertDigest() logs the envelope
//                        and returns a fake message-id so the audit trail
//                        in alert_deliveries still records the attempt.
//   ALERTS_FROM_EMAIL  — required when RESEND_API_KEY is set. Without it
//                        we refuse to dispatch (Resend requires verified
//                        sender domain — RUNBOOK has the setup steps).
//
// Two senders share one Resend client + one log-only fallback:
//   sendAlertDigest()        — alert digests (from = ALERTS_FROM_EMAIL);
//                              Resend or log-only, unchanged by v2 below.
//   sendTransactionalEmail() — generic one-off mail (password reset etc.);
//                              the caller picks the Resend from-address.
//
// auth-recovery v2 (2026-09-19) — SMTP transport via nodemailer. Decision
// (ADR pending in docs/DECISIONS.md — recorded here so the dependency is
// justified): Supabase's built-in mailer can only send ITS OWN templates
// (recovery, magic link, …); it cannot deliver mail the app composes, such
// as "your password was changed", and without custom SMTP it also throttles
// to a few mails an hour to org members only. The user's Gmail (App
// Password) over plain SMTP is the zero-cost transport that can. nodemailer
// is the de-facto Node SMTP client (no runtime deps, maintained since 2010);
// alternatives — Resend (needs a verified sending domain, not yet set up on
// this stack) and Supabase custom SMTP (still only Supabase's templates) —
// do not cover app-composed mail. Precedence: Resend → SMTP → log-only /
// Supabase; see lib/mailer-config.ts resolveMailerFrom().

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { env } from './env';
import { logger } from './logger';
import { resolveMailerFrom, smtpConfig } from './mailer-config';
import type { AppMailer } from './mailer-config';

/** Which mailer this deployment sends app-composed mail through. Depends
 *  only on env, never on a request. */
export function resolveMailer(): AppMailer {
  return resolveMailerFrom(env);
}

let smtpTransport: Transporter | undefined;

/** Lazily-created nodemailer transport for the SMTP path. `undefined` when
 *  the SMTP variables are not all set. */
function getSmtpTransport(): { transport: Transporter; from: string } | undefined {
  const cfg = smtpConfig(env);
  if (!cfg) return undefined;
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }
  return { transport: smtpTransport, from: cfg.from };
}

let resendClient: Resend | undefined;
let warnedNoKey = false;

function getClient(): Resend | undefined {
  if (!env.RESEND_API_KEY) {
    if (!warnedNoKey) {
      logger.warn(
        'RESEND_API_KEY not set — alert digest delivery running in log-only mode. Set RESEND_API_KEY + ALERTS_FROM_EMAIL to enable real sends.',
      );
      warnedNoKey = true;
    }
    return undefined;
  }
  if (!resendClient) resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export interface AlertDigestEmail {
  /** Subscriber's email address. */
  to: string;
  /** "Daily Innovic ERP alerts (5 active)" or similar. */
  subject: string;
  /** HTML body. We don't ship a plain-text variant in v1 — Resend's
   *  fallback handles renders that require it. */
  html: string;
}

export interface DispatchResult {
  /** `id` returned by Resend, or `'stub-…'` in log-only mode. Stored on
   *  alert_deliveries for audit + Resend lookup. */
  messageId: string;
  /** True when delivery was attempted via Resend; false when stubbed. */
  realSend: boolean;
}

interface SendArgs {
  from: string | undefined;
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Optional — the digest never ships one. */
  text?: string;
  /** Labels for the log-only line, e.g. "alert digest" / "ALERTS_FROM_EMAIL". */
  kind: string;
  fromVar: string;
}

/** Shared send. In log-only mode (no API key OR no from-address), logs the
 *  envelope and returns a synthetic id. Throws on a Resend error so each
 *  caller decides its own retry / swallow policy. */
async function sendViaResend(args: SendArgs): Promise<DispatchResult> {
  const client = getClient();
  const { from } = args;

  if (!client || !from) {
    const stubId = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    logger.info(
      {
        stubId,
        to: args.to,
        subject: args.subject,
        bodyLen: args.html.length,
      },
      `${args.kind} dispatch — log-only (RESEND_API_KEY or ${args.fromVar} unset)`,
    );
    return { messageId: stubId, realSend: false };
  }

  const result = await client.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    ...(args.text ? { text: args.text } : {}),
  });

  // Resend SDK returns `{ data, error }` shape on send. Throw on error so
  // the caller's retry policy kicks in.
  if (result.error) {
    throw new Error(
      `Resend send failed: ${result.error.name ?? 'unknown'} — ${result.error.message ?? ''}`,
    );
  }

  return { messageId: result.data?.id ?? 'unknown', realSend: true };
}

/** Dispatch a digest email. In log-only mode (no API key OR no FROM email),
 *  logs the envelope and returns a synthetic id. Idempotency must be enforced
 *  by the caller via the alert_deliveries audit table — this function only
 *  attempts a single send and returns the result. */
export async function sendAlertDigest(payload: AlertDigestEmail): Promise<DispatchResult> {
  return sendViaResend({
    from: env.ALERTS_FROM_EMAIL,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    kind: 'alert digest',
    fromVar: 'ALERTS_FROM_EMAIL',
  });
}

export interface TransactionalEmail {
  /** Sender on the Resend path. Caller resolves it (e.g. AUTH_FROM_EMAIL ??
   *  ALERTS_FROM_EMAIL). Ignored on the SMTP path, which always sends from
   *  SMTP_FROM ?? SMTP_USER (Gmail rewrites anything else anyway). */
  from: string | undefined;
  /** Name of the env var(s) `from` came from — for the log-only line only. */
  fromVar: string;
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative for clients that do not render HTML. */
  text: string;
}

/** Generic one-off email (password reset, password-changed notice, invite, …).
 *  Goes through whichever mailer resolveMailer() picks: Resend, else SMTP,
 *  else the same log-only stub as the digest. Throws on a send error so
 *  each caller decides its own swallow / retry policy. */
export async function sendTransactionalEmail(payload: TransactionalEmail): Promise<DispatchResult> {
  const mailer = resolveMailer();
  if (mailer === 'smtp') return sendViaSmtp(payload);
  return sendViaResend({
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    kind: 'transactional email',
    fromVar: payload.fromVar,
  });
}

async function sendViaSmtp(payload: TransactionalEmail): Promise<DispatchResult> {
  const smtp = getSmtpTransport();
  if (!smtp) {
    // Unreachable when resolveMailer() said 'smtp', but keep the same
    // log-only behaviour rather than throwing on a race with env.
    const stubId = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    logger.info(
      { stubId, to: payload.to, subject: payload.subject, bodyLen: payload.html.length },
      'transactional email dispatch — log-only (SMTP_HOST / SMTP_USER / SMTP_PASS unset)',
    );
    return { messageId: stubId, realSend: false };
  }
  const info = await smtp.transport.sendMail({
    from: smtp.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });
  return { messageId: info.messageId ?? 'unknown', realSend: true };
}
