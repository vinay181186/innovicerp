// Party Material GRN list columns (ADR-199 fit table, table standard
// 2026-10-01). One line per receipt; the fit engine sizes columns to the screen
// and drops the rightmost unpinned ones into the ▸ detail row. Split out of
// routes/list.tsx to keep that file under the 400-line rule.
//
// Every field the old card showed is kept: the GRN No. keeps its --cyan identity
// colour (this module has NO detail route, so the code is not a link — a blue
// code that did nothing on click would read as broken), the Customer name keeps
// its ellipsis + tooltip, the JWSO its purple, and the Received / Lines metrics
// their mono weight. Received By, Remarks and the per-line QC split move into the
// ▸ expand (party-grn-expand.tsx).
//
// Sort & Filter runs on the SERVER (ADR-200): `sortFilterField` names the field
// in api party-grn/sf-columns.ts.

import type { PartyGrnListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
import { PGRN_QC_BADGE, pgrnQcLabel, pgrnQcStateOfGrn } from '../lib/qc-state';

/** ADR-235 — a Cancelled GRN (listed with includeCancelled). cancelledAt is
 *  the standard Cancel's stamp; deletedAt alone is a GRN cancelled before it. */
export function isPartyGrnCancelled(
  g: Pick<PartyGrnListItem, 'cancelledAt' | 'deletedAt'>,
): boolean {
  return Boolean(g.cancelledAt ?? g.deletedAt);
}

/** Columns off by default (DataTable `defaultHidden`); Columns ▾ shows them. */
export const PARTY_GRN_HIDDEN_COLUMNS = ['created_on'] as const;

export function partyGrnColumns(): DataTableColumn<PartyGrnListItem>[] {
  return [
    {
      id: 'grn_code',
      sortFilterField: 'code',
      header: 'GRN No.',
      kind: 'code',
      nowrap: true,
      render: (g) => (
        <span className="td-code" style={{ color: 'var(--cyan)', fontWeight: 800 }}>
          {g.code}
        </span>
      ),
    },
    {
      id: 'grn_date',
      sortFilterField: 'grnDate',
      header: 'GRN Date',
      kind: 'date',
      className: 'mono',
      nowrap: true,
      render: (g) => fmtDate(g.grnDate),
    },
    {
      id: 'customer',
      sortFilterField: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (g) => g.clientName ?? g.clientCodeText ?? '—',
      title: (g) => g.clientName ?? g.clientCodeText ?? '',
    },
    {
      id: 'jwso_code',
      sortFilterField: 'jwCode',
      header: 'JWSO No.',
      kind: 'code',
      nowrap: true,
      render: (g) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {g.jwCodeText ?? '—'}
        </span>
      ),
    },
    {
      id: 'client_po_no',
      sortFilterField: 'clientPoNo',
      header: 'Client PO No.',
      kind: 'code',
      nowrap: true,
      render: (g) => <span className="mono text2">{g.clientPoNo ?? '—'}</span>,
    },
    {
      id: 'customer_challan_no',
      sortFilterField: 'dcNo',
      header: 'Customer Challan No.',
      kind: 'code',
      nowrap: true,
      render: (g) => <span className="mono text2">{g.dcNo ?? '—'}</span>,
    },
    {
      id: 'received_qty',
      sortFilterField: 'receivedQty',
      header: 'Received Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      nowrap: true,
      render: (g) => (
        <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
          {g.totalReceivedQty}
        </span>
      ),
    },
    {
      // ADR-203: what QC accepted into the customer-material register.
      // No sortFilterField: the API's sf-columns has no accepted-qty field yet.
      id: 'accepted_qty',
      header: 'Accepted Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      nowrap: true,
      render: (g) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {g.totalAcceptedQty}
        </span>
      ),
    },
    {
      // ADR-203 (owner D4): Incoming QC is a separate step after the receipt.
      // ADR-235: a Cancelled GRN reads "Cancelled" here instead. Partial QC
      // (0233): Waiting QC · Partial · n pending · QC done (lib/qc-state.ts).
      id: 'qc_status',
      header: 'QC Status',
      nowrap: true,
      render: (g) => {
        if (isPartyGrnCancelled(g)) return <span className="badge b-red">Cancelled</span>;
        const st = pgrnQcStateOfGrn(g);
        return (
          <span
            className={`badge ${PGRN_QC_BADGE[st]}`}
            title={
              st === 'done'
                ? undefined
                : `${g.qcPendingLines} line(s) with QC Pending · ${g.totalQcPendingQty} pcs`
            }
          >
            {pgrnQcLabel(st, g.totalQcPendingQty)}
          </span>
        );
      },
    },
    {
      id: 'lines',
      sortFilterField: 'linesCount',
      header: 'Lines',
      kind: 'num',
      align: 'right',
      nowrap: true,
      render: (g) => <span className="mono">{g.linesCount}</span>,
    },
    {
      // When the receipt was entered (IST day). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      header: 'Created On',
      kind: 'date',
      className: 'mono',
      nowrap: true,
      render: (g) => fmtDate(g.createdAt),
    },
  ];
}
