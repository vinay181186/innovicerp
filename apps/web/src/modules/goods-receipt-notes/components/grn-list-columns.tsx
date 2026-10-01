// Goods Receipt Note list columns (ADR-199 fit table: one line per GRN). Moved
// out of routes/list.tsx so that file stays under the 400-line ceiling. Centred
// by the table standard; numbers right-aligned (align 'right' -> the num kind);
// only the Vendor name is left-aligned and shares the spare width.
//
// Columns, first pinned: GRN No. · GRN Date · Vendor · Source · PO/NC No. ·
// Received · Accepted · Rejected · QC Status. Every field was already shown by
// the retired card layout — Received / Accepted / Rejected came off the metric
// strip, Source off the "Against NC / DC / PO" badge, PO/NC No. off the meta
// line. Nothing new.

import type { GoodsReceiptNoteListItem, GrnQcStatus } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
import { QcStatusBadge } from './qc-status-badge';

/** `qcStatusFor` is owned by the page (it reads the in-progress set + the active
 *  filter), so the QC Status column and the row tint stay in agreement with the
 *  card rule that preceded them. */
export function goodsReceiptNoteListColumns(
  qcStatusFor: (grn: GoodsReceiptNoteListItem) => GrnQcStatus,
): DataTableColumn<GoodsReceiptNoteListItem>[] {
  return [
    {
      // First column — pinned by the table standard (ADR-199).
      id: 'grn_code',
      header: 'GRN No.',
      nowrap: true,
      render: (grn) => (
        <Link
          to="/goods-receipt-notes/$id"
          params={{ id: grn.id }}
          className="td-code"
          style={{ color: 'var(--blue)', fontWeight: 800 }}
          title="Open the GRN detail page"
          onClick={(e) => e.stopPropagation()}
        >
          {grn.code}
        </Link>
      ),
    },
    {
      id: 'grn_date',
      kind: 'date',
      header: 'GRN Date',
      className: 'mono',
      nowrap: true,
      render: (grn) => fmtDate(grn.grnDate),
    },
    {
      id: 'vendor',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (grn) => grn.vendorName ?? grn.vendorCodeText ?? '—',
      title: (grn) => grn.vendorName ?? grn.vendorCodeText ?? '',
    },
    {
      id: 'source',
      kind: 'badge',
      header: 'Source',
      nowrap: true,
      // An NC-return GRN also carries deliveryChallanId, so NC is checked first
      // (same order the card used): return-to-vendor challan (ADR-161), OSP
      // delivery challan (ADR-080), or a purchase PO.
      render: (grn) =>
        grn.ncId ? (
          <span className="badge b-red">Against NC</span>
        ) : grn.deliveryChallanId ? (
          <span className="badge b-cyan">Against DC</span>
        ) : grn.purchaseOrderId ? (
          <span className="badge b-grey">Against PO</span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'po_nc_code',
      header: 'PO/NC No.',
      nowrap: true,
      // On an NC-return GRN poCodeText holds the NC code (no PO exists); on a
      // purchase GRN poCode (resolved) ?? poCodeText (snapshot).
      render: (grn) => {
        const ref = grn.ncId ? grn.poCodeText : (grn.poCode ?? grn.poCodeText);
        return ref ? (
          <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
            {ref}
          </span>
        ) : (
          <span className="text3">—</span>
        );
      },
    },
    {
      id: 'received',
      header: 'Received',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (grn) => grn.totalReceivedQty,
    },
    {
      id: 'accepted',
      header: 'Accepted',
      align: 'right',
      nowrap: true,
      headColor: 'var(--green)',
      render: (grn) => (
        <span
          className="mono fw-700"
          style={{ color: grn.totalQcAcceptedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {grn.totalQcAcceptedQty}
        </span>
      ),
    },
    {
      id: 'rejected',
      header: 'Rejected',
      align: 'right',
      nowrap: true,
      headColor: 'var(--red)',
      render: (grn) => (
        <span
          className="mono fw-700"
          style={{ color: grn.totalQcRejectedQty > 0 ? 'var(--red)' : 'var(--text3)' }}
        >
          {grn.totalQcRejectedQty}
        </span>
      ),
    },
    {
      id: 'qc_status',
      kind: 'badge',
      header: 'QC Status',
      nowrap: true,
      render: (grn) => <QcStatusBadge status={qcStatusFor(grn)} />,
    },
  ];
}
