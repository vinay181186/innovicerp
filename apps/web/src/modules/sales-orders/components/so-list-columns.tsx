// SO Master list — the fit table's columns, row tint and ⋯ menu (ADR-199 table
// standard 2026-10-01). Split out of routes/list.tsx so that file stays small
// and the sheet is defined in one place.
//
// ADR-261 (owner 2026-10-31): ONE ROW PER SO LINE (GET /sales-orders/lines).
// The six lead columns (SO No. · Internal SO No. · POL · Created On · Item
// Code (CODE/REV) · Item Name) come first via leadColumns; then SO Date, SO
// Type, Customer, Client PO No., the LINE's Order Qty / JC Qty / Dispatched /
// Pending / Due Date, SO Status and Fulfilment (the order's). The row ⋯, row
// click and dialogs still act on the ORDER (each row carries the order's list
// item). Labels per docs/NAMING.md.

import {
  SO_STATUSES,
  SO_TYPES,
  type SalesOrderLineListItem,
  type SalesOrderListItem,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import { ROW_TINT, leadColumns } from '@/ui/data';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from '../lib/so-status-label';
import { SoStatusBadge } from './so-status-badge';
import { SoFulfilmentBadge } from './so-fulfilment-badge';

/** Sort & Filter (ADR-200, server mode) tick lists: stored code + the label shown. */
const SO_TYPE_OPTIONS = SO_TYPES.map((value) => ({ value, label: SO_TYPE_LABEL[value] }));
const SO_STATUS_OPTIONS = SO_STATUSES.map((value) => ({ value, label: SO_STATUS_LABEL[value] }));

/** Pieces still owed on the LINE (NAMING.md "Pending"): ordered − dispatched;
 *  nothing once the line is closed short (ADR-196) or cancelled. */
export function soLinePendingQty(r: SalesOrderLineListItem): number {
  if (r.lineShortClosedAt || r.lineStatus === 'cancelled') return 0;
  return Math.max(0, r.lineOrderQty - r.lineDispatchedQty);
}

/**
 * Whole-row wash by the REAL status enums only (ADR-199 ROW_TINT), per line:
 *   order or line cancelled → cancelled (grey)
 *   draft order             → pending   (amber)
 *   open order + line past its Due Date with pieces still owed → late (red)
 *   order closed / dispatched, or nothing owed on the line → done (green)
 *   everything else → no wash
 * `today` is the IST yyyy-mm-dd the route computes once, so the wash and the
 * Due Date column agree on "late".
 */
export function soLineRowTint(r: SalesOrderLineListItem, today: string): string | undefined {
  if (r.status === 'cancelled' || r.lineStatus === 'cancelled') return ROW_TINT.cancelled;
  if (r.status === 'draft') return ROW_TINT.pending;
  // A line-less SO (one row, no line) owes nothing on a line: no wash.
  if (r.lineId == null) return undefined;
  if (lineOverdue(r, today)) return ROW_TINT.late;
  if (r.status === 'closed' || r.status === 'dispatched') return ROW_TINT.done;
  if (soLinePendingQty(r) === 0) return ROW_TINT.done;
  return undefined;
}

function lineOverdue(r: SalesOrderLineListItem, today: string): boolean {
  return (
    r.lineDueDate != null && r.lineDueDate < today && r.status === 'open' && soLinePendingQty(r) > 0
  );
}

/** JC Qty colour: green once every piece has a job card, amber while some do,
 *  quiet while none do — the rule the card and the old sheet both used. */
function jcColor(r: SalesOrderLineListItem): string {
  if (r.lineJcQty >= r.lineOrderQty && r.lineOrderQty > 0) return 'var(--green)';
  if (r.lineJcQty > 0) return 'var(--amber)';
  return 'var(--text3)';
}

export function soListColumns(opts: {
  /** IST yyyy-mm-dd for the overdue check — computed once by the route. */
  today: string;
  /** The 📎 — previews the client-PO document in-app (ADR-142). */
  onPreviewClientPo: (storagePath: string) => void;
  /** ADR-202 — SO ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>;
}): DataTableColumn<SalesOrderLineListItem>[] {
  const { today, onPreviewClientPo, draftIds } = opts;
  return [
    ...leadColumns<SalesOrderLineListItem>({
      soNo: (r) => r.code,
      internalSoNo: (r) => r.internalSoNo,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.lineCreatedAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      // A line-less SO's row has no Item Name → '—'.
      itemName: (r) => r.itemName || '—',
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          // The SYSTEM number (ADR-207) stays a real link — ctrl-click opens
          // the SO in a new tab; a plain click still opens the row.
          render: (r) => (
            <Link
              to="/sales-orders/$id"
              params={{ id: r.id }}
              className="td-code"
              title="Open the SO Master detail page"
              onClick={(e) => e.stopPropagation()}
            >
              {r.code}
            </Link>
          ),
        },
        so_internal_no: { sortFilterField: 'internalSoNo' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
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
      render: (r) => r.lineOrderQty,
    },
    {
      id: 'jc_qty',
      sortFilterField: 'jcQty',
      filterType: 'num',
      header: 'JC Qty',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => <span style={{ color: jcColor(r) }}>{r.lineJcQty}</span>,
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
      render: (r) => <span style={{ color: 'var(--green2)' }}>{r.lineDispatchedQty}</span>,
    },
    {
      id: 'pending_qty',
      header: 'Pending',
      align: 'right',
      className: 'mono fw-700',
      headColor: 'var(--red)',
      nowrap: true,
      // ADR-196 — a line closed short owes nothing.
      render: (r) => <span style={{ color: 'var(--red2)' }}>{soLinePendingQty(r)}</span>,
    },
    {
      id: 'due_date',
      // The LINE's own Due Date.
      sortFilterField: 'earliestDueDate',
      kind: 'date',
      header: 'Due Date',
      className: 'mono',
      nowrap: true,
      render: (r) => {
        const overdue = lineOverdue(r, today);
        if (!r.lineDueDate) return <span className="text2">—</span>;
        return (
          <span
            style={{
              color: overdue ? 'var(--red)' : 'var(--text2)',
              fontWeight: overdue ? 700 : undefined,
            }}
          >
            {fmtDate(r.lineDueDate)}
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
      render: (so) => <SoStatusBadge status={so.status} draft={draftIds?.has(so.id)} />,
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
  ];
}

/**
 * The order's ⋯ menu — the retired card's actions, same gates. View is the row
 * click (so it is not repeated here); Edit needs edit; Plan BOM Items (workflow)
 * only on an equipment SO with a BOM linked — it moved here from the ▸ panel;
 * Assign Task needs a write-capable login on a non-closed order (ADR-234,
 * same as SO detail); Plan BOM Items needs Plan Entry; Delete needs edit + approve on
 * a non-closed order. Plan BOM Items carries `?soId=`, so the table's
 * renderLink must be renderRowMenuLink.
 */
export function soRowMenu(
  so: SalesOrderListItem,
  opts: {
    canEdit: boolean;
    canDelete: boolean;
    /** ADR-234 — Plan BOM Items raises plans: Plan Entry. */
    canPlan: boolean;
    /** ADR-234 — Assign Task: anyone set up to write (the server's rule). */
    canAssign: boolean;
    onAssign: (so: SalesOrderListItem) => void;
    onDelete: (so: SalesOrderListItem) => void;
    /** ADR-235 — Cancel SO: the Edit or Approve tick (the server decides). */
    canCancel: boolean;
    onCancel: (so: SalesOrderListItem) => void;
    /** SO Preview box (so-preview-modal.tsx): header + every document per line. */
    onOpenSoPreview: (so: SalesOrderListItem) => void;
    /** The SO print (use-order-print.tsx): in-app preview, and ⬇ PDF. */
    onPreview: (so: SalesOrderListItem) => void;
    onDownload: (so: SalesOrderListItem) => Promise<void>;
  },
): RowMenuItem[] {
  const { canEdit, canDelete, canPlan, canAssign, onAssign, onDelete } = opts;
  const cancelled = so.status === 'cancelled';
  return [
    // First: the SO Preview box. Same right as the row itself (view).
    { key: 'so-preview', label: 'Preview', icon: 'eye', onSelect: () => opts.onOpenSoPreview(so) },
    {
      key: 'preview',
      label: 'Print Preview',
      icon: 'printer',
      onSelect: () => opts.onPreview(so),
    },
    {
      key: 'download',
      label: 'Download PDF',
      icon: 'download',
      onSelect: () => opts.onDownload(so),
    },
    {
      key: 'edit',
      label: 'Edit',
      icon: 'pencil',
      hidden: !canEdit || cancelled,
      to: `/sales-orders/${so.id}/edit`,
    },
    {
      key: 'plan-bom',
      label: 'Plan BOM Items',
      icon: 'package',
      group: 'workflow',
      hidden: !canPlan || so.type !== 'equipment' || !so.bomMasterId,
      to: `/planning?soId=${so.id}`,
    },
    {
      key: 'assign',
      label: 'Assign Task',
      icon: 'user-round',
      group: 'assign',
      hidden: !canAssign || so.status === 'closed' || cancelled,
      onSelect: () => onAssign(so),
    },
    {
      key: 'cancel',
      label: 'Cancel SO',
      icon: 'x',
      group: 'danger',
      hidden: !opts.canCancel || (so.status !== 'draft' && so.status !== 'open'),
      onSelect: () => opts.onCancel(so),
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
