// Party Material GRN list columns (ADR-199 fit table). ADR-303 (2026-11-16):
// ONE ROW PER PARTY GRN again (GET /party-grn); /party-grn/lines stays for
// export. Lead block Sr No · GRN No. · Created On · SO No. (the GRN's one
// order: ADR-307 GRNs against an Equipment SO show the SO No., the rest the
// JWSO No. — NAMING.md "SO No." on a list carrying both; no Internal SO No.;
// no POL / Item columns). Then
// GRN Date · Customer · Client PO No. · Customer Challan No. · Lines ·
// Received Qty · Accepted Qty (Σ lines) · QC Status (ONE status rolled up from
// the lines, server-side) · Created By. The GRN No. keeps its --cyan identity
// colour and opens the detail page (ADR-294).
//
// Sort & Filter runs on the SERVER (ADR-200): `sortFilterField` names the field
// in api party-grn/sf-columns.ts PARTY_GRN_SF_COLUMNS.

import type { PartyGrnListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { DOC_QC_OPTIONS, DocQcBadge } from '@/modules/goods-receipt-notes/components/doc-qc-badge';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';

/** ADR-235 — a Cancelled GRN (listed with includeCancelled). cancelledAt is
 *  the standard Cancel's stamp; deletedAt alone is a GRN cancelled before it. */
export function isPartyGrnCancelled(
  g: Pick<PartyGrnListItem, 'cancelledAt' | 'deletedAt'>,
): boolean {
  return Boolean(g.cancelledAt ?? g.deletedAt);
}

export function partyGrnColumns(firstRowNo: number): DataTableColumn<PartyGrnListItem>[] {
  return [
    ...leadColumns<PartyGrnListItem>({
      firstRowNo,
      doc: {
        id: 'grn_code',
        sortFilterField: 'code',
        header: 'GRN No.',
        kind: 'code',
        nowrap: true,
        render: (r) => (
          <span className="td-code" style={{ color: 'var(--cyan)', fontWeight: 800 }}>
            {r.code}
          </span>
        ),
      },
      // ADR-307 — one order column: the SO No. of an Equipment SO GRN, else
      // the JWSO No. (NAMING.md: a list with both keeps the heading SO No.).
      so: 'so',
      soNo: (r) => r.soCode ?? r.jwCodeText,
      createdOn: (r) => r.createdAt,
      overrides: {
        so_no: { sortFilterField: 'jwCode' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'grn_date',
      sortFilterField: 'grnDate',
      header: 'GRN Date',
      kind: 'date',
      className: 'mono',
      nowrap: true,
      render: (r) => fmtDate(r.grnDate),
    },
    {
      id: 'customer',
      sortFilterField: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (r) => r.clientName ?? r.clientCodeText ?? '—',
      title: (r) => r.clientName ?? r.clientCodeText ?? '',
    },
    {
      id: 'client_po_no',
      sortFilterField: 'clientPoNo',
      header: 'Client PO No.',
      kind: 'code',
      nowrap: true,
      render: (r) => <span className="mono text2">{r.clientPoNo ?? '—'}</span>,
    },
    {
      id: 'customer_challan_no',
      sortFilterField: 'dcNo',
      header: 'Customer Challan No.',
      kind: 'code',
      nowrap: true,
      render: (r) => <span className="mono text2">{r.dcNo ?? '—'}</span>,
    },
    {
      id: 'line_count',
      sortFilterField: 'linesCount',
      header: 'Lines',
      kind: 'num',
      className: 'mono',
      nowrap: true,
      render: (r) => r.linesCount,
    },
    {
      id: 'received_qty',
      sortFilterField: 'receivedQty',
      header: 'Received Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
          {r.totalReceivedQty}
        </span>
      ),
    },
    {
      // ADR-203: what QC accepted into the customer-material register.
      id: 'accepted_qty',
      sortFilterField: 'acceptedQty',
      header: 'Accepted Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {r.totalAcceptedQty}
        </span>
      ),
    },
    {
      // ADR-303 — ONE status for the receipt, rolled up from its lines.
      // ADR-235: a Cancelled GRN reads "Cancelled".
      id: 'qc_status',
      sortFilterField: 'docQcStatus',
      filterOptions: DOC_QC_OPTIONS,
      kind: 'badge',
      header: 'QC Status',
      nowrap: true,
      render: (r) =>
        isPartyGrnCancelled(r) ? (
          <span className="badge b-red">Cancelled</span>
        ) : (
          <DocQcBadge status={r.docQcStatus} />
        ),
    },
    // ADR-261 rev — Created By, the last data column.
    createdByColumn({
      createdByName: (r) => r.createdByName ?? null,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
