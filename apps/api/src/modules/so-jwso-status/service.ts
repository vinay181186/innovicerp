// SO / JWSO status by day (ADR-325) — the two read routes.
//
//   getDays(from, to) → one SO and one JWSO summary per day, newest first.
//   getDay(date)      → one row per SO and per JWSO on that day + the totals.
//
// Today (IST) is worked out live by figures.ts (the one reader). A past day is
// read from so_status_snapshots (the one writer: snapshot-job.ts). A past day
// with no saved rows is `none` — never zeros.
//
// Access: Super Admin, or View on 'sojwstatus_view' (Reports). Checked before
// any SQL; the caller's access is read once per request (ADR-229).

import {
  SO_JWSO_STATUS_FORM,
  effectiveFormPerms,
  sfTodayIst,
  type OrderStatusRow,
  type SoJwsoStatusDayDetail,
  type SoJwsoStatusDaysQuery,
  type SoJwsoStatusDaysResponse,
} from '@innovic/shared';
import { and, between, eq, isNull, sql } from 'drizzle-orm';
import { soStatusSnapshots } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, ValidationError } from '../../lib/errors';
import { getMyAccess } from '../access-control/service';
import { dayProblem, daySource, daysNewestFirst, rangeProblem, summarise } from './day-rules';
import { loadOrderStatusRows } from './figures';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

async function requireView(user: AuthContext): Promise<void> {
  if (user.role === 'admin') return;
  const eff = await getMyAccess(user);
  if (!effectiveFormPerms(eff, SO_JWSO_STATUS_FORM).view) {
    throw new AuthorizationError('You do not have access to SO / JWSO Status');
  }
}

/** The snapshot columns as an OrderStatusRow (+ the day and when it was taken). */
const SNAP_COLS = {
  snapDate: soStatusSnapshots.snapDate,
  takenAt: soStatusSnapshots.takenAt,
  orderKind: soStatusSnapshots.orderKind,
  orderId: soStatusSnapshots.orderId,
  orderCode: soStatusSnapshots.orderCode,
  totalLines: soStatusSnapshots.totalLines,
  totalPlans: soStatusSnapshots.totalPlans,
  totalRc: soStatusSnapshots.totalRc,
  proReleased: soStatusSnapshots.proReleased,
  jcReleased: soStatusSnapshots.jcReleased,
  jcNotStarted: soStatusSnapshots.jcNotStarted,
  jcRunning: soStatusSnapshots.jcRunning,
  jcClosed: soStatusSnapshots.jcClosed,
  proClosed: soStatusSnapshots.proClosed,
  dispatchQty: soStatusSnapshots.dispatchQty,
  physicalStock: soStatusSnapshots.physicalStock,
};

type SnapRow = OrderStatusRow & { snapDate: string; takenAt: Date };

/** Saved rows of the company between two days (one query). Newest order
 *  first, by the order's own Created On (ADR-318). */
async function loadSaved(
  tx: DbTransaction,
  companyId: string,
  from: string,
  to: string,
): Promise<SnapRow[]> {
  const rows = await tx
    .select(SNAP_COLS)
    .from(soStatusSnapshots)
    .where(
      and(
        eq(soStatusSnapshots.companyId, companyId),
        between(soStatusSnapshots.snapDate, from, to),
        isNull(soStatusSnapshots.deletedAt),
      ),
    )
    .orderBy(
      sql`(SELECT COALESCE(
             (SELECT so.created_at FROM public.sales_orders so WHERE so.id = ${soStatusSnapshots.orderId}),
             (SELECT jw.created_at FROM public.job_work_orders jw WHERE jw.id = ${soStatusSnapshots.orderId})
           )) DESC NULLS LAST`,
      sql`${soStatusSnapshots.orderId} DESC`,
    );
  return rows as SnapRow[];
}

const maxTakenAt = (rows: readonly SnapRow[]): string | null => {
  let max: Date | null = null;
  for (const r of rows) if (!max || r.takenAt > max) max = r.takenAt;
  return max ? max.toISOString() : null;
};

/** The figure fields only — saved rows carry snapDate / takenAt as well. */
const toRow = (r: SnapRow): OrderStatusRow => ({
  orderKind: r.orderKind,
  orderId: r.orderId,
  orderCode: r.orderCode,
  totalLines: r.totalLines,
  totalPlans: r.totalPlans,
  totalRc: r.totalRc,
  proReleased: r.proReleased,
  jcReleased: r.jcReleased,
  jcNotStarted: r.jcNotStarted,
  jcRunning: r.jcRunning,
  jcClosed: r.jcClosed,
  proClosed: r.proClosed,
  dispatchQty: r.dispatchQty,
  physicalStock: r.physicalStock,
});

export async function getDays(
  user: AuthContext,
  query: SoJwsoStatusDaysQuery,
): Promise<SoJwsoStatusDaysResponse> {
  const companyId = requireCompany(user);
  const today = sfTodayIst();
  const problem = rangeProblem(query.from, query.to, today);
  if (problem) throw new ValidationError(problem);
  await requireView(user);

  return withUserContext(user, async (tx) => {
    const saved = await loadSaved(tx, companyId, query.from, query.to);
    const live = query.to === today ? await loadOrderStatusRows(tx, companyId) : [];
    const takenNow = new Date().toISOString();

    const byDay = new Map<string, SnapRow[]>();
    for (const r of saved) {
      const arr = byDay.get(r.snapDate);
      if (arr) arr.push(r);
      else byDay.set(r.snapDate, [r]);
    }

    const days = daysNewestFirst(query.from, query.to).map((date) => {
      const dayRows = byDay.get(date) ?? [];
      const source = daySource(date, today, dayRows.length > 0);
      if (source === 'live') {
        return {
          date,
          source,
          takenAt: takenNow,
          so: summarise(live, 'SO'),
          jwso: summarise(live, 'JWSO'),
        };
      }
      if (source === 'none') return { date, source, takenAt: null, so: null, jwso: null };
      const rows = dayRows.map(toRow);
      return {
        date,
        source,
        takenAt: maxTakenAt(dayRows),
        so: summarise(rows, 'SO'),
        jwso: summarise(rows, 'JWSO'),
      };
    });
    return { today, days };
  });
}

export async function getDay(user: AuthContext, date: string): Promise<SoJwsoStatusDayDetail> {
  const companyId = requireCompany(user);
  const today = sfTodayIst();
  const problem = dayProblem(date, today);
  if (problem) throw new ValidationError(problem);
  await requireView(user);

  return withUserContext(user, async (tx) => {
    let rows: OrderStatusRow[];
    let takenAt: string | null;
    let source: SoJwsoStatusDayDetail['source'];
    if (date === today) {
      rows = await loadOrderStatusRows(tx, companyId);
      takenAt = new Date().toISOString();
      source = 'live';
    } else {
      const saved = await loadSaved(tx, companyId, date, date);
      source = daySource(date, today, saved.length > 0);
      rows = saved.map(toRow);
      takenAt = maxTakenAt(saved);
    }
    if (source === 'none') {
      return {
        date,
        today,
        source,
        takenAt: null,
        soRows: [],
        jwsoRows: [],
        soTotal: null,
        jwsoTotal: null,
      };
    }
    return {
      date,
      today,
      source,
      takenAt,
      soRows: rows.filter((r) => r.orderKind === 'SO'),
      jwsoRows: rows.filter((r) => r.orderKind === 'JWSO'),
      soTotal: summarise(rows, 'SO'),
      jwsoTotal: summarise(rows, 'JWSO'),
    };
  });
}
