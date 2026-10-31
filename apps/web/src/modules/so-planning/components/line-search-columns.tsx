// Columns for the Planning cross-order line-search results (ADR-199 shared FIT
// table). One row per matching SO LINE: SO No. · Internal SO No. · POL ·
// Created On · Item Code · Item Name (the lead block) · Ln · Order Qty · Due ·
// Plan Status. Split out of
// routes/workflow.tsx so that file stays under the 400-line rule. The old
// fixed-layout table wrapped long cells over several lines; the fit engine keeps
// every row to one line and folds the rightmost columns into the ▸ detail row
// when the screen is too narrow, cutting the Item Name with "…".

import type { PlanningLine, PlanningSoListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { ROW_TINT, leadColumns, type DataTableColumn } from '@/ui/data';
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
    // Owner rule 2026-10-31 — the six lead columns first; Ln and every other
    // fact follow Item Name. This sheet's ▾ runs in the browser over the rows
    // already loaded, so the lead columns filter through `filterValue`.
    ...leadColumns<LineSearchRow>({
      soNo: ({ so }) => so.soCode,
      internalSoNo: ({ so }) => so.soInternalNo,
      pol: ({ line }) => line.clientPoLineNo,
      // needs API — neither the SO list row nor the line carries a created date.
      createdOn: () => null,
      itemCode: ({ line }) => line.itemCode,
      itemRev: ({ line }) => line.itemRevision,
      itemName: ({ line }) => line.itemName,
      overrides: {
        so_no: {
          render: ({ so }) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {so.source === 'jw' ? <JwChip /> : null}
              {/* The SYSTEM number only (ADR-207); the office's own number is the
                  next column, so each heading names one of the two. */}
              <span className="mono" style={{ color: 'var(--blue)' }}>
                {so.soCode}
              </span>
            </span>
          ),
        },
        item_code: {
          filterValue: ({ line }) => itemCodeWithRev(line.itemCode, line.itemRevision, ''),
        },
      },
    }),
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
