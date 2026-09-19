// Forgot-password — the app sends its own reset email.
//
// Why: Supabase's built-in mailer (used when a project has no custom SMTP)
// only delivers to members of the Supabase organisation and a few mails an
// hour, so staff never received `resetPasswordForEmail` links on the test
// stack (traced 2026-09-19). The API now generates the recovery link with the
// admin API and sends it through Resend (the project's transactional mailer),
// falling back to Supabase's mailer only when Resend is not configured.
//
// Security posture: the endpoint is public and ALWAYS answers 200 with the
// same body whether or not the address exists (no user enumeration), and is
// rate-limited per address and per client IP.

import { z } from 'zod';

export const forgotPasswordInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;

/** Which mailer the API is configured to use — the same value for every
 *  request, so it reveals nothing about the address. The UI uses it only to
 *  word the "check your inbox" note. */
export const FORGOT_PASSWORD_MAILERS = ['resend', 'smtp', 'supabase'] as const;
export type ForgotPasswordMailer = (typeof FORGOT_PASSWORD_MAILERS)[number];

export const forgotPasswordResponseSchema = z.object({
  ok: z.literal(true),
  mailer: z.enum(FORGOT_PASSWORD_MAILERS),
});
export type ForgotPasswordResponse = z.infer<typeof forgotPasswordResponseSchema>;

/** How long a reset link stays valid. The Supabase project's "Email OTP expiration" must be
 *  set to the same number of seconds (Authentication → Sign In / Providers → Email); the app
 *  only STATES it — in the email, on the "check your inbox" card and on the reset page. */
export const RESET_LINK_VALID_MINUTES = 10;

// ── Password changed (after a successful reset) ────────────────────────────
// Authenticated call made by the reset page right after `updateUser` succeeds.
// The API emails "your password was changed" to the caller's own address when an
// app mailer (Resend / SMTP) is configured; with only Supabase's mailer it logs
// and skips. The response never fails the reset — the UI signs the user out and
// shows the login screen regardless.
export const passwordChangedResponseSchema = z.object({
  ok: z.literal(true),
  /** True when a confirmation email was actually handed to a mailer. */
  emailed: z.boolean(),
});
export type PasswordChangedResponse = z.infer<typeof passwordChangedResponseSchema>;
