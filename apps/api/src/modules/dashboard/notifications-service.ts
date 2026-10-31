// ADR-264 — the bell: notifications with a per-item read state.
// The events, rights and wording are personal/notifications.ts (ADR-250) —
// called with the bell's options: the last NOTIFICATION_DAYS IST days, no
// "document still open" filter (it is a history). The caller's own events are
// never notes; admins / Full Access get none (Day Log replies still come).
//
// Read state, per item: an explicit notification_reads row (is_read) wins;
// otherwise read = event time on or before the caller's notifications_seen_at.
// Writes touch only the caller's own rows (company_id + user_id from the login).

import {
  type MarkAllNotificationsReadInput,
  type MarkNotificationsReadInput,
  NOTIFICATION_DAYS,
  type NotificationItem,
  type NotificationsQuery,
  type NotificationsResponse,
  notificationsQuerySchema,
} from '@innovic/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { notificationReads } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { loadAccess } from './access';
import { buildNotifications, markSeenSql, type NoteWithActor } from './personal/notifications';
import { istToday } from './personal/util';

/** Bell window reads: every note in the window, so unread / total are exact. */
const BELL_MAX_NOTES = 1000;
const BELL_SCAN_EVENTS = 2000;

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** Pure: read state of every note, newest first. `explicit` = note_key →
 *  is_read from notification_reads; `seenAt` = notifications_seen_at. */
export function applyReadState(
  notes: readonly NoteWithActor[],
  explicit: ReadonlyMap<string, boolean>,
  seenAt: string | null,
): NotificationItem[] {
  const seenMs = seenAt ? Date.parse(seenAt) : NaN;
  return notes
    .map((n) => ({
      key: n.key,
      ts: n.ts,
      tone: n.tone,
      actorName: n.actorName,
      text: n.text,
      read: explicit.get(n.key) ?? (!Number.isNaN(seenMs) && Date.parse(n.ts) <= seenMs),
    }))
    .sort((x, y) => Date.parse(y.ts) - Date.parse(x.ts));
}

/** Pure: the response — unread / total over the whole window, items by filter. */
export function toNotificationsResponse(
  items: readonly NotificationItem[],
  query: NotificationsQuery,
): NotificationsResponse {
  const { filter, limit } = notificationsQuerySchema.parse(query);
  const shown =
    filter === 'all' ? items : items.filter((n) => (filter === 'read' ? n.read : !n.read));
  return {
    items: shown.slice(0, limit),
    unread: items.filter((n) => !n.read).length,
    total: items.length,
  };
}

export async function getNotifications(
  user: AuthContext,
  query: NotificationsQuery,
): Promise<NotificationsResponse> {
  const cid = requireCompany(user);
  const a = await loadAccess(user);
  return withUserContext(user, async (tx) => {
    const { items: notes, seenAt } = await buildNotifications(
      tx,
      a,
      { cid, today: istToday(), myName: '' },
      user.id,
      null, // approvals answer "still open?" only — the bell does not ask it
      { days: NOTIFICATION_DAYS, openOnly: false, max: BELL_MAX_NOTES, scan: BELL_SCAN_EVENTS },
    );
    const keys = notes.map((n) => n.key);
    const rows = keys.length
      ? await tx
          .select({ key: notificationReads.noteKey, isRead: notificationReads.isRead })
          .from(notificationReads)
          .where(
            and(
              eq(notificationReads.companyId, cid),
              eq(notificationReads.userId, user.id),
              isNull(notificationReads.deletedAt),
              inArray(notificationReads.noteKey, keys),
            ),
          )
      : [];
    const explicit = new Map(rows.map((r) => [r.key, r.isRead]));
    return toNotificationsResponse(applyReadState(notes, explicit, seenAt), query);
  });
}

/** POST /dashboard/notifications/read — mark these events read / unread.
 *  One upsert; sending the same request twice leaves the same rows. */
export async function markNotificationsRead(
  input: MarkNotificationsReadInput,
  user: AuthContext,
): Promise<{ updated: number }> {
  const cid = requireCompany(user);
  // One row per key (last one wins) — ON CONFLICT may not touch a row twice.
  const byKey = new Map(input.items.map((i) => [i.key, i.ts]));
  return withUserContext(user, async (tx) => {
    await tx
      .insert(notificationReads)
      .values(
        [...byKey].map(([key, ts]) => ({
          companyId: cid,
          userId: user.id,
          noteKey: key,
          noteTs: new Date(ts),
          isRead: input.read,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      )
      .onConflictDoUpdate({
        target: [notificationReads.companyId, notificationReads.userId, notificationReads.noteKey],
        targetWhere: sql`deleted_at is null`,
        set: {
          isRead: sql`excluded.is_read`,
          noteTs: sql`excluded.note_ts`,
          updatedBy: user.id,
          updatedAt: sql`now()`,
        },
      });
    return { updated: byKey.size };
  });
}

/** POST /dashboard/notifications/read-all — ONE transaction: the seen time
 *  moves forward to `upTo` (never back, never past now — markSeenSql), and
 *  this user's explicit rows up to that time become read. Events after `upTo`
 *  stay unread. */
export async function markAllNotificationsRead(
  input: MarkAllNotificationsReadInput,
  user: AuthContext,
): Promise<{ seenAt: string }> {
  const cid = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const seen = (await tx.execute(markSeenSql(cid, user.id, input.upTo))) as unknown as Array<{
      setting_value: string;
    }>;
    await tx
      .update(notificationReads)
      .set({ isRead: true, updatedBy: user.id, updatedAt: sql`now()` })
      .where(
        and(
          eq(notificationReads.companyId, cid),
          eq(notificationReads.userId, user.id),
          isNull(notificationReads.deletedAt),
          eq(notificationReads.isRead, false),
          sql`${notificationReads.noteTs} <= LEAST(${input.upTo}::timestamptz, now())`,
        ),
      );
    return { seenAt: new Date(seen[0]!.setting_value).toISOString() };
  });
}
