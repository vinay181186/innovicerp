// ADR-309 — task pop-ups: this person's browser subscriptions. The user is
// always req.user; every query filters company_id AND user_id (the API
// connects as postgres, so RLS is not enforced at runtime).

import type {
  DesktopPopups,
  PushConfigResponse,
  PushTestResponse,
  RemovePushSubscriptionInput,
  SavePushSubscriptionInput,
} from '@innovic/shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { pushSubscriptions, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AppError, AuthorizationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { assertDesktopPopupsAllowed, pushConfigFor } from './payload';
import { applySendResults, sendToSubscriptions, testPayload, vapid } from './sender';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const USER_AGENT_MAX = 300;

/** 0258: the push service said this endpoint is dead. The web unsubscribes
 *  and subscribes fresh (a new endpoint) when it gets this. */
export const PUSH_SUBSCRIPTION_GONE_MESSAGE =
  "This laptop's pop-up link has expired — switching it on again.";
export class PushSubscriptionGoneError extends AppError {
  constructor() {
    super(410, 'push_subscription_gone', PUSH_SUBSCRIPTION_GONE_MESSAGE);
  }
}

/** ADR-314 — the caller's own Desktop Pop-ups switch (null = no row). */
async function desktopPopupsOf(
  tx: DbTransaction,
  user: AuthContext,
): Promise<DesktopPopups | null> {
  const rows = await tx
    .select({ desktopPopups: users.desktopPopups })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  return rows[0]?.desktopPopups ?? null;
}

/** ADR-314 — refuse (403) a caller whose Desktop Pop-ups are disabled. */
async function refuseIfPopupsDisabled(tx: DbTransaction, user: AuthContext): Promise<void> {
  assertDesktopPopupsAllowed(await desktopPopupsOf(tx, user));
}

/** GET /me/push — is pop-up delivery set up FOR THIS PERSON, and the public
 *  key. A disabled login (ADR-314) reads enabled:false, like a server with no
 *  keys, so the web shows no band and no bell switch. */
export async function getPushConfig(user: AuthContext): Promise<PushConfigResponse> {
  const keys = vapid();
  if (!keys) return pushConfigFor(null, null);
  const popups = await withUserContext(user, (tx) => desktopPopupsOf(tx, user));
  return pushConfigFor(popups, keys);
}

/** POST /me/push/subscription — save this browser for the caller. One
 *  endpoint belongs to one person: the same laptop under a new login moves
 *  to the new user (in one statement, so two saves cannot make two rows).
 *  An endpoint the push service already called dead (gone_at, 0258) is
 *  refused with 410 and never re-created. */
export async function savePushSubscription(
  input: SavePushSubscriptionInput,
  userAgent: string | null,
  user: AuthContext,
): Promise<{ ok: true }> {
  const companyId = requireCompany(user);
  const ua = userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null;
  await withUserContext(user, async (tx) => {
    await refuseIfPopupsDisabled(tx, user);
    const dead = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, input.endpoint), isNotNull(pushSubscriptions.goneAt)),
      )
      .limit(1);
    if (dead.length > 0) throw new PushSubscriptionGoneError();
    await tx
      .insert(pushSubscriptions)
      .values({
        companyId,
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: ua,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        targetWhere: isNull(pushSubscriptions.deletedAt),
        set: {
          companyId,
          userId: user.id,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: ua,
          updatedBy: user.id,
          updatedAt: new Date(),
        },
      });
  });
  return { ok: true };
}

/** DELETE /me/push/subscription — switch off on this browser (own only). */
export async function removePushSubscription(
  input: RemovePushSubscriptionInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  const companyId = requireCompany(user);
  await withUserContext(user, async (tx) => {
    const now = new Date();
    await tx
      .update(pushSubscriptions)
      .set({ deletedAt: now, deletedBy: user.id, updatedBy: user.id, updatedAt: now })
      .where(
        and(
          eq(pushSubscriptions.companyId, companyId),
          eq(pushSubscriptions.userId, user.id),
          eq(pushSubscriptions.endpoint, input.endpoint),
          isNull(pushSubscriptions.deletedAt),
        ),
      );
  });
  return { ok: true };
}

/** POST /me/push/test — a test pop-up to every browser the caller switched
 *  on. `sent` = how many accepted it (0 = none switched on / keys missing). */
export async function sendTestPush(user: AuthContext): Promise<PushTestResponse> {
  const companyId = requireCompany(user);
  const keys = vapid();
  if (!keys) return { sent: 0 };
  await withUserContext(user, (tx) => refuseIfPopupsDisabled(tx, user));
  // Read in the user's context; send and record OUTSIDE it (no network call
  // inside a transaction).
  const subs = await withUserContext(user, async (tx) =>
    tx
      .select({
        id: pushSubscriptions.id,
        userId: pushSubscriptions.userId,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.companyId, companyId),
          eq(pushSubscriptions.userId, user.id),
          isNull(pushSubscriptions.deletedAt),
        ),
      ),
  );
  if (subs.length === 0) return { sent: 0 };
  const results = await sendToSubscriptions(subs, testPayload(), keys, logger);
  await applySendResults(subs, results);
  return { sent: [...results.values()].filter((v) => v === 'ok').length };
}
