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
export const FORGOT_PASSWORD_MAILERS = ['resend', 'supabase'] as const;
export type ForgotPasswordMailer = (typeof FORGOT_PASSWORD_MAILERS)[number];

export const forgotPasswordResponseSchema = z.object({
  ok: z.literal(true),
  mailer: z.enum(FORGOT_PASSWORD_MAILERS),
});
export type ForgotPasswordResponse = z.infer<typeof forgotPasswordResponseSchema>;
