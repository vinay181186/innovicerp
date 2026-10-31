// Customer Dispatch list columns (ADR-199 FIT table).
// ADR-261 (owner 2026-10-31): ONE ROW PER DISPATCH LINE
// (GET /customer-dispatches/lines). The six lead columns come first (SO No. ·
// Internal SO No. · POL · Created On · Item Code (CODE/REV) · Item Name), then
// Dispatch No., Dispatch Date, Customer, the line's Dispatch Qty, Billed
// Status, Dispatched By — and the facts the retired ▸ showed (JC No., UOM,
// Stock Before → After, Remarks). Row click and ⋯ act on the DISPATCH.
// `sortFilterField` = the server column map (sf-columns.ts).

import { Link } from '@tanstack/react-router';
import { docDrawingRev } from '@/lib/item-code';
import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import type { CustomerDispatchLineListRow, CustomerDispatchRow } from '@innovic/shared';

/** ADR-190 — how far the dispatch is invoiced. Labels per docs/NAMING.md. */
const BILLED_BADGE: Record<
  NonNullable<CustomerDispatchRow['billedStatus']>,
  { label: string; className: string }
> = {
  none: { label: 'To Bill', className: 'badge b-amber' },
  partial: { label: 'Part Billed', className: 'badge b-blue' },
  full: { label: 'Billed', className: 'badge b-green' },
};

/** Dispatch status values for the ▾ list filter (sf-columns `status`). */
const DISPATCH_STATUS_OPTIONS = [
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'cancelled', label: 'Cancelled' },
];

type Row = CustomerDispatchLineListRow;

export function dispatchListColumns(
  /** ADR-202 — dispatch ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<Row>[] {
  return [
    ...leadColumns<Row>({
      soNo: (r) => r.soNo,
      internalSoNo: (r) => r.soInternalNo,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode ?? r.itemCodeText,
      // The Rev actually shipped (Drawing Rev Phase C), else the SO line's.
      itemRev: (r) => docDrawingRev(r),
      itemName: (r) => r.itemName,
      overrides: {
        so_no: { sortFilterField: 'soCode' },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'dispatch_code',
      sortFilterField: 'dispatchCode',
      header: 'Dispatch No.',
      nowrap: true,
      render: (r) => (
        <Link
          to="/customer-dispatches/$id"
          params={{ id: r.dispatchId }}
          className="td-code"
          style={{ color: 'var(--cyan)', fontWeight: 800 }}
          onClick={(e) => e.stopPropagation()}
        >
          {r.dispatchCode}
        </Link>
      ),
    },
    {
      id: 'dispatch_date',
      sortFilterField: 'dispatchDate',
      kind: 'date',
      header: 'Dispatch Date',
      className: 'mono',
      nowrap: true,
      render: (r) => fmtDate(r.date),
    },
    {
      id: 'customer',
      sortFilterField: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (r) => r.customer ?? '—',
      title: (r) => r.customer ?? '',
    },
    {
      id: 'dispatch_qty',
      sortFilterField: 'qty',
      kind: 'num',
      header: 'Dispatch Qty',
      align: 'right',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
          {r.qty}
        </span>
      ),
    },
    {
      id: 'billed_status',
      kind: 'badge',
      header: 'Billed Status',
      nowrap: true,
      // ADR-235 — the ▾ filters on the dispatch's own status, so Cancelled
      // dispatches can be picked out (or left out) of the register.
      sortFilterField: 'status',
      filterType: 'list',
      filterOptions: DISPATCH_STATUS_OPTIONS,
      render: (r) => {
        // ADR-202 — a pending edit overlays grey "Draft" in place of the status.
        if (draftIds?.has(r.dispatchId))
          return (
            <span className="badge b-grey" title="An edit to this document is waiting for approval">
              Draft
            </span>
          );
        if (r.status === 'cancelled') return <span className="badge b-red">Cancelled</span>;
        const billed = r.billedStatus;
        return billed ? (
          <span className={BILLED_BADGE[billed].className}>{BILLED_BADGE[billed].label}</span>
        ) : (
          <span className="text3">—</span>
        );
      },
    },
    {
      id: 'dispatched_by',
      sortFilterField: 'dispatchedBy',
      header: 'Dispatched By',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (r) => r.dispatchedBy ?? '—',
      title: (r) => r.dispatchedBy ?? '',
    },
    {
      id: 'jc_no',
      header: 'JC No.',
      className: 'td-code',
      nowrap: true,
      render: (r) => r.jcNo ?? <span className="text3">—</span>,
    },
    {
      id: 'uom',
      header: 'UOM',
      nowrap: true,
      render: (r) => <span className="badge b-grey">{r.uom ?? 'NOS'}</span>,
    },
    {
      id: 'stock_before_after',
      header: 'Stock Before → After',
      align: 'right',
      className: 'mono text3',
      nowrap: true,
      render: (r) => `${r.stockBefore ?? '—'}→${r.stockAfter ?? '—'}`,
    },
    {
      id: 'remarks',
      header: 'Remarks',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (r) => r.remarks?.trim() || '—',
      title: (r) => r.remarks ?? '',
    },
  ];
}
