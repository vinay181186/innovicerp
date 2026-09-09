/**
 * Plain-English messages for Supabase Auth errors on the login screen.
 *
 * WHY THIS EXISTS
 * ---------------
 * Supabase deliberately returns ONE message — "Invalid login credentials" — for several
 * different causes: a wrong password, an unknown email address, an unconfirmed email and
 * an account that has no password set at all. That is on purpose: it stops an attacker
 * probing the login form to discover which email addresses have accounts here.
 *
 * The side effect is that a real staff member on their first sign-in, whose administrator
 * has not set a password for them yet, is told "Invalid login credentials" and has no way
 * to know what to do next. That ambiguity cost a full day of investigation in production.
 *
 * So we re-add the distinction ONLY where it is safe to do so:
 *   - Causes that are about the SITE (rate limits, email logins switched off, a banned
 *     account the user is already holding credentials for) get a specific message.
 *   - The ambiguous credential failure keeps its ambiguity — we never say whether it was
 *     the email or the password that was wrong, and we never say whether an account with
 *     that email exists. We only add the actionable hint about a password not being set yet,
 *     which is true advice for every first-time user and reveals nothing about any account.
 *   - Anything we do not recognise falls through to Supabase's own message, so information
 *     is never lost — only ever improved.
 */

/** Which form the error came from — the wording differs slightly for each. */
export type AuthAction = 'sign-in' | 'magic-link' | 'password-reset';

/**
 * supabase-js v2 attaches a string `code` and a numeric `status` to auth errors, but both
 * can be undefined (for example a network failure before any response arrives), so read
 * them defensively rather than trusting the type.
 */
type AuthErrorLike = {
  code?: string | undefined;
  status?: number | undefined;
  message?: string | undefined;
};

const FIRST_TIME_HINT =
  'If this is your first time signing in, your administrator may not have set a password for ' +
  'you yet. An admin can set one from Users → open the user → Set Password.';

export function authErrorMessage(err: AuthErrorLike | null | undefined, action: AuthAction) {
  const code = typeof err?.code === 'string' ? err.code : '';
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const raw = err?.message?.trim();

  switch (code) {
    // The ambiguous one, and the one our staff are actually hitting. The wording must stay
    // ambiguous about WHICH of the two was wrong — saying "no account with that email"
    // would turn this form into an email-address checker for anyone on the internet.
    case 'invalid_credentials':
      return `That email and password don't match. ${FIRST_TIME_HINT}`;

    case 'email_not_confirmed':
      return (
        'This email address has not been confirmed yet. Open the confirmation link that was ' +
        'emailed to you, or ask your administrator to confirm the account for you.'
      );

    case 'user_banned':
      return 'This account is blocked. Please contact your administrator.';

    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a minute and try again.';

    // Supabase caps how many emails it will send in a window, per address and per project.
    case 'over_email_send_rate_limit':
      return 'The limit on sending emails has been reached. Please try again in a few minutes.';

    // Site-wide switches. These say nothing about any particular account, so they are safe
    // to report exactly.
    case 'email_provider_disabled':
    case 'signup_disabled':
      return action === 'sign-in'
        ? 'Email logins are turned off for this site. Please contact your administrator.'
        : 'Email links are turned off for this site. Please contact your administrator.';

    // A weak/short password is only ever reported when setting one, but map it here so the
    // reset flow reads well too.
    case 'weak_password':
      return raw || 'That password is too weak. Please choose a longer one.';

    default:
      break;
  }

  // No code we recognise. Fall back on the HTTP status before giving up.
  if (status === 429) {
    return action === 'sign-in'
      ? 'Too many attempts. Please wait a minute and try again.'
      : 'Too many requests. Please wait a minute and try again.';
  }

  // Never swallow information: show whatever Supabase said.
  if (raw) return raw;

  return action === 'sign-in'
    ? 'Sign-in failed. Please try again, or contact your administrator.'
    : 'That request could not be completed. Please try again, or contact your administrator.';
}

/**
 * True when a magic-link failure is really "we have no account for that address".
 *
 * We now send magic links with `shouldCreateUser: false` (see the magic-link form), so an
 * address with no account comes back as an error instead of silently creating one. Supabase
 * reports that as `otp_disabled` — and sometimes `invalid_credentials` / `user_not_found`,
 * depending on version.
 *
 * We cannot safely distinguish "no such account" from "link sent", and showing a different
 * screen for the two would hand an attacker exactly the email-address checker that Supabase's
 * single vague message was designed to prevent. So we show the ordinary "Check your inbox"
 * screen either way. That screen already tells the user what to do if no email arrives
 * ("ask an admin to set your password directly"), which is the correct next step both when
 * the address has no account and in the rare case OTP is switched off site-wide.
 */
export function isAddressSpecificOtpError(err: AuthErrorLike | null | undefined) {
  const code = typeof err?.code === 'string' ? err.code : '';
  return code === 'otp_disabled' || code === 'invalid_credentials' || code === 'user_not_found';
}
