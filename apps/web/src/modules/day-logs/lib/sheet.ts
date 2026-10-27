// The ONE-SHEET My Day Log (owner-approved mockup 2026-10-27): the new rows
// the user types before Save, and the small display helpers the sheet's rows
// share. Nothing here decides a rule — each row's Start is shown for the eye
// only (the server works it out), and every check is the server's; it answers
// "Row N: …" for the row it refused.

import type { DayLogEntry, DayLogEntryKind, DayLogOrder, DayLogSheetRow } from '@innovic/shared';
import { DAY_LOG_ENTRY_KIND_LABELS, hhmmToMin, parseTime } from '@innovic/shared';

/** A new row, not saved yet. `desc` is Working on / the break name; `reason`
 *  is an Others row's reason (its description once saved). */
export interface Draft {
  key: number;
  kind: DayLogEntryKind;
  stop: string;
  desc: string;
  reason: string;
  order: DayLogOrder | null;
  remarks: string;
}

let nextKey = 1;

export function blankDraft(): Draft {
  return { key: nextKey++, kind: 'work', stop: '', desc: '', reason: '', order: null, remarks: '' };
}

/** The user has typed or picked something in this row. */
export function isFilled(d: Draft): boolean {
  return Boolean(
    d.stop.trim() ||
    d.desc.trim() ||
    d.reason ||
    d.remarks.trim() ||
    (d.kind === 'work' && d.order),
  );
}

/** Each draft's Start, for display: the first filled one starts at the day's
 *  nextStart, each next at the previous one's typed Stop; null = not known
 *  yet ("after row above"). Empty rows are skipped by Save, so they neither
 *  move nor break the chain. */
export function draftStarts(nextStart: string | null, drafts: readonly Draft[]): (string | null)[] {
  let s = nextStart;
  return drafts.map((d) => {
    const mine = s;
    if (isFilled(d)) s = s === null ? null : parseTime(d.stop);
    return mine;
  });
}

/** Minutes between a draft's shown Start and its typed Stop, or null. */
export function draftMinutes(start: string | null, stop: string): number | null {
  const b = parseTime(stop);
  if (!start || !b) return null;
  const m = hhmmToMin(b) - hhmmToMin(start);
  return m > 0 ? m : null;
}

/** The batch body's row for a draft. */
export function toSheetRow(d: Draft): DayLogSheetRow {
  const work = d.kind === 'work';
  return {
    kind: d.kind,
    description: d.kind === 'leave' ? d.reason : d.desc.trim(),
    stopTime: d.stop.trim() ? parseTime(d.stop) : null,
    orderType: work ? (d.order?.type ?? null) : null,
    orderId: work ? (d.order?.id ?? null) : null,
    remarks: d.remarks.trim() || null,
  };
}

/** "Row 2: Stop must be after …" → { row: 2, text: "Stop must be after …" }. */
export function rowError(message: string): { row: number; text: string } | null {
  const m = /^Row (\d+):\s*(.*)$/s.exec(message);
  return m ? { row: Number(m[1]), text: m[2] ?? message } : null;
}

/** Type as shown: Work / Break / "Others · <reason>". */
export function entryTypeText(e: Pick<DayLogEntry, 'kind' | 'description'>): string {
  const label = DAY_LOG_ENTRY_KIND_LABELS[e.kind];
  return e.kind === 'leave' && e.description ? `${label} · ${e.description}` : label;
}

/** The row's soft tint: Open blue, Others purple, Break grey. */
export function entryTint(e: DayLogEntry): React.CSSProperties {
  if (!e.toTime) return { background: 'var(--blue3)' };
  if (e.kind === 'leave') return { background: 'var(--purple3)' };
  if (e.kind === 'break') return { color: 'var(--text3)' };
  return {};
}

/** Long text in a cell: one line, ellipsis, the whole text on hover. */
export const CLIP: React.CSSProperties = {
  maxWidth: 320,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
