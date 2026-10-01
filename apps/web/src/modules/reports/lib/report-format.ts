// Cell rules for the report grid: which columns are numbers, which get a
// total, how a value is printed, and which status words become pills. Moved
// out of routes/run.tsx unchanged in meaning (ERPNext-layout round, 2026-09-26).

import type { ReportColumn, ReportRow } from '@innovic/shared';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { statusText } from '@/lib/status-text';

/** A column is numeric (right-aligned) when the server types it `number`, or —
 *  for an untyped column — when every non-empty value in the result is a JS
 *  number. */
export function isNumericColumn(col: ReportColumn, rows: ReportRow[]): boolean {
  if (col.type === 'number') return true;
  if (col.type !== 'text') return false;
  let seen = false;
  for (const r of rows) {
    const v = r[col.key];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'number') return false;
    seen = true;
  }
  return seen;
}

/** Totals-row rule. A numeric column gets a total only when BOTH hold:
 *   1. every non-empty value in it is a finite number (a stray text value
 *      means the column is not a pure measure), and
 *   2. its key or label names an additive measure — qty / quantity / pcs /
 *      amount / value / total / hours / count / weight;
 *  and it is NOT an identifier, rate, ratio or average — any key/label with
 *  id / code / no. / rate / price / % / pct / percent / avg / average / days /
 *  ratio is skipped, because adding those up gives a meaningless number.
 *  This is a display-only sum of the rows on screen; it feeds nothing else. */
const SUM_WORDS = /(qty|quantity|pcs|amount|amt|value|total|hours|hrs|count|weight|kg)/i;
const NO_SUM_WORDS =
  /(\bid\b|_id$|code|\bno\.?$|_no$|rate|price|%|pct|percent|avg|average|days|ratio)/i;
export function isSummable(col: ReportColumn, rows: ReportRow[]): boolean {
  const name = `${col.key} ${col.label}`;
  if (!SUM_WORDS.test(name) || NO_SUM_WORDS.test(name)) return false;
  return rows.every((r) => {
    const v = r[col.key];
    return v === null || v === undefined || v === '' || Number.isFinite(Number(v));
  });
}

/** A quantity column (key names a qty). Purchase / stock quantities carry up
 *  to 3 decimals since 0172 (KGS / MTR), so they must not be cut to 2 places. */
export function isQtyColumn(col: ReportColumn): boolean {
  return /qty/i.test(col.key);
}

export function formatNumber(num: number, qty = false): string {
  if (num % 1 === 0) return String(num);
  // Qty: up to 3 places, no trailing zeros (12.5, 12.125). Else 2dp as before.
  return qty ? String(Math.round(num * 1000) / 1000) : num.toFixed(2);
}

export function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || raw === '';
}

/** Legacy `_rptTbl` cell display (HTML L20102): whole numbers print bare, other
 *  numbers to 2dp, and any empty/nullish value falls back to an em dash. */
export function formatCell(col: ReportColumn, raw: unknown): string {
  if (isBlank(raw)) return '—';
  if (col.type === 'number') {
    const num = Number(raw);
    if (!Number.isFinite(num)) return String(raw);
    return formatNumber(num, isQtyColumn(col));
  }
  if (typeof raw === 'string' && col.type === 'date') return fmtDate(raw);
  if (typeof raw === 'string' && col.type === 'datetime') return fmtDateTime(raw);
  // A status column carries the stored code (qc_pending); show its label.
  // The pill rule below still reads the raw value.
  if (typeof raw === 'string' && isStatusColumn(col)) {
    if (/^NC\b/.test(col.label) && raw === 'pending') return 'NC Raised';
    return statusText(raw, col.label.toLowerCase());
  }
  // A type column carries the stored code too (component_manufacturing);
  // show the words (Component Manufacturing).
  if (typeof raw === 'string' && isTypeColumn(col)) return statusText(raw);
  return String(raw);
}

/** `*status` columns carry a stored status code. */
export function isStatusColumn(col: ReportColumn): boolean {
  return /status$/i.test(col.key);
}

/** `*_type` / `type` columns carry a stored type code. */
export function isTypeColumn(col: ReportColumn): boolean {
  return /(^|_)type$/i.test(col.key);
}

/** Codes, document numbers and other identifiers — never cut: `*_code`,
 *  `*_no`, `code`, `pol`, `*gstin*`, `*revision*` (Drawing Rev),
 *  `reference` / `*_reference` / `*_ref`, and `so_jc` (SO No. / JC No.). */
export function isCodeColumn(col: ReportColumn): boolean {
  const k = col.key.toLowerCase();
  return (
    /(^|_)(code|no|ref|reference)$/.test(k) ||
    k.includes('gstin') ||
    k.includes('revision') ||
    k === 'pol' ||
    k === 'so_jc'
  );
}

/** The value written to the CSV: the raw value, except that status / type
 *  codes are written as the words the grid shows (ADR-199 Phase 4). */
export function csvValue(col: ReportColumn, raw: unknown): unknown {
  if (typeof raw === 'string' && raw !== '' && (isStatusColumn(col) || isTypeColumn(col))) {
    return formatCell(col, raw);
  }
  return raw;
}

export type StatusTone = 'red' | 'green' | 'blue' | 'amber';

/** Stored status code → pill tone (ADR-199 Phase 4), for `*status` columns.
 *  Matched after the legacy word list below; any `partial*` code is amber. */
const CODE_TONES: Record<string, StatusTone> = {
  complete: 'green',
  completed: 'green',
  closed: 'green',
  accepted: 'green',
  paid: 'green',
  dispatched: 'green',
  pending: 'amber',
  in_progress: 'amber',
  qc_pending: 'amber',
  pending_qc: 'amber',
  at_vendor: 'amber',
  rejected: 'red',
  cancelled: 'red',
  overdue: 'red',
  short_closed: 'red',
  open: 'blue',
  planned: 'blue',
  approved: 'blue',
  draft: 'blue',
};

/** Pill tone for one cell: the legacy word list first (any column), then —
 *  for a status column — the stored-code map. */
export function cellTone(col: ReportColumn, raw: string): StatusTone | undefined {
  const legacy = statusBadge(raw);
  if (legacy || !isStatusColumn(col)) return legacy;
  const code = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (code.startsWith('partial')) return 'amber';
  return CODE_TONES[code];
}

/** Status keyword → pill tone, transcribed from legacy `_rptTbl`
 *  (HTML L20097–20100) — same keywords, same order, no additions. */
export function statusBadge(raw: string): StatusTone | undefined {
  if (['DELAYED', 'ZERO', 'Pending', 'Cancelled', 'NO GRN', 'Not Planned'].includes(raw)) {
    return 'red';
  }
  if (
    [
      'ON TIME',
      'EARLY',
      'Accepted',
      'PO Created',
      'Closed',
      'OK',
      'FULLY RECEIVED',
      'RETURNED',
      'Complete',
    ].includes(raw)
  ) {
    return 'green';
  }
  if (['Approved', 'PARTIAL', 'In Planning', 'Planned'].includes(raw)) return 'blue';
  if (['PENDING', 'AT VENDOR'].includes(raw)) return 'amber';
  return undefined;
}

export function stripBlanks(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
