// Party Material GRN list columns (ADR-199 fit table; ADR-261 one row per
// GRN LINE, GET /party-grn/lines). Split out of routes/list.tsx to keep that
// file under the 400-line rule.
//
// Visible order: the lead block (GRN No. · JWSO No. · POL · Created On · Item
// Code/Rev · Item Name — a JWSO-only list, so no Internal SO No.), then GRN
// Date · Customer · Client PO No. · Customer Challan No. · Received Qty ·
// Accepted Qty · QC Status. The item is what the line RECEIVED (the JWSO
// line's customer RM) with the JWSO line's drawing revision. The GRN No. keeps
// its --cyan identity colour (no detail route, so the code is not a link).
// Received By, Remarks, the full per-line QC split and History stay in the ▸
// expand (party-grn-expand.tsx) — it is the GRN's only detail surface.
//
// Sort & Filter runs on the SERVER (ADR-200): `sortFilterField` names the field
// in api party-grn/sf-columns.ts PARTY_GRN_LINE_SF_COLUMNS.

import type { PartyGrnLineListRow, PartyGrnListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import { PGRN_QC_BADGE, pgrnQcLabel, pgrnQcState } from '../lib/qc-state';

/** ADR-235 — a Cancelled GRN (listed with includeCancelled). cancelledAt is
 *  the standard Cancel's stamp; deletedAt alone is a GRN cancelled before it. */
export function isPartyGrnCancelled(
  g: Pick<PartyGrnListItem, 'cancelledAt' | 'deletedAt'>,
): boolean {
  return Boolean(g.cancelledAt ?? g.deletedAt);
}

export function partyGrnColumns(): DataTableColumn<PartyGrnLineListRow>[] {
  return [
    ...leadColumns<PartyGrnLineListRow>({
      doc: {
        id: 'grn_code',
        sortFilterField: 'code',
        header: 'GRN No.',
        kind: 'code',
        nowrap: true,
        render: (r) => (
          <span className="td-code" style={{ color: 'var(--cyan)', fontWeight: 800 }}>
            {r.docCode}
          </span>
        ),
      },
      docDate: {
        id: 'grn_date',
        sortFilterField: 'grnDate',
        header: 'GRN Date',
        kind: 'date',
        className: 'mono',
        nowrap: true,
        render: (r) => fmtDate(r.docDate),
      },
      so: 'jwso',
      soNo: (r) => r.jwCode,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.itemName,
      overrides: {
        so_no: { sortFilterField: 'jwCode' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'customer',
      sortFilterField: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (r) => r.customerName ?? '—',
      title: (r) => r.customerName ?? '',
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
      id: 'received_qty',
      sortFilterField: 'receivedQty',
      header: 'Received Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
          {r.receivedQty}
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
          {r.acceptedQty}
        </span>
      ),
    },
    {
      // ADR-203 (owner D4): Incoming QC is a separate step after the receipt.
      // ADR-235: a Cancelled GRN reads "Cancelled". Part QC (0233), per LINE:
      // Waiting QC · Part QC · n pending · QC done (lib/qc-state.ts).
      id: 'qc_status',
      header: 'QC Status',
      nowrap: true,
      render: (r) => {
        if (r.docStatus === 'cancelled') return <span className="badge b-red">Cancelled</span>;
        const st = pgrnQcState(r);
        return (
          <span className={`badge ${PGRN_QC_BADGE[st]}`}>{pgrnQcLabel(st, r.qcPendingQty)}</span>
        );
      },
    },
  ];
}
