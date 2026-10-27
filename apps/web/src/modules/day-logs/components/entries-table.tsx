// A day's saved entries, read-only, in the sheet's columns (owner-approved
// one-sheet mockup 2026-10-27): # · Type · Start · Stop (LATE) · Working on ·
// SO / JWSO · Remark · Time. Type is Work / Break (italic) / "Others ·
// <reason>"; Others rows tinted, the Open row tinted. `EntryCells` is the
// one drawing of a saved row — My Day Log's sheet uses it too.

import type { DayLogEntry } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { fmtDmy } from '../lib/format';
import { CLIP, entryTint, entryTypeText } from '../lib/sheet';

/** The sheet's columns, in order (the actions column is the caller's). */
export const SHEET_HEADS = [
  '#',
  'Type',
  'Start',
  'Stop',
  'Working on',
  'SO / JWSO',
  'Remark',
  'Time',
] as const;

export function SheetHead({ actions }: { actions: boolean }): React.JSX.Element {
  return (
    <thead>
      <tr>
        {SHEET_HEADS.map((h) => (
          <th key={h} className={h === 'Time' ? 'th-num' : undefined}>
            {h}
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

/** One saved entry's eight cells (no <tr>). */
export function EntryCells({ e, n }: { e: DayLogEntry; n: number }): React.JSX.Element {
  const open = !e.toTime;
  const work = e.kind === 'leave' ? '' : e.description;
  return (
    <>
      <td className="mono">{n}</td>
      <td>{e.kind === 'break' ? <i>{entryTypeText(e)}</i> : entryTypeText(e)}</td>
      <td className="mono">{fmt12(e.fromTime)}</td>
      <td className="mono">
        {open ? '● open' : fmt12(e.toTime)}
        {e.late ? <LateTag /> : null}
      </td>
      <td title={work || undefined} style={CLIP}>
        {work}
      </td>
      <td className="td-code">{e.order?.code ?? '—'}</td>
      <td title={e.remarks ?? undefined} style={{ ...CLIP, color: 'var(--text2)' }}>
        {e.remarks ?? ''}
      </td>
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
            <tr key={e.id} style={entryTint(e)}>
              <EntryCells e={e} n={i + 1} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
