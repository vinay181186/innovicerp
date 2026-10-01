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

import type { PartyGrnListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';

export function partyGrnColumns(): DataTableColumn<PartyGrnListItem>[] {
  return [
    {
      id: 'grn_code',
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
      header: 'GRN Date',
      kind: 'date',
      className: 'mono',
      nowrap: true,
      render: (g) => fmtDate(g.grnDate),
    },
    {
      id: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (g) => g.clientName ?? g.clientCodeText ?? '—',
      title: (g) => g.clientName ?? g.clientCodeText ?? '',
    },
    {
      id: 'jwso_code',
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
      header: 'Client PO No.',
      kind: 'code',
      nowrap: true,
      render: (g) => <span className="mono text2">{g.clientPoNo ?? '—'}</span>,
    },
    {
      id: 'customer_challan_no',
      header: 'Customer Challan No.',
      kind: 'code',
      nowrap: true,
      render: (g) => <span className="mono text2">{g.dcNo ?? '—'}</span>,
    },
    {
      id: 'received_qty',
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
      id: 'lines',
      header: 'Lines',
      kind: 'num',
      align: 'right',
      nowrap: true,
      render: (g) => <span className="mono">{g.linesCount}</span>,
    },
  ];
}
