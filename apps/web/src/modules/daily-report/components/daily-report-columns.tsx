// Daily Production Report — the fit table's columns (ADR-199 table standard
// 2026-10-01). Split out of routes/list.tsx so that file stays under the 400-line
// ceiling and the sheet is defined in one place. Mirrors legacy renderDailyReport
// (HTML L10823).
//
// One row per log entry. The first column (JC No.) is always pinned and carries
// the row's ▸. The Completed column carries the engine's column-following `total`
// (sum), so the per-machine total sits under its own column and moves with it
// into ▸ (replacing the old hand-written <tfoot>). POL, Item Name and Remarks are
// default-hidden, so they live in the row's ▸ detail. Labels per docs/NAMING.md
// (POL = the customer's PO line number).

import type { DailyReportRow } from '@innovic/shared';
import { opSrNo, SHIFT_LABELS, type Shift } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';

/** Columns that live in the row's ▸ detail by default. */
export const DAILY_REPORT_HIDDEN = ['pol', 'item_name', 'remarks'];

/** Sum the Completed quantity across the rows the totals row is given (this
 *  machine group's rows), so the engine's total matches the server figure. */
function sumQty(rows: DailyReportRow[]): number {
  return rows.reduce((acc, r) => acc + r.qty, 0);
}

export const dailyReportColumns: DataTableColumn<DailyReportRow>[] = [
  {
    id: 'jc_no',
    kind: 'code',
    header: 'JC No.',
    className: 'mono fw-700',
    nowrap: true,
    render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.jcCode}</span>,
  },
  {
    id: 'item_code',
    kind: 'code',
    header: 'Item Code',
    className: 'mono fw-700',
    nowrap: true,
    render: (r) => (
      <span style={{ color: 'var(--text)' }}>{itemCodeWithRev(r.itemCode, r.itemRevision)}</span>
    ),
  },
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
  // Default-hidden → the row's ▸ detail: POL, Item Name, Remarks.
  {
    id: 'pol',
    kind: 'code',
    // POL — the line number printed on the CUSTOMER's own purchase order.
    header: 'POL',
    headColor: 'var(--purple)',
    className: 'mono fw-700',
    nowrap: true,
    render: (r) => <span style={{ color: 'var(--purple)' }}>{r.clientPoLineNo ?? '—'}</span>,
  },
  {
    id: 'item_name',
    kind: 'text',
    header: 'Item Name',
    align: 'left',
    ellipsis: true,
    render: (r) => r.itemName ?? '—',
    title: (r) => r.itemName ?? '',
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
