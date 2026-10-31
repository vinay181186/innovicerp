// Columns for the Planning SO/JWSO list (ADR-199 shared FIT table). One row per
// open order: SO No. · Internal SO No. · Created On (ADR-261 lead) · Customer · Type · Due ·
// Lines · Order Qty · Plan Qty · % Planned · Plan Status.
// Split out of routes/workflow.tsx so that
// file stays under the 400-line rule and matches the reference list shape
// (so-overview-columns). The fit engine sizes the columns to the screen and cuts
// the long Customer name with "…"; the number columns are right-aligned.
// `sortFilterField` names each column's field in the server's Sort & Filter
// map (so-planning/list-page.ts) — the list is paged, so ▾ runs on the server.

import type { PlanningSoListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { soTypeLabel } from '@/modules/sales-orders/lib/so-status-label';
import { ROW_TINT, leadColumns, type DataTableColumn } from '@/ui/data';
import {
  JwChip,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  type SourceFilter,
} from './planning-shared';

/**
 * Row tint by the order's plan status (ADR-199 Wave A, ROW_TINT): a soft wash
 * across the whole row so the planner reads the state at a glance. Fully planned
 * reads "done" (green); partly planned reads "pending" (amber). Unplanned stays
 * untinted — a plain white row is the "nothing done yet" state.
 */
export function orderRowTint(status: PlanningSoListItem['planningStatus']): string | undefined {
  switch (status) {
    case 'fully_planned':
      return ROW_TINT.done;
    case 'partial':
      return ROW_TINT.pending;
    case 'unplanned':
      return undefined;
  }
}

// Sort & Filter tick lists (server mode, ADR-201): stored code + label shown.
const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));
const TYPE_OPTIONS = ['component_manufacturing', 'equipment', 'with_material', 'job_work'].map(
  (value) => ({ value, label: soTypeLabel(value) }),
);

export function orderListColumns(src: SourceFilter): DataTableColumn<PlanningSoListItem>[] {
  return [
    // ADR-261 lead columns — a one-row-per-ORDER summary, so only SO No.,
    // Internal SO No. (not on the JWSO-only view) and Created On are drawn; an
    // order has many POLs / items. Customer and every other fact follow.
    ...leadColumns<PlanningSoListItem>({
      so: src === 'jw' ? 'jwso' : 'so',
      soNo: (so) => so.soCode,
      internalSoNo: src === 'jw' ? undefined : (so) => so.soInternalNo,
      createdOn: (so) => so.createdAt,
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          render: (so) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {so.source === 'jw' ? <JwChip /> : null}
              {/* The SYSTEM number only (ADR-207); the office's own number is
                  the next column, so each heading names one of the two. */}
              <span className="mono fw-700" style={{ color: 'var(--blue)' }}>
                {so.soCode}
              </span>
            </span>
          ),
        },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      sortFilterField: 'customerName',
      render: (so) => so.customerName ?? '—',
      title: (so) => so.customerName ?? '',
    },
    {
      id: 'so_type',
      header: src === 'jw' ? 'JWSO Type' : src === 'so' ? 'SO Type' : 'SO / JWSO Type',
      kind: 'badge',
      sortFilterField: 'soType',
      filterOptions: TYPE_OPTIONS,
      nowrap: true,
      render: (so) => <span className="badge b-grey">{soTypeLabel(so.soType)}</span>,
    },
    {
      id: 'due_date',
      header: 'Due Date',
      kind: 'date',
      sortFilterField: 'dueDate',
      nowrap: true,
      render: (so) => <span className="mono">{fmtDate(so.dueDate)}</span>,
    },
    {
      id: 'lines',
      header: 'Lines',
      kind: 'num',
      align: 'right',
      sortFilterField: 'totalLines',
      className: 'mono',
      nowrap: true,
      render: (so) => so.totalLines,
    },
    {
      id: 'order_qty',
      header: 'Order Qty',
      kind: 'num',
      align: 'right',
      sortFilterField: 'totalQty',
      className: 'mono fw-700',
      nowrap: true,
      render: (so) => so.totalQty,
    },
    {
      id: 'plan_qty',
      header: 'Plan Qty',
      kind: 'num',
      align: 'right',
      sortFilterField: 'totalPlannedQty',
      className: 'mono fw-700',
      nowrap: true,
      render: (so) => <span style={{ color: 'var(--cyan)' }}>{so.totalPlannedQty}</span>,
    },
    {
      id: 'pct_planned',
      header: '% Planned',
      kind: 'num',
      align: 'right',
      sortFilterField: 'planningPct',
      nowrap: true,
      render: (so) => (
        <span className={`badge ${ORDER_STATUS_BADGE[so.planningStatus]}`}>{so.planningPct}%</span>
      ),
    },
    {
      id: 'plan_status',
      header: 'Plan Status',
      kind: 'badge',
      sortFilterField: 'planningStatus',
      filterOptions: STATUS_OPTIONS,
      nowrap: true,
      render: (so) => (
        <span className={`badge ${ORDER_STATUS_BADGE[so.planningStatus]}`}>
          {ORDER_STATUS_LABEL[so.planningStatus]}
        </span>
      ),
    },
  ];
}
