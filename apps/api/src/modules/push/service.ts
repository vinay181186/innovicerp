// ADR-309 — task pop-ups: this person's browser subscriptions. The user is
// always req.user; every query filters company_id AND user_id (the API
// connects as postgres, so RLS is not enforced at runtime).

import type {
  PushConfigResponse,
  PushTestResponse,
  RemovePushSubscriptionInput,
  SavePushSubscriptionInput,
} from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { pushSubscriptions } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { applySendResults, sendToSubscriptions, testPayload, vapid } from './sender';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const USER_AGENT_MAX = 300;

/** GET /me/push — is pop-up delivery set up, and the public key. */
export function getPushConfig(): PushConfigResponse {
  const keys = vapid();
  return { enabled: keys !== null, publicKey: keys?.publicKey ?? null };
}

/** POST /me/push/subscription — save this browser for the caller. One
 *  endpoint belongs to one person: the same laptop under a new login moves
 *  to the new user (in one statement, so two saves cannot make two rows). */
export async function savePushSubscription(
  input: SavePushSubscriptionInput,
  userAgent: string | null,
  user: AuthContext,
): Promise<{ ok: true }> {
  const companyId = requireCompany(user);
  const ua = userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null;
  await withUserContext(user, async (tx) => {
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
  return withUserContext(user, async (tx) => {
    const subs = await tx
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
      );
    if (subs.length === 0) return { sent: 0 };
    const results = await sendToSubscriptions(subs, testPayload(), keys, logger);
    await applySendResults(tx, subs, results);
    return { sent: [...results.values()].filter((v) => v === 'ok').length };
  });
}
