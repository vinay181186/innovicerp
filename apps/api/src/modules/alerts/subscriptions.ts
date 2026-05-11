// Alerts subscriptions service (T-041d Phase B slice 6, ADR-024).
//
// A subscription is a (user_id, code, channel) tuple in alert_subscriptions.
// The row IS the subscription — there is no `active` flag. Subscribe = INSERT
// (with conflict-do-nothing for idempotency); unsubscribe = DELETE.
//
// Auth model:
//   list / set — self-only at the service layer. RLS additionally allows
//                admin/manager to write any user's row (reserved for a
//                future admin "manage everyone" UI; not exposed in v1).
//
// `subscribed: true` against a non-existent row inserts; against an existing
// row is a silent no-op (idempotent — calling twice doesn't fail).
// `subscribed: false` deletes if present, no-op if absent.

import type { AlertChannel, AlertSubscriptionEntry, ListAlertSubscriptionsResponse } from '@innovic/shared';
import { and, asc, eq } from 'drizzle-orm';
import { alertSubscriptions } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export async function listMySubscriptions(
  user: AuthContext,
): Promise<ListAlertSubscriptionsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        code: alertSubscriptions.code,
        channel: alertSubscriptions.channel,
        createdAt: alertSubscriptions.createdAt,
      })
      .from(alertSubscriptions)
      .where(
        and(eq(alertSubscriptions.companyId, companyId), eq(alertSubscriptions.userId, user.id)),
      )
      .orderBy(asc(alertSubscriptions.code), asc(alertSubscriptions.channel));

    const subscriptions: AlertSubscriptionEntry[] = rows.map((r) => ({
      code: r.code,
      channel: r.channel as AlertChannel,
      subscribedAt: r.createdAt.toISOString(),
    }));

    return { subscriptions };
  });
}

export interface SetMySubscriptionInput {
  code: string;
  subscribed: boolean;
  channel?: AlertChannel;
}

export async function setMySubscription(
  input: SetMySubscriptionInput,
  user: AuthContext,
): Promise<AlertSubscriptionEntry | null> {
  const companyId = requireCompany(user);
  const channel: AlertChannel = input.channel ?? 'email';

  return withUserContext(user, async (tx) => {
    if (input.subscribed) {
      const existing = await tx
        .select({
          code: alertSubscriptions.code,
          channel: alertSubscriptions.channel,
          createdAt: alertSubscriptions.createdAt,
        })
        .from(alertSubscriptions)
        .where(
          and(
            eq(alertSubscriptions.companyId, companyId),
            eq(alertSubscriptions.userId, user.id),
            eq(alertSubscriptions.code, input.code),
            eq(alertSubscriptions.channel, channel),
          ),
        )
        .limit(1);

      if (existing[0]) {
        return {
          code: existing[0].code,
          channel: existing[0].channel as AlertChannel,
          subscribedAt: existing[0].createdAt.toISOString(),
        };
      }

      const inserted = await tx
        .insert(alertSubscriptions)
        .values({
          companyId,
          userId: user.id,
          code: input.code,
          channel,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({
          code: alertSubscriptions.code,
          channel: alertSubscriptions.channel,
          createdAt: alertSubscriptions.createdAt,
        });

      const row = inserted[0];
      if (!row) throw new Error('insert returned no row');
      return {
        code: row.code,
        channel: row.channel as AlertChannel,
        subscribedAt: row.createdAt.toISOString(),
      };
    }

    await tx
      .delete(alertSubscriptions)
      .where(
        and(
          eq(alertSubscriptions.companyId, companyId),
          eq(alertSubscriptions.userId, user.id),
          eq(alertSubscriptions.code, input.code),
          eq(alertSubscriptions.channel, channel),
        ),
      );
    return null;
  });
}
