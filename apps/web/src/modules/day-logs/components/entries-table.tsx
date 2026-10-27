// A day's saved entries, read-only (person page): # · Start · Stop ·
// SO / JWSO · Time, and the "Working on" line under every row; the LATE tag
// and the "⏳ Edit pending" marker sit beside the Stop. My Day Log's own
// sheet is the one-line grid (sheet-saved-row.tsx); it shares PendingTag
// and sortEntries from here.

import type { DayLogEntry } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { Fragment } from 'react';
import { fmtDmy } from '../lib/format';
import { NO_GAP, WorkLine } from './work-line';

/** The read-only table's columns, in order. */
export const SHEET_HEADS = ['#', 'Start', 'Stop', 'SO / JWSO', 'Time'] as const;

export function SheetHead(): React.JSX.Element {
  return (
    <thead>
      <tr>
        {SHEET_HEADS.map((h) => (
          <th key={h} className={h === 'Time' ? 'th-num' : undefined}>
            {h}
          </th>
        ))}
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

/** One saved entry's five cells (no <tr>). The LATE tag and pending marker
 *  beside the Stop are the admin's person page only (owner 2026-10-27: never
 *  on the user's own My Day Log). */
function EntryCells({ e, n }: { e: DayLogEntry; n: number }): React.JSX.Element {
  return (
    <>
      <td className="mono">{n}</td>
      <td className="mono">{fmt12(e.fromTime)}</td>
      <td className="mono">
        {fmt12(e.toTime)}
        {e.late ? <LateTag /> : null}
        {e.pending ? (
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
        <SheetHead />
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
                <EntryCells e={e} n={i + 1} />
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
