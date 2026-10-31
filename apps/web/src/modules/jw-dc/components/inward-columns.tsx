// Inward Register columns (ADR-199 fit table) — ONE ROW PER RECEIPT LINE
// (ADR-261). The six locked lead columns first (SO No. = the SO code, else the
// JWSO code; Internal SO No. only for an SO), then Inward No. · Inward Date ·
// DC No. · PO No. · Vendor · Received · Accepted · Deviated for THIS line.
// Received / Accepted / Deviated are the line's qty and its incoming-QC outcome
// (0172). Vendor Challan No. and the GRN link sit in the ▸ detail row.

import { type JwDcInwardLineRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { type DataTableColumn, leadColumns } from '@/ui/data';

/** ADR-235 — a Cancelled JW DC Receipt (listed with includeCancelled):
 *  cancelledAt is the standard Cancel's stamp. */
export function isJwDcInwardCancelled(inv: { cancelledAt: string | null }): boolean {
  return Boolean(inv.cancelledAt);
}

export function inwardColumns(): DataTableColumn<JwDcInwardLineRow>[] {
  return [
    ...leadColumns<JwDcInwardLineRow>({
      soNo: (r) => r.soCode ?? r.jwCode,
      internalSoNo: (r) => r.soInternalNo,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.itemName,
      overrides: {
        so_no: { sortFilterField: 'soCode', filterType: 'text' },
        so_internal_no: { sortFilterField: 'soInternalNo', filterType: 'text' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo', filterType: 'text' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode', filterType: 'text' },
        item_name: { sortFilterField: 'itemName', filterType: 'text' },
      },
    }),
    {
      id: 'inward_no',
      sortFilterField: 'code',
      filterType: 'text',
      kind: 'code',
      header: 'Inward No.',
      className: 'mono fw-700',
      nowrap: true,
      // ADR-235: a Cancelled receipt carries a "Cancelled" mark beside its number.
      render: (inv) =>
        isJwDcInwardCancelled(inv) ? (
          <>
            <span style={{ color: 'var(--green2)' }}>{inv.docCode}</span>{' '}
            <span className="badge b-red" title={inv.cancelReason ?? undefined}>
              Cancelled
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--green2)' }}>{inv.docCode}</span>
        ),
    },
    {
      id: 'inward_date',
      sortFilterField: 'inwardDate',
      kind: 'date',
      header: 'Inward Date',
      className: 'mono text2',
      nowrap: true,
      render: (inv) => fmtDate(inv.docDate),
    },
    {
      id: 'dc_no',
      sortFilterField: 'dcNo',
      filterType: 'text',
      kind: 'code',
      header: 'DC No.',
      className: 'mono',
      nowrap: true,
      render: (inv) => <span style={{ color: 'var(--purple)' }}>{inv.dcCodeText ?? '—'}</span>,
    },
    {
      id: 'po_no',
      sortFilterField: 'poNo',
      filterType: 'text',
      kind: 'code',
      header: 'PO No.',
      className: 'mono',
      nowrap: true,
      render: (inv) => <span style={{ color: 'var(--cyan)' }}>{inv.jwpoCodeText ?? '—'}</span>,
    },
    {
      id: 'vendor',
      sortFilterField: 'vendor',
      filterType: 'text',
      kind: 'text',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (inv) => inv.vendorName ?? '—',
      title: (inv) => inv.vendorName ?? '',
    },
    {
      id: 'received',
      sortFilterField: 'receivedQty',
      kind: 'num',
      header: 'Received',
      align: 'right',
      className: 'mono fw-700',
      render: (inv) => inv.receivedQty,
    },
    {
      id: 'accepted',
      sortFilterField: 'acceptedQty',
      kind: 'num',
      header: 'Accepted',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono',
      render: (inv) => <span style={{ color: 'var(--green2)' }}>{inv.okQty}</span>,
    },
    {
      id: 'rejected',
      sortFilterField: 'rejectedQty',
      kind: 'num',
      header: 'Deviated',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono',
      render: (inv) => (
        <span style={{ color: 'var(--red2)' }}>{inv.rejectedQty > 0 ? inv.rejectedQty : '—'}</span>
      ),
    },
  ];
}
