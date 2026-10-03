// Columns for the Planning cross-order line-search results (ADR-199 shared FIT
// table). One row per matching SO LINE: SO/JWSO No. (pinned) · Ln · POL · Item
// Code · Item Name · Order Qty · Due · Plan Status. Split out of
// routes/workflow.tsx so that file stays under the 400-line rule. The old
// fixed-layout table wrapped long cells over several lines; the fit engine keeps
// every row to one line and folds the rightmost columns into the ▸ detail row
// when the screen is too narrow, cutting the Item Name with "…".

import type { PlanningLine, PlanningSoListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { ROW_TINT, type DataTableColumn } from '@/ui/data';
import { JwChip, lineStatusOf } from './planning-shared';

/** One result row: the SO it belongs to + the matching line. */
export interface LineSearchRow {
  so: PlanningSoListItem;
  line: PlanningLine;
}

/** Row tint by the line's derived plan status (ADR-199 Wave A, ROW_TINT): the
 *  same green/amber lineStatusOf gives the status text, so the wash can never
 *  disagree with the label. Grey/unplanned stays untinted. */
export function lineRowTint(line: PlanningLine): string | undefined {
  const { color } = lineStatusOf(line);
  if (color === 'var(--green)') return ROW_TINT.done;
  if (color === 'var(--amber)') return ROW_TINT.pending;
  return undefined;
}

export function lineSearchColumns(): DataTableColumn<LineSearchRow>[] {
  return [
    {
      id: 'so_code',
      header: 'SO / JWSO No.',
      kind: 'code',
      nowrap: true,
      render: ({ so }) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {so.source === 'jw' ? <JwChip /> : null}
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {soNoWithInternal(so.soCode, so.soInternalNo)}
          </span>
        </span>
      ),
      filterValue: ({ so }) => soNoWithInternal(so.soCode, so.soInternalNo),
    },
    {
      id: 'ln',
      header: 'Ln',
      kind: 'num',
      align: 'right',
      className: 'mono text3',
      nowrap: true,
      render: ({ line }) => line.lineNo,
      filterValue: ({ line }) => line.lineNo,
    },
    {
      // POL is the CUSTOMER's own line number — an extra value beside our "Ln",
      // never a substitute for it.
      id: 'pol',
      header: 'POL',
      kind: 'code',
      headColor: 'var(--purple)',
      nowrap: true,
      render: ({ line }) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {line.clientPoLineNo ?? '—'}
        </span>
      ),
      filterValue: ({ line }) => line.clientPoLineNo,
    },
    {
      // Item code is the thing the planner searched for — strong, never muted.
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      nowrap: true,
      render: ({ line }) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(line.itemCode, line.itemRevision, '')}
        </span>
      ),
      filterValue: ({ line }) => itemCodeWithRev(line.itemCode, line.itemRevision, ''),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: ({ line }) => line.itemName ?? '—',
      title: ({ line }) => line.itemName ?? '',
    },
    {
      id: 'order_qty',
      header: 'Order Qty',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: ({ line }) => line.orderQty,
      filterValue: ({ line }) => line.orderQty,
    },
    {
      id: 'due_date',
      header: 'Due Date',
      kind: 'date',
      nowrap: true,
      render: ({ line }) => <span className="mono">{fmtDate(line.dueDate)}</span>,
      filterValue: ({ line }) => line.dueDate,
    },
    {
      id: 'plan_status',
      header: 'Plan Status',
      kind: 'badge',
      nowrap: true,
      render: ({ line }) => {
        const status = lineStatusOf(line);
        return (
          <span style={{ fontSize: 11, fontWeight: 700, color: status.color }}>{status.label}</span>
        );
      },
      filterValue: ({ line }) => lineStatusOf(line).label,
    },
  ];
}
