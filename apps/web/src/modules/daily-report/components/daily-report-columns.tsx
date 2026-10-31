// Daily Production Report — the fit table's columns (ADR-199 table standard
// 2026-10-01). Split out of routes/list.tsx so that file stays under the 400-line
// ceiling and the sheet is defined in one place. Mirrors legacy renderDailyReport
// (HTML L10823).
//
// One row per log entry. JC No. comes first, then the six lead columns (SO No.
// … Item Name, owner rule 2026-10-31), all locked. The Completed column carries the engine's column-following `total`
// (sum), so the per-machine total sits under its own column and moves with it
// into ▸ (replacing the old hand-written <tfoot>). Remarks is default-hidden, so
// it lives in the row's ▸ detail. Labels per docs/NAMING.md
// (POL = the customer's PO line number).

import type { DailyReportRow } from '@innovic/shared';
import { opSrNo, SHIFT_LABELS, type Shift } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';

/** Columns that live in the row's ▸ detail by default. */
export const DAILY_REPORT_HIDDEN = ['remarks'];

/** Sum the Completed quantity across the rows the totals row is given (this
 *  machine group's rows), so the engine's total matches the server figure. */
function sumQty(rows: DailyReportRow[]): number {
  return rows.reduce((acc, r) => acc + r.qty, 0);
}

export const dailyReportColumns: DataTableColumn<DailyReportRow>[] = [
  // Owner rule 2026-10-31 (ADR-261 amendment) — JC No. first, then the six
  // lead columns, all locked.
  // Created On = the log entry's own created_at.
  ...leadColumns<DailyReportRow>({
    doc: {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.jcCode}</span>,
    },
    docDate: {
      id: 'jc_date',
      kind: 'date',
      header: 'JC Date',
      className: 'mono',
      nowrap: true,
      render: (r) => fmtDate(r.jcDate ?? null),
      filterValue: (r) => r.jcDate ?? '',
    },
    soNo: (r) => r.soCode,
    internalSoNo: (r) => r.soInternalNo,
    pol: (r) => r.clientPoLineNo,
    createdOn: (r) => r.createdAt,
    itemCode: (r) => r.itemCode,
    itemRev: (r) => r.itemRevision,
    itemName: (r) => r.itemName,
  }),
  {
    id: 'op',
    kind: 'code',
    header: 'Op',
    className: 'mono',
    nowrap: true,
    render: (r) => `Op ${opSrNo(r.opSeq)}`,
  },
  {
    id: 'operation',
    kind: 'text',
    header: 'Operation',
    ellipsis: true,
    render: (r) => r.operation,
    title: (r) => r.operation,
  },
  {
    id: 'shift',
    kind: 'badge',
    header: 'Shift',
    nowrap: true,
    render: (r) => (
      <span className="badge b-grey">{SHIFT_LABELS[r.shift as Shift] ?? r.shift}</span>
    ),
  },
  {
    id: 'completed',
    kind: 'num',
    header: 'Completed',
    align: 'right',
    className: 'mono fw-700',
    nowrap: true,
    headColor: 'var(--green)',
    render: (r) => <span style={{ color: 'var(--green2)' }}>{r.qty}</span>,
    total: (rows) => <span style={{ color: 'var(--green2)' }}>{sumQty(rows)}</span>,
  },
  {
    id: 'operator',
    kind: 'text',
    header: 'Operator',
    ellipsis: true,
    render: (r) => r.operator ?? '—',
    title: (r) => r.operator ?? '',
  },
  {
    id: 'remarks',
    kind: 'text',
    header: 'Remarks',
    align: 'left',
    className: 'text3',
    ellipsis: true,
    render: (r) => r.remarks ?? '',
    title: (r) => r.remarks ?? '',
  },
];

/**
 * The columns for one machine group on a 25-row page (ADR-201): the Completed
 * total is the group's WHOLE-day figure from the server, not the sum of the
 * rows that happen to be on this page.
 */
export function dailyReportColumnsFor(groupTotal: number): DataTableColumn<DailyReportRow>[] {
  return dailyReportColumns.map((c) =>
    c.id === 'completed'
      ? { ...c, total: () => <span style={{ color: 'var(--green2)' }}>{groupTotal}</span> }
      : c,
  );
}
