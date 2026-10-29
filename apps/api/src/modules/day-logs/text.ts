// Day Log — Working On edited DIRECTLY by the entry's owner (ADR-255, owner
// 2026-10-29). No approval: the text changes at once, and every changed save
// keeps a revision (daily_report_line_text_revisions — Text Rev 0 = first
// save, +1 per changed save). The owner is never told revisions exist, and
// NOTHING about this edit is written to activity_log (readable by every user).
// Also here: the owner marking an entry's replies seen.
//
// §20: the day header lock (lockEntryDay) serialises every write on the day,
// so "next revision number" is read and written under it in ONE statement;
// the unique (line_id, text_rev_no) index is the backstop. The text UPDATE is
// conditional on the updatedAt the screen loaded (§20.4).

import type { DayLogDetail, UpdateDayLogWorkInput } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { assertCanWrite, resolveAccess, viewerOf } from './access';
import { REV_COLS, returning, writeLines } from './entry-write';
import { dayTx, lockEntryDay, requireHeader } from './lock';
import { type DayLogClock, istClock } from './rules';
import { readSnapshot } from './snapshot';
import { guardOwnerWrite, ownerDetailAfter, requireCompany, staleEntryError } from './writes';

/**
 * The revisions one text save adds, reading `w` (the updated line):
 * normally Text Rev max+1 = the new text; on a line that has NO revision yet
 * (should not happen after 0228, kept as a guard) first Rev 0 = the OLD text,
 * saved when the line was, then Rev 1 = the new text.
 */
const revisionsAfter = (oldText: string, newText: string, userId: string) => sql`
  INSERT INTO public.daily_report_line_text_revisions
    (company_id, line_id, text_rev_no, description, saved_at, created_by, updated_by)
  SELECT w.company_id, w.id::uuid, x.n, x.d, x.s, ${userId}::uuid, ${userId}::uuid
  FROM w
  CROSS JOIN LATERAL (
    SELECT COALESCE(MAX(r.text_rev_no), -1) AS m
    FROM public.daily_report_line_text_revisions r
    WHERE r.line_id = w.id::uuid AND r.deleted_at IS NULL) mx
  CROSS JOIN LATERAL (VALUES
    (0, ${oldText}::text, w.created_at, mx.m = -1),
    (GREATEST(mx.m, 0) + 1, ${newText}::text, now(), true)) x(n, d, s, keep)
  WHERE x.keep`;

/** PATCH /day-logs/entries/:id/work — the owner's direct Working On edit. */
export async function updateWork(
  entryId: string,
  input: UpdateDayLogWorkInput,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  return dayTx(async (tx) => {
    // The day lock (§20.3) — owner only: someone else's entry → not found.
    const locked = await lockEntryDay(tx, user, companyId, entryId);
    const eff = await resolveAccess(user, locked.access);
    assertCanWrite(eff);
    const h = requireHeader(locked);
    const snap = await readSnapshot(
      { companyId, viewerId: null, targetId: user.id, date: h.date, replies: true },
      tx,
    );
    guardOwnerWrite(h.date, snap, clock.today);
    const self = snap.lines.find((l) => l.id === entryId);
    if (!self || !self.fromTime) throw new NotFoundError('Entry not found');
    // Old Break / Others (leave) rows keep their text.
    if (self.kind !== 'work') throw new ValidationError('This row cannot be edited');
    if (new Date(self.updatedAt).getTime() !== new Date(input.updatedAt).getTime()) {
      throw staleEntryError(self.updatedAt);
    }
    const text = input.description.trim();
    if (!text) throw new ValidationError('Write what you worked on');
    if (text === self.description) throw new ValidationError('Nothing changed');
    // §20.4 — only over what was loaded. A waiting Start / Stop / SO edit
    // keeps carrying the live text (approval never copies it — ADR-255).
    const [w] = await writeLines(
      tx,
      h,
      user,
      sql`
      UPDATE public.daily_report_lines
      SET description = ${text},
          pending_description = CASE WHEN pending_at IS NULL THEN pending_description ELSE ${text} END,
          updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${entryId}::uuid AND deleted_at IS NULL
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${input.updatedAt}::timestamptz)
      RETURNING ${returning(h)}, ${REV_COLS}`,
      revisionsAfter(self.description, text, user.id),
    );
    if (!w) throw new ConflictError('This entry was changed — reload and redo your change');
    // No activity_log row (ADR-255).
    const lines = snap.lines.map((l) =>
      l.id === entryId
        ? {
            ...l,
            description: text,
            updatedAt: w.updatedAt,
            pending: l.pending ? { ...l.pending, description: text } : null,
          }
        : l,
    );
    return ownerDetailAfter(snap, h, lines, viewerOf(user, eff), clock);
  });
}

/**
 * POST /day-logs/entries/:id/replies/seen — the owner opened the entry: every
 * reply not yet seen gets seen_at = now, ONE conditional statement (a reply
 * already seen is left alone, so a second call changes nothing). The day
 * header is bumped only when something changed, so the other screens
 * (the Super Admin's, the 🔔) refresh.
 */
export async function markRepliesSeen(
  entryId: string,
  user: AuthContext,
): Promise<{ seen: number }> {
  const companyId = requireCompany(user);
  return dayTx(async (tx) => {
    // Owner only: the lock finds the line only on the caller's own day.
    const locked = await lockEntryDay(tx, user, companyId, entryId);
    await resolveAccess(user, locked.access);
    const h = requireHeader(locked);
    const [r] = (await tx.execute(sql`
      WITH s AS (
        UPDATE public.daily_report_line_replies
        SET seen_at = now()
        WHERE line_id = ${entryId}::uuid AND company_id = ${companyId}::uuid
          AND seen_at IS NULL AND deleted_at IS NULL
        RETURNING 1),
      t AS (
        UPDATE public.daily_reports SET updated_at = now(), updated_by = ${user.id}::uuid
        WHERE id = ${h.id}::uuid AND EXISTS (SELECT 1 FROM s)
        RETURNING 1)
      SELECT (SELECT count(*) FROM s)::int AS seen, (SELECT count(*) FROM t)::int AS touched
    `)) as unknown as Array<{ seen: number }>;
    return { seen: Number(r?.seen ?? 0) };
  });
}
