// Goods Receipt Note list columns (ADR-199 fit table: one line per GRN). Moved
// out of routes/list.tsx so that file stays under the 400-line ceiling. Centred
// by the table standard; numbers right-aligned (align 'right' -> the num kind);
// only the Vendor name is left-aligned and shares the spare width.
//
// Columns, first pinned: GRN No. · GRN Date · Vendor · GRN Type · PO/NC No. ·
// Received · QC Status · Accepted · Deviated. Every field was already shown by
// the retired card layout — Received / Accepted / Deviated came off the metric
// strip, GRN Type off the "Against NC / DC / PO" badge, PO/NC No. off the meta
// line. Nothing new.

import type { GoodsReceiptNoteListItem, GrnQcStatus } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
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
  if (grn.purchaseOrderId) return 'Against PO';
  return null;
}

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
      id: 'source',
      kind: 'badge',
      // Was `Source`. One fact, one name (CLAUDE.md §18): the create and edit
      // screens have always called this field `GRN Type`, and `Source` is one
      // of the bare words §18 bans — the GRN also has a source PO, a source DC
      // and a source NC. The column id stays `source` so a saved column layout
      // (ADR-199 Columns ▾) keeps working.
      header: 'GRN Type',
      nowrap: true,
      // `Against DC` here was a fourth spelling of the type the form calls
      // `Against JW PO / DC`; the registered words win (never shorten a
      // registered label to make a cell fit).
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
      id: 'item_code',
      header: 'Item Code',
      nowrap: true,
      // First line's item; "+N more" when the GRN has further lines.
      render: (grn) =>
        grn.firstItemCode ? (
          <>
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {grn.firstItemCode}
            </span>
            {grn.lineCount > 1 && (
              <span className="text3" style={{ fontSize: 11 }}>
                {' '}
                +{grn.lineCount - 1} more
              </span>
            )}
          </>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (grn) => grn.firstItemName ?? '—',
      title: (grn) => grn.firstItemName ?? '',
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
      // The verdict, THEN the split it breaks into. Moved ahead of
      // Accepted / Deviated on 2026-10-06 so that all four GRN surfaces — this
      // list, its expanded row, the detail page and the print — read in one
      // order. This list was the last one disagreeing.
      id: 'qc_status',
      kind: 'badge',
      header: 'QC Status',
      nowrap: true,
      render: (grn) => <QcStatusBadge status={qcStatusFor(grn)} />,
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
      // When the GRN record was entered (IST day) — Sort & Filter can pick a
      // range of it (ADR-200). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'mono',
      nowrap: true,
      render: (grn) => fmtDate(grn.createdAt),
    },
  ];
}
