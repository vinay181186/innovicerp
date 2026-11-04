// Columns for level 1 of SO/JWSO Planning (ADR-268, shared FIT table): one row
// per SO / JWSO LINE. The locked lead block · Ln · Customer · Type · Due Date ·
// Order Qty · Plan Qty · To Plan · % Planned · Plan Status · RC No. · PRO No. ·
// JC No. · Created By. Every `sortFilterField` comes from the shared
// PLANNING_LINE_LIST_SF_FIELD, so a heading can never ask the server for a field
// it does not know. The list is paged, so ▾ runs on the server.
//
// RC No. / PRO No. / JC No. stay on screen on a narrow window: line-list.tsx pins
// them (LINE_LIST_PINNED_IDS), so the fit engine takes other columns off first.
// Customer is a `text` column and shortens with "…" before anything leaves.

import {
  PLANNING_LINE_LIST_SF_FIELD as SF,
  docText,
  lineJcs,
  linePros,
  lineRouteCards,
  rcText,
  type PlanningLineListItem,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { docDrawingRev } from '@/lib/item-code';
import { soTypeLabel } from '@/modules/sales-orders/lib/so-status-label';
import { ROW_TINT, createdByColumn, leadColumns, type DataTableColumn } from '@/ui/data';
import { DocCodes, RcCodes } from './planning-doc-cells';
import { PLANNING_STATE_LABEL } from './planning-line-columns';
import { JwChip, lineStatusOf, type SourceFilter } from './planning-shared';

/** The columns a planner opens this screen for: never taken off screen. */
export const LINE_LIST_PINNED_IDS = ['rc_no', 'pro_no', 'jc_no'];

/** Row tint by the line's derived plan status (ADR-199 Wave A, ROW_TINT): the
 *  same green/amber lineStatusOf gives the status text, so the wash can never
 *  disagree with the label. Grey/unplanned stays untinted. */
export function lineRowTint(row: PlanningLineListItem): string | undefined {
  const { color } = lineStatusOf(row);
  if (color === 'var(--green)') return ROW_TINT.done;
  if (color === 'var(--amber)') return ROW_TINT.pending;
  return undefined;
}

// Sort & Filter tick lists (server mode, ADR-201): stored code + label shown.
const TYPE_OPTIONS = ['component_manufacturing', 'equipment', 'with_material', 'job_work'].map(
  (value) => ({ value, label: soTypeLabel(value) }),
);
const PLAN_STATE_OPTIONS = Object.entries(PLANNING_STATE_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export function lineListColumns(
  src: SourceFilter,
  /** Sr No of this page's first row (server offset + 1). */
  firstRowNo: number,
): DataTableColumn<PlanningLineListItem>[] {
  return [
    ...leadColumns<PlanningLineListItem>({
      firstRowNo,
      so: src === 'jw' ? 'jwso' : 'so',
      soNo: (r) => r.soCode,
      internalSoNo: src === 'jw' ? undefined : (r) => r.soInternalNo,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => docDrawingRev(r),
      itemName: (r) => r.itemName,
      overrides: {
        so_no: {
          sortFilterField: SF.soCode,
          render: (r) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {r.source === 'jw' ? <JwChip /> : null}
              {/* The SYSTEM number only (ADR-207); the office's own number is
                  the next column, so each heading names one of the two. */}
              <span className="mono fw-700" style={{ color: 'var(--blue)' }}>
                {r.soCode}
              </span>
            </span>
          ),
        },
        so_internal_no: { sortFilterField: SF.soInternalNo },
        client_po_line_no: { sortFilterField: SF.pol },
        item_code: { sortFilterField: SF.itemCode },
        item_name: { sortFilterField: SF.itemName },
        created_on: { sortFilterField: SF.createdOn },
      },
    }),
    {
      id: 'line_no',
      header: 'Ln',
      kind: 'num',
      align: 'right',
      sortFilterField: SF.lineNo,
      className: 'mono text3',
      nowrap: true,
      render: (r) => r.lineNo,
    },
    {
      id: 'customer',
      header: 'Customer',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      sortFilterField: SF.customerName,
      render: (r) => r.customerName ?? '—',
      title: (r) => r.customerName ?? '',
    },
    {
      id: 'so_type',
      header: src === 'jw' ? 'JWSO Type' : src === 'so' ? 'SO Type' : 'SO / JWSO Type',
      kind: 'badge',
      sortFilterField: SF.soType,
      filterOptions: TYPE_OPTIONS,
      nowrap: true,
      render: (r) => <span className="badge b-grey">{soTypeLabel(r.soType)}</span>,
    },
    {
      id: 'due_date',
      header: 'Due Date',
      kind: 'date',
      sortFilterField: SF.dueDate,
      nowrap: true,
      render: (r) => <span className="mono">{fmtDate(r.dueDate)}</span>,
    },
    {
      id: 'order_qty',
      header: 'Order Qty',
      kind: 'num',
      align: 'right',
      sortFilterField: SF.orderQty,
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => r.orderQty,
    },
    {
      id: 'plan_qty',
      header: 'Plan Qty',
      kind: 'num',
      align: 'right',
      sortFilterField: SF.planQty,
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.totalPlanned}</span>,
    },
    {
      id: 'to_plan',
      header: 'To Plan',
      kind: 'num',
      align: 'right',
      sortFilterField: SF.toPlan,
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => (
        <span style={{ color: r.remaining > 0 ? 'var(--amber)' : 'var(--green)' }}>
          {r.remaining}
        </span>
      ),
    },
    {
      id: 'pct_planned',
      header: '% Planned',
      kind: 'num',
      align: 'right',
      sortFilterField: SF.planningPct,
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => {
        const st = lineStatusOf(r);
        return <span style={{ color: st.color }}>{st.pct}%</span>;
      },
    },
    {
      id: 'plan_status',
      header: 'Plan Status',
      kind: 'badge',
      sortFilterField: SF.planState,
      filterOptions: PLAN_STATE_OPTIONS,
      nowrap: true,
      render: (r) => {
        const st = lineStatusOf(r);
        return <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span>;
      },
    },
    {
      id: 'rc_no',
      header: 'RC No.',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      sortFilterField: SF.rcNo,
      render: (r) => <RcCodes rcs={lineRouteCards(r)} />,
      title: (r) => rcText(lineRouteCards(r)),
    },
    {
      id: 'pro_no',
      header: 'PRO No.',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      sortFilterField: SF.proNo,
      render: (r) => <DocCodes docs={linePros(r)} kind="pro" />,
      title: (r) => docText(linePros(r)),
    },
    {
      id: 'jc_no',
      header: 'JC No.',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      sortFilterField: SF.jcNo,
      render: (r) => <DocCodes docs={lineJcs(r)} kind="jc" />,
      title: (r) => docText(lineJcs(r)),
    },
    createdByColumn<PlanningLineListItem>({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: SF.createdBy },
    }),
  ];
}
