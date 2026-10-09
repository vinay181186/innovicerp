// ADR-228 — keep a login's TOKEN identity in step with `public.users`.
//
// The company and the app role now travel inside the access token, in
// `app_metadata`, because that is the only place the BROWSER can read them from
// (migration 0207 explains why, at length). Supabase copies that object into
// every token it mints, which is what makes the whole thing work without a
// custom access-token hook.
//
// The consequence, and the reason this file exists: one fact now lives in two
// places. `public.users.company_id` / `.role` is the SOURCE OF TRUTH, and
// `auth.users.raw_app_meta_data` is a COPY that rides in tokens. A copy that
// only gets written once is a copy that goes stale, so every writer of the
// source calls this. There are exactly three:
//
//   users/service.ts     createUser       — a new login must not get a blank token
//   users/service.ts     updateUser       — an admin can change a role here
//   access-control/...   saveUserAccess   — derives and writes `users.role` too
//
// Grep before adding a fourth: `grep -rn "update(users)" apps/api/src`.
//
// WHEN IT TAKES EFFECT: on that person's next token — their next sign-in, or
// their next automatic refresh (about an hour). Until then their token carries
// the old values. That is deliberately survivable: both reader functions fall
// back to the API's top-level claim, so the worst case is the behaviour we had
// before 0207 — the browser sees nothing extra — never a WRONG company. A role
// DOWNGRADE is the case to think about: it reaches the browser's direct reads
// only on the next token. Every screen and every API route re-reads the role
// server-side, so a downgraded user is refused there immediately; the lag is
// confined to what Realtime will stream them for up to an hour.
//
// NEVER write these into `user_metadata`. That object is writable BY THE USER
// (`PUT /auth/v1/user {"data":{…}}` — attempted on TEST and it succeeded), so a
// reader that trusted it would let anybody claim any company or any role.
// `app_metadata` is service-role only — the same attempt against it was refused
// with "Updating app_metadata requires admin privileges". One word apart, and
// it is the whole access-control boundary.
//
// Failure is logged and swallowed, on purpose. This is a COPY: a user whose
// metadata did not sync still has a correct `public.users` row, so every screen
// and every API call behaves normally and only their direct-browser reads lag.
// Failing the whole createUser / role change because a metadata write hiccuped
// would trade a small, self-healing lag for a hard outage of the thing the
// admin actually asked for.

import { supabaseAdmin } from './supabase-admin';
import { logger } from './logger';

export interface TokenIdentity {
  companyId: string | null | undefined;
  role: string | null | undefined;
}

/**
 * Copy a user's company and app role into their `app_metadata`, so their next
 * token carries them.
 *
 * MERGES — reads the existing object and writes it back with these two keys
 * replaced, so `provider` / `providers` and anything else Supabase keeps there
 * survive. The admin API merges top-level keys itself, but relying on that
 * would make this depend on undocumented behaviour of someone else's service.
 *
 * Never throws. See the file header for why.
 */
export async function syncTokenIdentity(userId: string, identity: TokenIdentity): Promise<void> {
  try {
    const { data, error: readErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (readErr || !data?.user) {
      logger.warn(
        { userId, err: readErr?.message },
        'ADR-228: could not read app_metadata to sync token identity; the token will lag until next sign-in',
      );
      return;
    }
    const existing = (data.user.app_metadata ?? {}) as Record<string, unknown>;
    const { error: writeErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...existing,
        company_id: identity.companyId ?? null,
        app_role: identity.role ?? null,
      },
    });
    if (writeErr) {
      logger.warn(
        { userId, err: writeErr.message },
        'ADR-228: could not write app_metadata to sync token identity; the token will lag until next sign-in',
      );
    }
  } catch (err) {
    logger.warn(
      { userId, err: err instanceof Error ? err.message : String(err) },
      'ADR-228: token identity sync threw; the token will lag until next sign-in',
    );
  }
}
