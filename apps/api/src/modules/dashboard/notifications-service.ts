// ADR-264 — the bell: notifications with a per-item read state.
// The events, rights and wording are personal/notifications.ts (ADR-250) —
// called with the bell's options: the last NOTIFICATION_DAYS IST days, no
// "document still open" filter (it is a history). The caller's own events are
// never notes; admins / Full Access get none (Day Log replies still come).
// Wording: a note whose next step is still open keeps its call to action
// ("— waiting for your approval"); one already done reads as the past fact
// ("Jinal raised IN-PO-0421"). Only the notes returned are worded, with one
// "still open?" read per kind of next step (no per-note query).
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
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { listPoApprovalInbox } from '../purchase-orders/approval-inbox';
import { hasTick, loadAccess } from './access';
import {
  bellCandidates,
  isStillOpen,
  markSeenSql,
  noteText,
  type NoteWithActor,
  openSets,
  readNoteCandidates,
} from './personal/notifications';
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
  const c = { cid, today: istToday(), myName: '' };
  // ADR-264 — "waiting for your approval" on a PO follows the approvals
  // inbox's own rule for this caller (approval ceiling, approver list, own
  // POs). The access check opens its own transaction, so it runs first.
  const canApprovePo =
    hasTick(a, 'po_create', 'approve') && (await hasFormAccess(user, 'po_create', 'approve'));
  const poInbox = canApprovePo
    ? async (tx: DbTransaction) =>
        new Set(
          (await listPoApprovalInbox(tx, cid, user, { canApprove: true, showMoney: false })).map(
            (r) => r.id,
          ),
        )
    : async () => new Set<string>();
  return withUserContext(user, async (tx) => {
    const { replyNotes, cands, seenAt } = await readNoteCandidates(tx, a, c, user.id, {
      days: NOTIFICATION_DAYS,
      scan: BELL_SCAN_EVENTS,
    });
    const kept = bellCandidates(cands, BELL_MAX_NOTES - replyNotes.length);
    // Read state needs every note (unread / total are over the window); the
    // words are built below for the returned notes only.
    const notes: NoteWithActor[] = [
      ...replyNotes,
      ...kept.map(({ ev, rule, key }) => ({
        key,
        ts: ev.ts.toISOString(),
        tone: rule.tone,
        actorName: ev.actor,
        text: [],
        unseen: false,
      })),
    ];
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
    const res = toNotificationsResponse(applyReadState(notes, explicit, seenAt), query);

    // Word the returned notes: Day Log replies carry their own text; events
    // read "still open?" once per kind of next step (approvals inbox not
    // loaded — POs ask the inbox's own rule via poInbox, Route Cards the
    // approval list's query).
    const shown = new Set(res.items.map((n) => n.key));
    const shownCands = kept.filter((k) => shown.has(k.key));
    const open = shownCands.length
      ? await openSets(tx, shownCands, c, user.id, null, poInbox)
      : new Map();
    const textByKey = new Map<string, NoteWithActor['text']>([
      ...replyNotes.map((n) => [n.key, n.text] as const),
      ...shownCands.map((k) => [k.key, noteText(k.ev, k.rule, isStillOpen(open, k))] as const),
    ]);
    return {
      ...res,
      items: res.items.map((n) => ({ ...n, text: textByKey.get(n.key) ?? n.text })),
    };
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
