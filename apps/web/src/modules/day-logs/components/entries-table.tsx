// A day's saved entries, read-only, in the sheet's columns (owner-approved
// one-sheet mockup 2026-10-27): # · Type · Start · Stop (LATE) · Working on ·
// SO / JWSO · Time, and the Remark on its own line under the row (owner
// 2026-10-27: no Remark column). Type is Work / Break (italic) / "Others ·
// <reason>"; Others rows tinted, the Open row tinted — both lines. `EntryCells`
// is the one drawing of a saved row — My Day Log's sheet uses it too.

import type { DayLogEntry } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { Fragment } from 'react';
import { fmtDmy } from '../lib/format';
import { CLIP, entryTint, entryTypeText } from '../lib/sheet';
import { NO_GAP, RemarkLine } from './remark-line';

/** The sheet's columns, in order (the actions column is the caller's). */
export const SHEET_HEADS = [
  '#',
  'Type',
  'Start',
  'Stop',
  'Working on',
  'SO / JWSO',
  'Time',
] as const;

/** Columns of My Day Log's sheet: the heads plus the actions column. */
export const SHEET_COLS = SHEET_HEADS.length + 1;

/** A saved row's <tr> style: its tint, and no rule above its Remark line. */
export function entryRowStyle(e: DayLogEntry): React.CSSProperties {
  return e.remarks?.trim() ? { ...entryTint(e), ...NO_GAP } : entryTint(e);
}

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

/** One saved entry's seven cells (no <tr>). */
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
              <tr style={entryRowStyle(e)}>
                <EntryCells e={e} n={i + 1} />
              </tr>
              <RemarkLine text={e.remarks} span={SHEET_HEADS.length - 1} tint={entryTint(e)} />
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
