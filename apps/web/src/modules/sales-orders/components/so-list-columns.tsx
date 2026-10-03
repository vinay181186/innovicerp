// SO Master list — the fit table's columns, row tint and ⋯ menu (ADR-199 table
// standard 2026-10-01). Split out of routes/list.tsx so that file stays small
// and the sheet is defined in one place.
//
// One row per order, every fact its own one-line column (the stacked SO No. /
// SO Date and Customer / Client PO cells of the retired card + hand-rolled
// sheet are gone). The first column (SO No.) is always pinned and carries the
// fit table's ▸ — the row's one expand control — so no chevron is drawn here.
// Labels per docs/NAMING.md (SO No., SO Date, SO Type, Customer, Client PO No.,
// Order Qty, JC Qty, Dispatched, Pending, Due Date). Fulfilment is the ADR-196
// badge, given its own column here.

import { SO_STATUSES, SO_TYPES, type SalesOrderListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import { ROW_TINT } from '@/ui/data';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from '../lib/so-status-label';
import { SoStatusBadge } from './so-status-badge';
import { SoFulfilmentBadge } from './so-fulfilment-badge';

/** Sort & Filter (ADR-200, server mode) tick lists: stored code + the label shown. */
const SO_TYPE_OPTIONS = SO_TYPES.map((value) => ({ value, label: SO_TYPE_LABEL[value] }));
const SO_STATUS_OPTIONS = SO_STATUSES.map((value) => ({ value, label: SO_STATUS_LABEL[value] }));

/** Columns off by default on the SO Master sheet — passed to the DataTable's
 *  `defaultHidden`. They stay reachable in ▸ / the Columns menu. */
export const SO_LIST_HIDDEN_COLUMNS = ['created_on', 'internal_so_no'];

/** Pieces still owed on the order (NAMING.md "Pending"): ordered − dispatched −
 *  the qty dropped by closing lines short (ADR-196). Never below zero. */
export function soPendingQty(so: SalesOrderListItem): number {
  return Math.max(0, so.totalQty - so.dispatchedQty - so.shortClosedQty);
}

/**
 * Whole-row wash by the REAL status + fulfilment enums only (ADR-199 ROW_TINT):
 *   cancelled              → cancelled (grey)
 *   draft                  → pending   (amber)
 *   open + past earliest Due Date → late (red)
 *   closed / dispatched, or fulfilment Completed / Closed → done (green)
 *   everything else (open, in progress) → no wash
 * `today` is the IST yyyy-mm-dd the route computes once, so the wash and the
 * Due Date column agree on "late".
 */
export function soRowTint(so: SalesOrderListItem, today: string): string | undefined {
  if (so.status === 'cancelled') return ROW_TINT.cancelled;
  if (so.status === 'draft') return ROW_TINT.pending;
  const overdue = so.earliestDueDate != null && so.earliestDueDate < today && so.status === 'open';
  if (overdue) return ROW_TINT.late;
  if (so.status === 'closed' || so.status === 'dispatched') return ROW_TINT.done;
  if (so.fulfilmentStatus === 'completed' || so.fulfilmentStatus === 'closed') return ROW_TINT.done;
  return undefined;
}

/** JC Qty colour: green once every piece has a job card, amber while some do,
 *  quiet while none do — the rule the card and the old sheet both used. */
function jcColor(so: SalesOrderListItem): string {
  if (so.jcQty >= so.totalQty && so.totalQty > 0) return 'var(--green)';
  if (so.jcQty > 0) return 'var(--amber)';
  return 'var(--text3)';
}

export function soListColumns(opts: {
  /** IST yyyy-mm-dd for the overdue check — computed once by the route. */
  today: string;
  /** The 📎 — previews the client-PO document in-app (ADR-142). */
  onPreviewClientPo: (storagePath: string) => void;
}): DataTableColumn<SalesOrderListItem>[] {
  const { today, onPreviewClientPo } = opts;
  return [
    {
      id: 'so_no',
      sortFilterField: 'soCode',
      header: 'SO No.',
      nowrap: true,
      // The row's ▸ (fit engine) opens the lines; the SO No. link opens the
      // detail. stopPropagation on the link, not the cell, so clicking the rest
      // of the cell still opens the row.
      render: (so) => (
        <Link
          to="/sales-orders/$id"
          params={{ id: so.id }}
          className="td-code"
          title="Open the SO Master detail page"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ADR-207 — "IN-SO-00786 · SO-2401" (SO No. alone when none). */}
          {soNoWithInternal(so.code, so.internalSoNo)}
        </Link>
      ),
    },
    {
      // ADR-207 — its own column only so it can be sorted / filtered on its
      // own; hidden by default because the SO No. cell already shows it.
      id: 'internal_so_no',
      sortFilterField: 'internalSoNo',
      header: 'Internal SO No.',
      className: 'mono fw-700',
      nowrap: true,
      render: (so) => so.internalSoNo ?? '—',
    },
    {
      id: 'so_date',
      sortFilterField: 'soDate',
      kind: 'date',
      header: 'SO Date',
      className: 'mono text2',
      nowrap: true,
      render: (so) => fmtDate(so.soDate),
    },
    {
      id: 'so_type',
      sortFilterField: 'type',
      filterOptions: SO_TYPE_OPTIONS,
      kind: 'badge',
      header: 'SO Type',
      nowrap: true,
      render: (so) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--sp-1)',
            flexWrap: 'wrap',
          }}
        >
          <span className="badge b-grey">{SO_TYPE_LABEL[so.type]}</span>
          {so.type === 'equipment' && so.bomStatus ? (
            <span
              className={`badge ${
                so.bomStatus === 'BOM Pending'
                  ? 'b-amber'
                  : so.bomStatus === 'BOM Planned'
                    ? 'b-green'
                    : 'b-blue'
              }`}
            >
              {so.bomStatus}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'customer',
      sortFilterField: 'customerName',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      render: (so) => so.customerName ?? '—',
      title: (so) => so.customerName ?? '',
    },
    {
      id: 'client_po_no',
      sortFilterField: 'clientPoNo',
      header: 'Client PO No.',
      headColor: 'var(--purple)',
      nowrap: true,
      render: (so) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--sp-1)',
            whiteSpace: 'nowrap',
          }}
        >
          <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
            {so.clientPoNo ?? '—'}
          </span>
          {so.clientPoFilePath ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '0 4px', lineHeight: 1 }}
              title="Preview Client PO Document"
              onClick={(e) => {
                e.stopPropagation();
                onPreviewClientPo(so.clientPoFilePath!);
              }}
            >
              📎
            </button>
          ) : null}
        </span>
      ),
    },
    {
      id: 'order_qty',
      sortFilterField: 'totalQty',
      filterType: 'num',
      header: 'Order Qty',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (so) => so.totalQty,
    },
    {
      id: 'jc_qty',
      sortFilterField: 'jcQty',
      filterType: 'num',
      header: 'JC Qty',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (so) => <span style={{ color: jcColor(so) }}>{so.jcQty}</span>,
    },
    {
      id: 'dispatched_qty',
      sortFilterField: 'dispatchedQty',
      filterType: 'num',
      header: 'Dispatched',
      align: 'right',
      className: 'mono fw-700',
      headColor: 'var(--green)',
      nowrap: true,
      render: (so) => <span style={{ color: 'var(--green2)' }}>{so.dispatchedQty}</span>,
    },
    {
      id: 'pending_qty',
      header: 'Pending',
      align: 'right',
      className: 'mono fw-700',
      headColor: 'var(--red)',
      nowrap: true,
      // ADR-196 — qty dropped by closing lines short is not Pending.
      render: (so) => <span style={{ color: 'var(--red2)' }}>{soPendingQty(so)}</span>,
    },
    {
      id: 'due_date',
      // The earliest line Due Date (the server's MIN over the SO's lines).
      sortFilterField: 'earliestDueDate',
      kind: 'date',
      header: 'Due Date',
      className: 'mono',
      nowrap: true,
      render: (so) => {
        const overdue =
          so.earliestDueDate != null && so.earliestDueDate < today && so.status === 'open';
        if (!so.earliestDueDate) return <span className="text2">—</span>;
        return (
          <span
            style={{
              color: overdue ? 'var(--red)' : 'var(--text2)',
              fontWeight: overdue ? 700 : undefined,
            }}
          >
            {fmtDate(so.earliestDueDate)}
            {overdue ? ' ⚠' : ''}
          </span>
        );
      },
    },
    {
      id: 'status',
      sortFilterField: 'status',
      filterOptions: SO_STATUS_OPTIONS,
      kind: 'badge',
      header: 'SO Status',
      nowrap: true,
      render: (so) => <SoStatusBadge status={so.status} />,
    },
    {
      id: 'fulfilment',
      kind: 'badge',
      header: 'Fulfilment',
      nowrap: true,
      // ADR-196 — To Deliver and Bill / To Deliver / To Bill / Completed /
      // Closed. Null for a draft or cancelled order; then a quiet dash.
      render: (so) =>
        so.fulfilmentStatus ? (
          <SoFulfilmentBadge status={so.fulfilmentStatus} />
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      // When the SO record was entered (IST day) — Sort & Filter can pick a
      // range of it (ADR-200). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'mono',
      nowrap: true,
      render: (so) => fmtDate(so.createdAt),
    },
  ];
}

/**
 * The order's ⋯ menu — the retired card's actions, same gates. View is the row
 * click (so it is not repeated here); Edit needs edit; Plan BOM Items (workflow)
 * only on an equipment SO with a BOM linked — it moved here from the ▸ panel;
 * Assign Task needs edit on a non-closed order; Delete needs edit + approve on
 * a non-closed order. Plan BOM Items carries `?soId=`, so the table's
 * renderLink must be renderRowMenuLink.
 */
export function soRowMenu(
  so: SalesOrderListItem,
  opts: {
    canEdit: boolean;
    canDelete: boolean;
    onAssign: (so: SalesOrderListItem) => void;
    onDelete: (so: SalesOrderListItem) => void;
  },
): RowMenuItem[] {
  const { canEdit, canDelete, onAssign, onDelete } = opts;
  return [
    {
      key: 'edit',
      label: 'Edit',
      icon: 'pencil',
      hidden: !canEdit,
      to: `/sales-orders/${so.id}/edit`,
    },
    {
      key: 'plan-bom',
      label: 'Plan BOM Items',
      icon: 'package',
      group: 'workflow',
      hidden: so.type !== 'equipment' || !so.bomMasterId,
      to: `/planning?soId=${so.id}`,
    },
    {
      key: 'assign',
      label: 'Assign Task',
      icon: 'user-round',
      group: 'assign',
      hidden: !canEdit || so.status === 'closed',
      onSelect: () => onAssign(so),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: 'trash-2',
      group: 'danger',
      hidden: !canDelete || so.status === 'closed',
      onSelect: () => onDelete(so),
    },
  ];
}
