// SO / JWSO status by day (ADR-325) — the pure rules, no database. The
// service and the unit tests share them, so the rules are tested as shipped.

import {
  ORDER_STATUS_FIGURE_KEYS,
  SO_JWSO_STATUS_MAX_DAYS,
  sfAddDays,
  type DaySource,
  type OrderKind,
  type OrderStatusRow,
  type OrderStatusSummary,
} from '@innovic/shared';

/** Qty sums are numeric(14,3): round so float drift never shows. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** THE one total of a type on a day: Orders + the 11 figures summed (§26.3). */
export function summarise(rows: readonly OrderStatusRow[], kind: OrderKind): OrderStatusSummary {
  const out: OrderStatusSummary = {
    orders: 0,
    totalLines: 0,
    totalPlans: 0,
    totalRc: 0,
    proReleased: 0,
    jcReleased: 0,
    jcNotStarted: 0,
    jcRunning: 0,
    jcClosed: 0,
    proClosed: 0,
    dispatchQty: 0,
    physicalStock: 0,
  };
  for (const r of rows) {
    if (r.orderKind !== kind) continue;
    out.orders += 1;
    for (const k of ORDER_STATUS_FIGURE_KEYS) out[k] += r[k];
  }
  out.dispatchQty = round3(out.dispatchQty);
  out.physicalStock = round3(out.physicalStock);
  return out;
}

/** Days from..to inclusive (both YYYY-MM-DD). */
export function dayCount(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** Why a From→To range is refused, or null when it is fine. */
export function rangeProblem(from: string, to: string, today: string): string | null {
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`)))
    return 'Use real dates (YYYY-MM-DD)';
  if (from > to) return 'From must be on or before To';
  if (to > today) return 'To cannot be after today';
  if (dayCount(from, to) > SO_JWSO_STATUS_MAX_DAYS)
    return `Pick at most ${SO_JWSO_STATUS_MAX_DAYS} days`;
  return null;
}

/** Why one day is refused, or null. */
export function dayProblem(date: string, today: string): string | null {
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return 'Use a real date (YYYY-MM-DD)';
  if (date > today) return 'The date cannot be after today';
  return null;
}

/** today → live; a past day with a saved copy → saved; otherwise none. */
export function daySource(date: string, today: string, hasSaved: boolean): DaySource {
  if (date === today) return 'live';
  return hasSaved ? 'saved' : 'none';
}

/** to, to−1, …, from — newest day first (ADR-318). */
export function daysNewestFirst(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = to; d >= from; d = sfAddDays(d, -1)) out.push(d);
  return out;
}
