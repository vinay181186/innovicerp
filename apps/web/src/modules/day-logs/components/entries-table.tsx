// A day's saved entries in the sheet's columns (owner final 2026-10-27):
// # · Start · Stop · SO / JWSO · Time, and the "Working on" line under every
// row. `EntryCells` is the one drawing of a saved row — My Day Log's sheet
// uses it too. The read-only table (person page, admin view) adds the LATE
// tag and the "⏳ Edit pending" marker beside the Stop.

import type { DayLogEntry } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { Fragment } from 'react';
import { fmtDmy } from '../lib/format';
import { NO_GAP, WorkLine } from './work-line';

/** The sheet's columns, in order (the actions column is the caller's). */
export const SHEET_HEADS = ['#', 'Start', 'Stop', 'SO / JWSO', 'Time'] as const;

/** Columns of My Day Log's sheet: the heads plus the actions column. */
export const SHEET_COLS = SHEET_HEADS.length + 1;

export function SheetHead({
  actions,
  required = false,
}: {
  actions: boolean;
  /** "Start *" / "Stop *" — the sheet where rows are typed. */
  required?: boolean;
}): React.JSX.Element {
  return (
    <thead>
      <tr>
        {SHEET_HEADS.map((h) => (
          <th key={h} className={h === 'Time' ? 'th-num' : undefined}>
            {required && (h === 'Start' || h === 'Stop') ? `${h} *` : h}
          </th>
        ))}
        {actions ? <th aria-label="Actions" /> : null}
      </tr>
    </thead>
  );
}

export function LateTag(): React.JSX.Element {
  return (
    <span
      className="badge b-orange"
      style={{ marginLeft: 4 }}
      title="Saved more than an hour after its stop time"
    >
      LATE
    </span>
  );
}

export function PendingTag({ e }: { e: DayLogEntry }): React.JSX.Element | null {
  if (!e.pending) return null;
  return (
    <span
      className="fw-700"
      style={{ color: 'var(--amber2)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}
      title="An edit of this row is waiting for approval"
    >
      ⏳ Edit pending
    </span>
  );
}

/** One saved entry's five cells (no <tr>). */
export function EntryCells({
  e,
  n,
  adminView = false,
}: {
  e: DayLogEntry;
  n: number;
  /** The LATE tag and pending marker beside the Stop — the admin's person
   *  page only (owner 2026-10-27: never on the user's own My Day Log). */
  adminView?: boolean;
}): React.JSX.Element {
  return (
    <>
      <td className="mono">{n}</td>
      <td className="mono">{fmt12(e.fromTime)}</td>
      <td className="mono">
        {fmt12(e.toTime)}
        {adminView && e.late ? <LateTag /> : null}
        {adminView && e.pending ? (
          <>
            {' '}
            <PendingTag e={e} />
          </>
        ) : null}
      </td>
      <td className="td-code">{e.order?.code ?? '—'}</td>
      <td className="td-num mono">{fmtDuration(e.minutes)}</td>
    </>
  );
}

export function sortEntries(entries: readonly DayLogEntry[]): DayLogEntry[] {
  return [...entries].sort((a, b) => a.fromTime.localeCompare(b.fromTime));
}

export function EntriesTable({
  date,
  entries,
  compact = false,
}: {
  date: string;
  entries: readonly DayLogEntry[];
  /** Nested inside the person page's day row. */
  compact?: boolean;
}): React.JSX.Element {
  const list = sortEntries(entries);
  return (
    <div className={compact ? 'tbl-wrap tbl-nofreeze' : 'tbl-wrap'}>
      <table className={compact ? 'innovic-table tbl-compact' : 'innovic-table'}>
        <SheetHead actions={false} />
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={SHEET_HEADS.length} className="empty-state">
                Nothing logged on {fmtDmy(date)}.
              </td>
            </tr>
          ) : null}
          {list.map((e, i) => (
            <Fragment key={e.id}>
              <tr style={NO_GAP}>
                <EntryCells e={e} n={i + 1} adminView />
              </tr>
              <WorkLine
                e={{ ...e, pending: null, rejectReason: null }}
                span={SHEET_HEADS.length - 1}
              />
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
