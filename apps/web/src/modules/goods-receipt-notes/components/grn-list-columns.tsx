// Goods Receipt Note list columns (ADR-199 fit table). ADR-303 (2026-11-16):
// ONE ROW PER GRN again (GET /goods-receipt-notes); the per-line read stays for
// export. Lead block Sr No · GRN No. · Created On · SO No. (first line's order,
// grey "+n" for more) · Internal SO No. — no POL / Item columns. Then GRN Date
// · Vendor · GRN Type · PO/NC No. · Vendor Challan No. · Vendor Invoice No. ·
// Lines · Received · Accepted · Deviated (Σ over the lines) · QC Status (ONE
// status rolled up from the lines, server-side) · Created By (NAMING.md).

import type { GoodsReceiptNoteListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';
import { FirstPlusMore } from '@/modules/purchase-orders/components/first-plus-more';
import { DOC_QC_OPTIONS, DocQcBadge } from './doc-qc-badge';

/** GRN Type tick list — the server's grnType codes (sf-columns GRN_TYPE_SQL). */
const GRN_TYPE_OPTIONS = [
  { value: 'po', label: 'Direct Purchase' },
  { value: 'dc', label: 'Against JW PO / DC' },
  { value: 'nc', label: 'Against NC' },
];

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
  /** Sr No of the page's first row (offset + 1) — ADR-261 rev. */
  firstRowNo: number,
  /** ADR-202 — GRN ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<GoodsReceiptNoteListItem>[] {
  return [
    ...leadColumns<GoodsReceiptNoteListItem>({
      firstRowNo,
      doc: {
        id: 'grn_code',
        sortFilterField: 'grnCode',
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
      soNo: (g) => g.soCode,
      createdOn: (g) => g.createdAt,
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          render: (g) => <FirstPlusMore value={g.soCode} more={g.soExtraCount} />,
        },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'grn_date',
      sortFilterField: 'grnDate',
      kind: 'date',
      header: 'GRN Date',
      className: 'mono',
      nowrap: true,
      render: (grn) => fmtDate(grn.grnDate),
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
      sortFilterField: 'grnType',
      filterOptions: GRN_TYPE_OPTIONS,
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
          <span className="mono fw-700" style={{ color: 'var(--blue)' }}>
            {ref}
          </span>
        ) : (
          <span className="text3">—</span>
        );
      },
    },
    {
      id: 'vendor_challan_no',
      sortFilterField: 'dcNo',
      header: 'Vendor Challan No.',
      className: 'mono',
      nowrap: true,
      render: (grn) => grn.dcNo ?? '—',
    },
    {
      id: 'vendor_invoice_no',
      sortFilterField: 'invoiceNo',
      header: 'Vendor Invoice No.',
      className: 'mono',
      nowrap: true,
      render: (grn) => grn.invoiceNo ?? '—',
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      filterType: 'num',
      header: 'Lines',
      nowrap: true,
      className: 'mono',
      render: (grn) => grn.lineCount,
    },
    {
      id: 'received',
      sortFilterField: 'totalReceivedQty',
      filterType: 'num',
      header: 'Received',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (grn) => grn.totalReceivedQty,
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
          style={{ color: grn.totalQcAcceptedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {grn.totalQcAcceptedQty}
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
          style={{ color: grn.totalQcRejectedQty > 0 ? 'var(--red)' : 'var(--text3)' }}
        >
          {grn.totalQcRejectedQty}
        </span>
      ),
    },
    {
      // ADR-303 — ONE status for the receipt, rolled up from its lines.
      id: 'qc_status',
      sortFilterField: 'docQcStatus',
      filterOptions: DOC_QC_OPTIONS,
      kind: 'badge',
      header: 'QC Status',
      nowrap: true,
      // ADR-235: a Cancelled GRN reads "Cancelled" here instead.
      render: (grn) =>
        isGrnCancelled(grn) ? (
          <span className="badge b-red">Cancelled</span>
        ) : (
          <DocQcBadge status={grn.docQcStatus} draft={draftIds?.has(grn.id)} />
        ),
    },
    // ADR-261 rev — Created By, the last data column.
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
