// Which mailer the API sends app-composed mail through. Pure function of the
// env-shaped object passed in — no imports from env.ts so the unit test can
// exercise the precedence without a DATABASE_URL. lib/email.ts wraps it with
// the real `env`.
//
// Precedence (auth-recovery v2, 2026-09-19):
//   1. 'resend'   — RESEND_API_KEY + a from-address (AUTH_FROM_EMAIL,
//                   ALERTS_FROM_EMAIL or RESEND_FROM_EMAIL)
//   2. 'smtp'     — SMTP_HOST + SMTP_USER + SMTP_PASS (the company Gmail);
//                   from = SMTP_FROM ?? SMTP_USER, port default 587,
//                   implicit TLS only on 465
//   3. 'supabase' — neither configured; auth mail falls back to Supabase's
//                   own mailer and other transactional mail is log-only.

export type AppMailer = 'resend' | 'smtp' | 'supabase';

export interface MailerEnv {
  RESEND_API_KEY?: string | undefined;
  AUTH_FROM_EMAIL?: string | undefined;
  ALERTS_FROM_EMAIL?: string | undefined;
  RESEND_FROM_EMAIL?: string | undefined;
  SMTP_HOST?: string | undefined;
  SMTP_PORT?: number | undefined;
  SMTP_USER?: string | undefined;
  SMTP_PASS?: string | undefined;
  SMTP_FROM?: string | undefined;
}

export const SMTP_DEFAULT_PORT = 587;

/** Sender for Resend-delivered auth mail: AUTH_FROM_EMAIL, else the alerts
 *  sender, else the name the local env file uses. */
export function resendFromAddress(e: MailerEnv): string | undefined {
  return e.AUTH_FROM_EMAIL ?? e.ALERTS_FROM_EMAIL ?? e.RESEND_FROM_EMAIL;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** SMTP settings when the three required variables are present, else undefined. */
export function smtpConfig(e: MailerEnv): SmtpConfig | undefined {
  if (!e.SMTP_HOST || !e.SMTP_USER || !e.SMTP_PASS) return undefined;
  const port = e.SMTP_PORT ?? SMTP_DEFAULT_PORT;
  return {
    host: e.SMTP_HOST,
    port,
    secure: port === 465,
    user: e.SMTP_USER,
    pass: e.SMTP_PASS,
    from: e.SMTP_FROM ?? e.SMTP_USER,
  };
}

export function resolveMailerFrom(e: MailerEnv): AppMailer {
  if (e.RESEND_API_KEY && resendFromAddress(e)) return 'resend';
  if (smtpConfig(e)) return 'smtp';
  return 'supabase';
}
