// Day Log — reading one day. (Submit / Reopen / Leave were removed with the
// simple sheet, owner 2026-10-27: a day has no status to change any more.)

import type { DayLogDetail, DayLogQuery } from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import { resolveAccess, viewerOf, visibleUser } from './access';
import { blockedByOf, detailOf } from './detail';
import { type DayLogClock, istClock } from './rules';
import { readSnapshot } from './snapshot';
import { requireCompany } from './writes';

/** GET a day. Creates nothing: a day with no header reads with no entries.
 *  Someone else's day → not found unless allowed. ONE statement: the
 *  viewer's access and the whole day (snapshot.ts), judged in memory. */
export async function getDay(
  query: DayLogQuery,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  const date = query.date ?? clock.today;
  const snap = await readSnapshot({
    companyId,
    viewerId: user.id,
    targetId: query.userId ?? user.id,
    date,
  });
  const v = viewerOf(user, await resolveAccess(user, snap.access));
  const target = visibleUser(v, snap.target);
  return detailOf(snap, blockedByOf(snap, date), v, target, date, clock);
}
