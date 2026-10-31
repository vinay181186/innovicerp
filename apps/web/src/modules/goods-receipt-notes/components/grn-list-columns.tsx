// Goods Receipt Note list columns (ADR-199 fit table). ADR-261 (2026-10-31):
// ONE ROW PER GRN LINE (GET /goods-receipt-notes/lines), opening with the six
// lead columns — SO No. · Internal SO No. · POL · Created On · Item Code
// (CODE/REV) · Item Name — then GRN No. · GRN Date · Vendor · GRN Type · PO/NC
// No. · Received · QC Status · Accepted · Deviated · Vendor Challan No. ·
// Vendor Invoice No. (NAMING.md).
// Received / QC Status / Accepted / Deviated are the LINE's own. The two vendor
// paper numbers came out of the retired ▸ expand.

import type { GoodsReceiptNoteLineListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import { QcStatusBadge } from './qc-status-badge';

/** `GRN Type` — which paper the receipt is against (NAMING.md §A). The three
 *  words are the ones the create screen's GRN Type picker offers
 *  (`unified-grn-form.tsx` TYPE_META), so the list, the detail page and the
 *  form cannot drift into three vocabularies for one fact (CLAUDE.md §18).
 *  Null when a GRN traces to none of the three — a legacy row.
 *
 *  An NC-return GRN also carries `deliveryChallanId`, so NC is tested first
 *  (the order the retired card used): return-to-vendor challan (ADR-161), OSP
 *  delivery challan (ADR-080), then a purchase PO.
 *
 *  It lives here because the GRN list and the GRN detail page are the only two
 *  surfaces that derive it and this is the file both can import. Its proper
 *  home is `../lib/grn-labels.ts`, next to GRN_QC_STATUS_LABELS — that file is
 *  outside this change's file ownership, so moving it is a follow-up. */
export function grnTypeLabel(grn: {
  ncId: string | null;
  deliveryChallanId: string | null;
  purchaseOrderId: string | null;
}): string | null {
  if (grn.ncId) return 'Against NC';
  if (grn.deliveryChallanId) return 'Against JW PO / DC';
  if (grn.purchaseOrderId) return 'Direct Purchase';
  return null;
}

/** ADR-235 — a Cancelled GRN (listed with includeCancelled): cancelledAt is
 *  the standard Cancel's stamp. A plain Delete (Trash) leaves it null, and a
 *  trashed GRN is never listed, so this test cannot mistake one for the other. */
export function isGrnCancelled(grn: { cancelledAt: string | null }): boolean {
  return Boolean(grn.cancelledAt);
}

export function goodsReceiptNoteListColumns(
  /** ADR-202 — GRN ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<GoodsReceiptNoteLineListItem>[] {
  return [
    ...leadColumns<GoodsReceiptNoteLineListItem>({
      soNo: (l) => l.soCode,
      internalSoNo: (l) => l.soInternalNo,
      pol: (l) => l.clientPoLineNo,
      createdOn: (l) => l.createdAt,
      itemCode: (l) => l.itemCode,
      itemRev: (l) => l.itemRevision,
      itemName: (l) => l.itemName,
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
      id: 'grn_code',
      sortFilterField: 'grnCode',
      header: 'GRN No.',
      nowrap: true,
      render: (grn) => (
        <Link
          to="/goods-receipt-notes/$id"
          params={{ id: grn.docId }}
          className="td-code"
          style={{ color: 'var(--blue)', fontWeight: 800 }}
          title="Open the GRN detail page"
          onClick={(e) => e.stopPropagation()}
        >
          {grn.docCode}
        </Link>
      ),
    },
    {
      id: 'grn_date',
      sortFilterField: 'grnDate',
      kind: 'date',
      header: 'GRN Date',
      className: 'mono',
      nowrap: true,
      render: (grn) => fmtDate(grn.docDate),
    },
    {
      id: 'vendor',
      sortFilterField: 'vendorName',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (grn) => grn.vendorName ?? grn.vendorCodeText ?? '—',
      title: (grn) => grn.vendorName ?? grn.vendorCodeText ?? '',
    },
    {
      // Column id stays `source` so a saved layout keeps working (CLAUDE.md §18:
      // the field is `GRN Type`, the words the create screen offers).
      id: 'source',
      kind: 'badge',
      header: 'GRN Type',
      nowrap: true,
      render: (grn) => {
        const type = grnTypeLabel(grn);
        if (!type) return <span className="text3">—</span>;
        const tone = grn.ncId ? 'b-red' : grn.deliveryChallanId ? 'b-cyan' : 'b-grey';
        return <span className={`badge ${tone}`}>{type}</span>;
      },
    },
    {
      id: 'po_nc_code',
      sortFilterField: 'poNcCode',
      header: 'PO/NC No.',
      nowrap: true,
      // ADR-217 — an NC-return GRN states its NC code; the snapshot is the
      // fallback for an NC row since deleted.
      render: (grn) => {
        const ref = grn.ncId ? (grn.ncCode ?? grn.poCodeText) : (grn.poCode ?? grn.poCodeText);
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
      sortFilterField: 'totalReceivedQty',
      filterType: 'num',
      header: 'Received',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (grn) => grn.receivedQty,
    },
    {
      // The verdict, THEN the split it breaks into (same order as the detail
      // page and the print). This LINE's QC state, from the server.
      id: 'qc_status',
      kind: 'badge',
      header: 'QC Status',
      nowrap: true,
      // ADR-235: a Cancelled GRN reads "Cancelled" here instead.
      render: (grn) =>
        isGrnCancelled(grn) ? (
          <span className="badge b-red">Cancelled</span>
        ) : (
          <QcStatusBadge status={grn.lineQcStatus} draft={draftIds?.has(grn.docId)} />
        ),
    },
    {
      id: 'accepted',
      sortFilterField: 'totalQcAcceptedQty',
      filterType: 'num',
      header: 'Accepted',
      align: 'right',
      nowrap: true,
      headColor: 'var(--green)',
      render: (grn) => (
        <span
          className="mono fw-700"
          style={{ color: grn.qcAcceptedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {grn.qcAcceptedQty}
        </span>
      ),
    },
    {
      id: 'rejected',
      sortFilterField: 'totalQcRejectedQty',
      filterType: 'num',
      header: 'Deviated',
      align: 'right',
      nowrap: true,
      headColor: 'var(--red)',
      render: (grn) => (
        <span
          className="mono fw-700"
          style={{ color: grn.qcRejectedQty > 0 ? 'var(--red)' : 'var(--text3)' }}
        >
          {grn.qcRejectedQty}
        </span>
      ),
    },
    {
      id: 'vendor_challan_no',
      header: 'Vendor Challan No.',
      className: 'mono',
      nowrap: true,
      render: (grn) => grn.dcNo ?? '—',
    },
    {
      id: 'vendor_invoice_no',
      header: 'Vendor Invoice No.',
      className: 'mono',
      nowrap: true,
      render: (grn) => grn.invoiceNo ?? '—',
    },
  ];
}
