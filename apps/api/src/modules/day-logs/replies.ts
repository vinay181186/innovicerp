// Day Log — Super Admin replies on someone's entry (ADR-255, owner
// 2026-10-29). Many per entry, each editable by its author only. Only a Super Admin (Full Access
// / role admin — access.ts isSuper) may send or edit one; an Auditor never
// (assertCanWrite); never on one's own entry. Editing resets seen_at, so the
// owner is told again (Home Notifications, dashboard/personal/day-log-replies.ts).
//
// §20: both run under the day header lock of the entry (lock.ts); an edit is
// conditional on the reply's updatedAt as loaded (§20.4); each write bumps the
// day header in the same statement so every screen refreshes (Realtime).

import type { DayLogAdminReply, EditDayLogReplyInput, SendDayLogReplyInput } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { type DayUser, assertCanWrite, resolveAccess, viewerOf } from './access';
import { type DayHeader, iso, ts } from './day';
import { type Locked, dayTx, lockAnyEntryDay, lockReplyDay, requireHeader } from './lock';
import { requireCompany } from './writes';

/** The admin shape of a reply, as columns of `rp` (author: users `au`). */
export const ADMIN_REPLY_COLS = sql`
  rp.id::text AS id, rp.body, COALESCE(au.full_name, au.email) AS author_name,
  ${ts('rp.sent_at')} AS sent_at,
  CASE WHEN rp.edited_at IS NULL THEN NULL ELSE ${ts('rp.edited_at')} END AS edited_at,
  CASE WHEN rp.seen_at IS NULL THEN NULL ELSE ${ts('rp.seen_at')} END AS seen_at,
  ${ts('rp.updated_at')} AS updated_at`;

export const toAdminReply = (r: Record<string, unknown>): DayLogAdminReply => ({
  id: String(r['id']),
  body: String(r['body']),
  authorName: String(r['author_name'] ?? ''),
  sentAt: String(r['sent_at']),
  editedAt: (r['edited_at'] as string | null) ?? null,
  seenAt: (r['seen_at'] as string | null) ?? null,
  updatedAt: String(r['updated_at']),
});

/** What a reply write returns into `w` (ADMIN_REPLY_COLS reads them). */
const RETURN_COLS = sql`id, body, sent_at, edited_at, seen_at, updated_at, created_by`;

/** The caller may reply on this person's entry: a Super Admin, not on their own. */
async function guardReplier(
  user: AuthContext,
  locked: Locked & { target: DayUser | null },
): Promise<{ h: DayHeader; target: DayUser }> {
  const eff = await resolveAccess(user, locked.access);
  assertCanWrite(eff); // an Auditor never
  const v = viewerOf(user, eff);
  const h = requireHeader(locked);
  const target = locked.target;
  if (!target) throw new NotFoundError('Entry not found');
  if (!v.isSuper) throw new AuthorizationError('Only a Super Admin can reply on a Day Log entry');
  if (target.id === v.userId) {
    throw new AuthorizationError('You cannot reply on your own Day Log entry');
  }
  return { h, target };
}

/** `change` (… RETURNING rp-like columns as `w`) + the header bump, ONE statement. */
async function writeReply(
  tx: DbTransaction,
  h: DayHeader,
  user: AuthContext,
  change: SQL,
): Promise<DayLogAdminReply | null> {
  const rows = (await tx.execute(sql`
    WITH w AS (${change}),
         t AS (UPDATE public.daily_reports SET updated_at = now(), updated_by = ${user.id}::uuid
               WHERE id = ${h.id}::uuid AND EXISTS (SELECT 1 FROM w) RETURNING 1)
    SELECT ${ADMIN_REPLY_COLS}, (SELECT count(*) FROM t)::int AS touched
    FROM w rp JOIN public.users au ON au.id = rp.created_by
  `)) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? toAdminReply(rows[0]) : null;
}

/** POST /day-logs/entries/:id/replies */
export async function sendReply(
  entryId: string,
  input: SendDayLogReplyInput,
  user: AuthContext,
): Promise<DayLogAdminReply> {
  const companyId = requireCompany(user);
  const body = input.body.trim();
  if (!body) throw new ValidationError('Write the reply');
  return dayTx(async (tx) => {
    const locked = await lockAnyEntryDay(tx, user, companyId, entryId);
    const { h } = await guardReplier(user, locked);
    const reply = await writeReply(
      tx,
      h,
      user,
      sql`
      INSERT INTO public.daily_report_line_replies
        (company_id, line_id, body, created_by, updated_by)
      VALUES (${companyId}::uuid, ${entryId}::uuid, ${body}, ${user.id}::uuid, ${user.id}::uuid)
      RETURNING ${RETURN_COLS}`,
    );
    if (!reply) throw new ConflictError('The reply could not be saved — reload and try again');
    return reply;
  });
}

/** PATCH /day-logs/replies/:id — a new text; seen_at back to NULL. */
export async function editReply(
  replyId: string,
  input: EditDayLogReplyInput,
  user: AuthContext,
): Promise<DayLogAdminReply> {
  const companyId = requireCompany(user);
  const body = input.body.trim();
  if (!body) throw new ValidationError('Write the reply');
  return dayTx(async (tx) => {
    const locked = await lockReplyDay(tx, user, companyId, replyId);
    const { h } = await guardReplier(user, locked);
    const [cur] = (await tx.execute(sql`
      SELECT rp.body, rp.updated_at, rp.created_by::text AS created_by
      FROM public.daily_report_line_replies rp
      WHERE rp.id = ${replyId}::uuid AND rp.company_id = ${companyId}::uuid
        AND rp.deleted_at IS NULL
    `)) as unknown as Array<{ body: string; updated_at: unknown; created_by: string }>;
    if (!cur) throw new NotFoundError('Reply not found');
    if (cur.created_by !== user.id) {
      throw new AuthorizationError('Only the person who sent this reply can edit it');
    }
    if (new Date(iso(cur.updated_at)!).getTime() !== new Date(input.updatedAt).getTime()) {
      throw new ConflictError('This reply was changed — reload and redo your change');
    }
    if (cur.body === body) throw new ValidationError('Nothing changed');
    // §20.4 — only over what was loaded.
    const reply = await writeReply(
      tx,
      h,
      user,
      sql`
      UPDATE public.daily_report_line_replies
      SET body = ${body}, edited_at = now(), seen_at = NULL,
          updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${replyId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
        AND created_by = ${user.id}::uuid
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${input.updatedAt}::timestamptz)
      RETURNING ${RETURN_COLS}`,
    );
    if (!reply) throw new ConflictError('This reply was changed — reload and redo your change');
    return reply;
  });
}
