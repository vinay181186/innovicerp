// SO Master list — the fit table's columns, row tint and ⋯ menu (ADR-199 table
// standard 2026-10-01). Split out of routes/list.tsx so that file stays small
// and the sheet is defined in one place.
//
// ADR-303 (owner 2026-11-16): ONE ROW PER ORDER again (GET /sales-orders). The
// locked lead block (Sr No · SO No. · Created On · Internal SO No.) comes first
// via leadColumns — no POL / Item Code / Item Name (an order has many); then SO
// Date, SO Type, Customer, Client PO No., Lines, Total SO Value, Pending SO
// Value, Due Date (earliest line), SO Status, Fulfilment and Created By. No
// qty columns. The two value headers are the owner's words (2026-11-17), on
// this list ONLY — the figures are Total Value (Basic) / Value to Dispatch
// (docs/NAMING.md); detail, form and print keep those names. The Excel Export
// stays one row per line (GET /sales-orders/lines) — soLinePendingQty below is
// its Pending.

import {
  SO_STATUSES,
  SO_TYPES,
  type SalesOrderLineListItem,
  type SalesOrderListItem,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import { ROW_TINT, createdByColumn, leadColumns } from '@/ui/data';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from '../lib/so-status-label';
import { SoStatusBadge } from './so-status-badge';
import { SoFulfilmentBadge } from './so-fulfilment-badge';

/** Sort & Filter (ADR-200, server mode) tick lists: stored code + the label shown. */
const SO_TYPE_OPTIONS = SO_TYPES.map((value) => ({ value, label: SO_TYPE_LABEL[value] }));
const SO_STATUS_OPTIONS = SO_STATUSES.map((value) => ({ value, label: SO_STATUS_LABEL[value] }));

/** ₹ with Indian grouping, to the paise (as the SO totals strip). */
function fmtInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Pieces still owed on ONE LINE (NAMING.md "Pending") — the line Excel
 *  export's column: ordered − dispatched; nothing once the line is closed short
 *  (ADR-196) or cancelled. */
export function soLinePendingQty(r: SalesOrderLineListItem): number {
  if (r.lineShortClosedAt || r.lineStatus === 'cancelled') return 0;
  return Math.max(0, r.lineOrderQty - r.lineDispatchedQty);
}

/** The order is open and its earliest line Due Date has passed. */
function soOverdue(so: SalesOrderListItem, today: string): boolean {
  return so.earliestDueDate != null && so.earliestDueDate < today && so.status === 'open';
}

/**
 * Whole-row wash by the REAL status + fulfilment enums only (ADR-199 ROW_TINT):
 *   cancelled              → cancelled
 *   draft                  → pending   (orange)
 *   open + past earliest Due Date → late (red)
 *   closed / dispatched, or fulfilment Completed / Closed → done (green)
 *   everything else (open, in progress) → no wash
 * `today` is the IST yyyy-mm-dd the route computes once, so the wash and the
 * Due Date column agree on "late".
 */
export function soRowTint(so: SalesOrderListItem, today: string): string | undefined {
  if (so.status === 'cancelled') return ROW_TINT.cancelled;
  if (so.status === 'draft') return ROW_TINT.pending;
  if (soOverdue(so, today)) return ROW_TINT.late;
  if (so.status === 'closed' || so.status === 'dispatched') return ROW_TINT.done;
  if (so.fulfilmentStatus === 'completed' || so.fulfilmentStatus === 'closed') return ROW_TINT.done;
  return undefined;
}

export function soListColumns(opts: {
  /** IST yyyy-mm-dd for the overdue check — computed once by the route. */
  today: string;
  /** The 📎 — previews the client-PO document in-app (ADR-142). */
  onPreviewClientPo: (storagePath: string) => void;
  /** ADR-202 — SO ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>;
  /** Sr No of this page's first row (server offset + 1). */
  firstRowNo: number;
  /** The caller's price right (so_create): without it the two value columns
   *  are not drawn (the server also nulls them and refuses their ▾). */
  canSeePrice: boolean;
}): DataTableColumn<SalesOrderListItem>[] {
  const { today, onPreviewClientPo, draftIds, firstRowNo, canSeePrice } = opts;
  const money = (v: number | null | undefined): React.JSX.Element =>
    v == null ? <span className="text3">—</span> : <span className="mono">{fmtInr(v)}</span>;
  const valueCols: DataTableColumn<SalesOrderListItem>[] = canSeePrice
    ? [
        {
          id: 'total_value_basic',
          sortFilterField: 'totalValueBasic',
          filterType: 'num',
          kind: 'num',
          money: true,
          header: 'Total SO Value',
          nowrap: true,
          render: (so) => money(so.totalValueBasic),
        },
        {
          id: 'value_to_dispatch',
          sortFilterField: 'valueToDispatch',
          filterType: 'num',
          kind: 'num',
          money: true,
          header: 'Pending SO Value',
          nowrap: true,
          render: (so) => money(so.valueToDispatch),
        },
      ]
    : [];
  return [
    ...leadColumns<SalesOrderListItem>({
      firstRowNo,
      soNo: (r) => r.code,
      createdOn: (r) => r.createdAt,
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
        created_on: { sortFilterField: 'createdOn' },
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
              style={{ padding: '0 var(--sp-1)', lineHeight: 1 }}
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
      id: 'line_count',
      sortFilterField: 'lineCount',
      filterType: 'num',
      kind: 'num',
      header: 'Lines',
      className: 'mono',
      nowrap: true,
      render: (so) => so.lineCount,
    },
    ...valueCols,
    {
      id: 'due_date',
      // The EARLIEST line Due Date of the order.
      sortFilterField: 'earliestDueDate',
      kind: 'date',
      header: 'Due Date',
      className: 'mono',
      nowrap: true,
      render: (so) => {
        const overdue = soOverdue(so, today);
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
    // Created By of the SAME record as Created On (the order).
    createdByColumn<SalesOrderListItem>({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
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
