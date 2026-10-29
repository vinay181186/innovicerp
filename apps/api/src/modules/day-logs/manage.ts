// Day Log — reading one day. (Submit / Reopen / Leave were removed with the
// simple sheet, owner 2026-10-27: a day has no status to change any more.)

import type { DayLogDetail, DayLogOwnReply, DayLogQuery } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { resolveAccess, viewerOf, visibleUser } from './access';
import { repliesOfLinesJson } from './day';
import { blockedByOf, detailOf } from './detail';
import { type DayLogClock, istClock } from './rules';
import { readSnapshot } from './snapshot';
import { requireCompany } from './writes';

/** GET a day. Creates nothing: a day with no header reads with no entries.
 *  Someone else's day → not found unless allowed. ONE statement: the
 *  viewer's access and the whole day (snapshot.ts), judged in memory.
 *  ADR-255 — replies go only to the entry's owner (read in that statement)
 *  and a Super Admin (one more statement, only when they look at someone
 *  else's day that has rows); anyone else gets none (detailOf). */
export async function getDay(
  query: DayLogQuery,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  const date = query.date ?? clock.today;
  const targetId = query.userId ?? user.id;
  const own = targetId === user.id;
  const snap = await readSnapshot({ companyId, viewerId: user.id, targetId, date, replies: own });
  const v = viewerOf(user, await resolveAccess(user, snap.access));
  const target = visibleUser(v, snap.target);
  if (!own && v.isSuper && snap.lines.length > 0) {
    const [r] = (await db.execute(
      sql`SELECT ${repliesOfLinesJson(
        companyId,
        snap.lines.map((l) => l.id),
      )} AS replies`,
    )) as unknown as Array<{ replies: Record<string, DayLogOwnReply[]> | null }>;
    const by = r?.replies ?? {};
    snap.lines = snap.lines.map((l) => ({ ...l, replies: by[l.id] ?? [] }));
  }
  return detailOf(snap, blockedByOf(snap, date), v, target, date, clock);
}
