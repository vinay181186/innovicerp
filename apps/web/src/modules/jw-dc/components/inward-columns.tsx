// Inward Register columns (ADR-199 fit table) — ONE ROW PER RECEIPT again
// (ADR-303, GET /jw-dc/inward). The locked lead block: Sr No · Inward No. ·
// Created On · SO No. (the first line's order + grey "+n"), then Inward Date ·
// DC No. · PO No. · Vendor · Lines · Received · Accepted · Deviated (sums of
// the lines; Accepted / Deviated are the receipt GRN's incoming-QC outcome,
// 0172) · Created By last. No POL / Item Code / Item Name on a document list.

import { type JwDcInwardListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';

/** ADR-235 — a Cancelled JW DC Receipt (listed with includeCancelled):
 *  cancelledAt is the standard Cancel's stamp. */
export function isJwDcInwardCancelled(inv: { cancelledAt: string | null }): boolean {
  return Boolean(inv.cancelledAt);
}

export function inwardColumns(firstRowNo: number): DataTableColumn<JwDcInwardListItem>[] {
  return [
    ...leadColumns<JwDcInwardListItem>({
      firstRowNo,
      doc: {
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
              <span style={{ color: 'var(--green2)' }}>{inv.code}</span>{' '}
              <span className="badge b-red" title={inv.cancelReason ?? undefined}>
                Cancelled
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--green2)' }}>{inv.code}</span>
          ),
      },
      // SO No. kept (the SO dropdown filters this list): the first line's order
      // + a grey "+n"; no Internal SO No. / POL / Item columns on a document list.
      soNo: (r) => r.orderCode,
      createdOn: (r) => r.createdAt,
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          filterType: 'text',
          render: (r) => (
            <>
              <span style={{ color: 'var(--blue)' }}>{r.orderCode ?? '—'}</span>
              {r.orderExtraCount ? <span className="text3"> +{r.orderExtraCount}</span> : null}
            </>
          ),
        },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'inward_date',
      sortFilterField: 'inwardDate',
      kind: 'date',
      header: 'Inward Date',
      className: 'mono text2',
      nowrap: true,
      render: (inv) => fmtDate(inv.inwardDate),
    },
    {
      id: 'dc_no',
      sortFilterField: 'dcNo',
      filterType: 'text',
      kind: 'code',
      header: 'DC No.',
      className: 'mono',
      nowrap: true,
      render: (inv) => <span style={{ color: 'var(--blue)' }}>{inv.dcCodeText ?? '—'}</span>,
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
      render: (inv) => inv.vendorName ?? inv.vendorNameText ?? '—',
      title: (inv) => inv.vendorName ?? inv.vendorNameText ?? '',
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      kind: 'num',
      header: 'Lines',
      className: 'mono',
      render: (inv) => inv.lineCount ?? 0,
    },
    {
      id: 'received',
      sortFilterField: 'receivedQty',
      kind: 'num',
      header: 'Received',
      align: 'right',
      className: 'mono fw-700',
      render: (inv) => inv.totalReceivedQty,
    },
    {
      id: 'accepted',
      sortFilterField: 'acceptedQty',
      kind: 'num',
      header: 'Accepted',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono',
      render: (inv) => <span style={{ color: 'var(--green2)' }}>{inv.totalOkQty}</span>,
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
        <span style={{ color: 'var(--red2)' }}>
          {inv.totalRejectedQty > 0 ? inv.totalRejectedQty : '—'}
        </span>
      ),
    },
    // ADR-261 rev — Created By, the last data column.
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
