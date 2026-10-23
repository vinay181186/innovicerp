// ADR-250 — small pure helpers shared by the per-person home builders:
// India-time days (CLAUDE.md §6.5 — never CURRENT_DATE / a UTC slice), the
// status cell + tone of a row, and the page that opens a document.

import { docNavPage, type DashTone, type DashText } from '@innovic/shared';

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** The India-time calendar day of an instant, YYYY-MM-DD. */
export function istDateOf(at: Date | number = Date.now()): string {
  const ms = typeof at === 'number' ? at : at.getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today in India time, YYYY-MM-DD. */
export function istToday(now: Date | number = Date.now()): string {
  return istDateOf(now);
}

/** YYYY-MM-DD plus `days` (negative = back). Pure calendar arithmetic. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "25-Oct" — the short date the status cell prints. */
export function shortDate(day: string): string {
  const m = Number(day.slice(5, 7));
  return `${day.slice(8, 10)}-${MONTHS[m - 1] ?? ''}`;
}

/** "1 day" / "6 days" — the one pluraliser the home uses. */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The status cell and its colour, from the row's due date (if it has one)
 *  or else how long it has waited since `since`. Late = due before today,
 *  the same test every list query uses for its `is_late` column. */
export function statusFor(
  due: string | null,
  since: string | null,
  today: string,
): { statusLabel: string; tone: DashTone } {
  if (due) {
    const d = dayDiff(today, due);
    if (d < 0) return { statusLabel: `${plural(-d, 'day')} late`, tone: 'late' };
    if (d === 0) return { statusLabel: 'due today', tone: 'due' };
    return { statusLabel: `due ${shortDate(due)}`, tone: 'ok' };
  }
  if (since) {
    const age = Math.max(0, dayDiff(since, today));
    return { statusLabel: age === 0 ? 'today' : plural(age, 'day'), tone: 'due' };
  }
  return { statusLabel: '', tone: 'none' };
}

/** "running 2h 10m" — an op still on the machine; late once it has run
 *  longer than its expected time (the old work-list overrun rule). */
export function runningStatus(
  elapsedMin: number,
  overrun: boolean,
): { statusLabel: string; tone: DashTone } {
  const m = Math.max(0, Math.round(elapsedMin));
  const h = Math.floor(m / 60);
  const label = h > 0 ? `running ${h}h ${m % 60}m` : `running ${m}m`;
  return { statusLabel: label, tone: overrun ? 'late' : 'ok' };
}

/** The page that opens a document named by its activity_log entity, or null
 *  when the ERP has no page for it (the number is then shown as text). */
export function entityHref(entity: string, id: string | null, code: string | null): string | null {
  if (!id) return null;
  switch (entity) {
    case 'PurchaseRequest':
      return docNavPage('purchase-request', id);
    case 'PurchaseOrder':
      return docNavPage('purchase-order', id);
    case 'GoodsReceiptNote':
      return docNavPage('grn', id);
    case 'SalesOrder':
      return docNavPage('sales-order', id);
    case 'JobCard':
      return docNavPage('job-card', id);
    case 'NonConformance':
      return docNavPage('nc', id);
    case 'BomMaster':
      return docNavPage('bom-master', id);
    case 'Invoice':
      return docNavPage('invoice', id);
    case 'Plan':
      return docNavPage('plan', id);
    case 'ProductionOrder':
      return docNavPage('production-order', id);
    case 'JobWorkOrder':
      return docNavPage('job-work-order', id);
    case 'DeliveryChallan':
      return docNavPage('delivery-challan', id);
    case 'PartyGrn':
      // Party GRN has no detail page: its list opens on a search for the
      // number (the same link the QC Call Register uses), so it needs the
      // code, not the id — the one kind docNavPage cannot express.
      return code ? `/party-grn?search=${encodeURIComponent(code)}` : '/party-grn';
    default:
      return null;
  }
}

/** A document number as a text part: a code with its page, or plain text. */
export function codePart(code: string, href: string | null): DashText[number] {
  return href ? { code, href } : { text: code };
}

export const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
export const str = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
