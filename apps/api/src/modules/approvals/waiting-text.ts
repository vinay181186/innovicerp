// ADR-265 — the pure pieces of the Approvals waiting list and history: the
// Approval Type labels and their menu order, the one-line "what is asked"
// texts, the counts and the oldest-first order. No database, no access —
// unit-tested on their own (waiting-text.unit.test.ts).

import {
  type ApprovalTypeCount,
  CANCEL_DOC_LABELS,
  type CancelDocType,
  DOCUMENT_EDIT_ENTITIES,
  DOCUMENT_EDIT_LABEL,
  type DocumentEditEntity,
} from '@innovic/shared';
import { timestampMs } from '../../lib/edit-conflict';
import { fmtDate } from '../../lib/format-date';

/** typeKey of an edit request on one document type. */
export const editTypeKey = (entity: DocumentEditEntity): string => `edit:${entity}`;

/** Every Approval Type in menu order: po, rc, logEntry, edit:* (in
 *  DOCUMENT_EDIT_ENTITIES order), cancel, dayLog. */
export const APPROVAL_TYPE_ORDER: readonly string[] = [
  'po',
  'rc',
  'logEntry',
  ...DOCUMENT_EDIT_ENTITIES.map(editTypeKey),
  'cancel',
  'dayLog',
];

const FIXED_LABELS: Readonly<Record<string, string>> = {
  po: 'PO',
  rc: 'Route Card (New)',
  logEntry: 'Op Entry time change',
  cancel: 'Cancel Request',
  dayLog: 'Day Log edit',
};

/** The Approval Type as shown for a typeKey. */
export function typeLabelOf(typeKey: string): string {
  const fixed = FIXED_LABELS[typeKey];
  if (fixed) return fixed;
  if (typeKey.startsWith('edit:')) {
    const entity = typeKey.slice(5) as DocumentEditEntity;
    // "PO Edit" / "PR Edit" already say Edit → "PO change", not "PO Edit change".
    const label = (DOCUMENT_EDIT_LABEL[entity] ?? entity).replace(/ Edit$/, '');
    return `${label} change`;
  }
  return typeKey;
}

/** "₹ 1,20,000" — whole rupees, Indian grouping (as purchase-orders/service.ts). */
export const formatRupees = (amount: number): string =>
  `₹ ${Math.round(amount).toLocaleString('en-IN')}`;

/** "Release PO", plus " · ₹ <amount>" only when the caller may see the value. */
export const poRequestText = (amount: number | null): string =>
  amount == null ? 'Release PO' : `Release PO · ${formatRupees(amount)}`;

export const RC_REQUEST_TEXT = 'New Route Card';
const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : '—');

/** "Start 08:00 → 06:00 · forgot to log", or with the dates when the day
 *  moves: "31-Oct-2026 08:00 → 30-Oct-2026 06:00 · forgot to log". */
export function timeChangeRequestText(t: {
  prevLogDate: string;
  prevStartTime: string | null;
  requestedLogDate: string;
  requestedStartTime: string | null;
  reason: string | null;
}): string {
  const ask =
    t.prevLogDate === t.requestedLogDate
      ? `Start ${hhmm(t.prevStartTime)} → ${hhmm(t.requestedStartTime)}`
      : `${fmtDate(t.prevLogDate)} ${hhmm(t.prevStartTime)} → ${fmtDate(t.requestedLogDate)} ${hhmm(t.requestedStartTime)}`;
  return t.reason?.trim() ? `${ask} · ${t.reason.trim()}` : ask;
}

/** "1 field changed" / "3 fields changed". */
export const fieldsChangedText = (n: number): string =>
  `${n} ${n === 1 ? 'field' : 'fields'} changed`;

/** "Cancel Purchase Order · wrong vendor". */
export const cancelRequestText = (docType: CancelDocType, reason: string): string =>
  `Cancel ${CANCEL_DOC_LABELS[docType] ?? docType} · ${reason}`;

export interface DayLogSide {
  fromTime: string | null;
  toTime: string | null;
  description: string;
  orderCode: string | null;
}

const orDash = (v: string | null | undefined): string => (v == null || v === '' ? '—' : v);

/** "Stop 17:30 → 18:15" — each part only when it differs; "No change" when
 *  nothing differs (an edit re-sent with its old values). */
export function dayLogRequestText(current: DayLogSide, proposed: DayLogSide): string {
  const parts: string[] = [];
  if ((current.fromTime ?? '') !== (proposed.fromTime ?? '')) {
    parts.push(`Start ${orDash(current.fromTime)} → ${orDash(proposed.fromTime)}`);
  }
  const stopDiffers = (current.toTime ?? '') !== (proposed.toTime ?? '');
  if (stopDiffers) parts.push(`Stop ${orDash(current.toTime)} → ${orDash(proposed.toTime)}`);
  if (current.description !== proposed.description) parts.push('Description changed');
  if ((current.orderCode ?? '') !== (proposed.orderCode ?? '')) {
    parts.push(`SO ${orDash(current.orderCode)} → ${orDash(proposed.orderCode)}`);
  }
  if (parts.length === 0) parts.push('No change');
  return parts.join(' · ');
}

/** Counts in menu order, only types with n > 0 (unknown keys last, as given). */
export function orderedCounts(byType: ReadonlyMap<string, number>): ApprovalTypeCount[] {
  const known = APPROVAL_TYPE_ORDER.filter((k) => (byType.get(k) ?? 0) > 0);
  const extra = [...byType.keys()].filter(
    (k) => !APPROVAL_TYPE_ORDER.includes(k) && (byType.get(k) ?? 0) > 0,
  );
  return [...known, ...extra].map((typeKey) => ({
    typeKey,
    typeLabel: typeLabelOf(typeKey),
    n: byType.get(typeKey) ?? 0,
  }));
}

/** Any timestamp the drivers hand back (Date, ISO, or Postgres text) as ISO. */
export function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  const ms = timestampMs(String(v ?? ''));
  return Number.isNaN(ms) ? String(v ?? '') : new Date(ms).toISOString();
}

/** Oldest raisedAt first (a queue); id breaks ties so the order is stable. */
export function sortOldestFirst<T extends { raisedAt: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = Date.parse(a.raisedAt) - Date.parse(b.raisedAt);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
