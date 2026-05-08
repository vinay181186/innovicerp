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
// Today we only know about alert digests; broader transactional email
// (password reset, invite, etc.) lands in a follow-on task that can use
// this same wrapper or extract the Resend client cleanly.

import { Resend } from 'resend';
import { env } from './env';
import { logger } from './logger';

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

/** Dispatch a digest email. In log-only mode (no API key OR no FROM email),
 *  logs the envelope and returns a synthetic id. Idempotency must be enforced
 *  by the caller via the alert_deliveries audit table — this function only
 *  attempts a single send and returns the result. */
export async function sendAlertDigest(payload: AlertDigestEmail): Promise<DispatchResult> {
  const client = getClient();
  const from = env.ALERTS_FROM_EMAIL;

  if (!client || !from) {
    const stubId = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    logger.info(
      {
        stubId,
        to: payload.to,
        subject: payload.subject,
        bodyLen: payload.html.length,
      },
      'alert digest dispatch — log-only (RESEND_API_KEY or ALERTS_FROM_EMAIL unset)',
    );
    return { messageId: stubId, realSend: false };
  }

  const result = await client.emails.send({
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });

  // Resend SDK returns `{ data, error }` shape on send. Throw on error so
  // the worker's retry policy kicks in.
  if (result.error) {
    throw new Error(
      `Resend send failed: ${result.error.name ?? 'unknown'} — ${result.error.message ?? ''}`,
    );
  }

  return { messageId: result.data?.id ?? 'unknown', realSend: true };
}
