// Completed TPI records — the table's columns (ADR-199 fit table: one line per
// row, always fits the screen). Moved out of tpi-view.tsx. Rows are plain
// white now (the standard); the legacy inline odd/even stripe is gone.

import { opSrNo, type TpiCompletedRow } from '@innovic/shared';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import type { DataTableColumn } from '@/ui/data';

export const TPI_COMPLETED_DEFAULT_PINNED = ['item_code'];

function respLabel(d: number | null): string {
  if (d === null) return '—';
  return d <= 0 ? 'Same day' : `${d} day${d === 1 ? '' : 's'}`;
}

export function tpiCompletedColumns(): DataTableColumn<TpiCompletedRow>[] {
  return [
    {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'fw-700 cyan',
      render: (l) => l.jcCode,
    },
    { id: 'op_seq', kind: 'code', header: 'Op', render: (l) => `Op ${opSrNo(l.opSeq)}` },
    {
      id: 'so_no',
      kind: 'code',
      header: 'SO No.',
      render: (l) => (
        <span style={{ color: 'var(--cyan)' }}>
          {l.soCode ? soNoWithInternal(l.soCode, l.soInternalNo) : '—'}
        </span>
      ),
    },
    {
      // POL — the CUSTOMER's own purchase-order line number, before the item code.
      id: 'client_po_line_no',
      kind: 'code',
      header: 'POL',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (l) => <span style={{ color: 'var(--purple)' }}>{l.clientPoLineNo ?? '—'}</span>,
    },
    {
      id: 'item_code',
      kind: 'code',
      header: 'Item Code',
      className: 'mono fw-700',
      render: (l) => (
        <span style={{ color: 'var(--text)' }}>{itemCodeWithRev(l.itemCode, l.itemRevision)}</span>
      ),
    },
    {
      // An item the join could not resolve prints nothing — a dash would read
      // as a part deliberately left unnamed.
      id: 'item_name',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (l) => l.itemName ?? '',
      title: (l) => l.itemName ?? '',
    },
    {
      id: 'operation',
      kind: 'text',
      header: 'Operation',
      ellipsis: true,
      render: (l) => l.operation,
      title: (l) => l.operation,
    },
    {
      id: 'accepted',
      kind: 'num',
      header: 'Accepted',
      align: 'right',
      className: 'mono fw-700',
      render: (l) => <span style={{ color: 'var(--green2)' }}>{l.accepted}</span>,
    },
    {
      id: 'rejected',
      kind: 'num',
      header: 'Rejected',
      align: 'right',
      className: 'mono fw-700',
      render: (l) => (
        <span style={{ color: l.rejected > 0 ? 'var(--red2)' : 'var(--text3)' }}>{l.rejected}</span>
      ),
    },
    {
      id: 'call_date',
      kind: 'date',
      header: 'Call Date',
      render: (l) => <span style={{ color: 'var(--amber2)' }}>{fmtDate(l.callDate)}</span>,
    },
    {
      id: 'tpi_date',
      kind: 'date',
      header: 'TPI Date',
      render: (l) => <span style={{ color: 'var(--green2)' }}>{fmtDate(l.attendedDate)}</span>,
    },
    {
      id: 'days_to_attend',
      kind: 'code',
      header: 'Days to Attend',
      className: 'fw-700',
      render: (l) => (
        <span
          style={{
            color: l.respDays !== null && l.respDays <= 0 ? 'var(--green)' : 'var(--amber)',
          }}
        >
          {respLabel(l.respDays)}
        </span>
      ),
    },
    {
      id: 'inspector_name',
      kind: 'text',
      header: 'Inspector Name',
      ellipsis: true,
      className: 'fw-700',
      render: (l) => <span style={{ color: 'var(--purple)' }}>{l.inspector ?? '—'}</span>,
      title: (l) => l.inspector ?? '',
    },
    {
      id: 'organisation',
      kind: 'text',
      header: 'Organisation',
      ellipsis: true,
      className: 'text2',
      render: (l) => l.organization ?? '—',
      title: (l) => l.organization ?? '',
    },
    {
      id: 'tpi_certificate_no',
      kind: 'code',
      header: 'TPI Certificate No.',
      className: 'fw-700',
      render: (l) => <span style={{ color: 'var(--purple)' }}>{l.certNo ?? '—'}</span>,
    },
    {
      id: 'report',
      kind: 'code',
      header: 'Report',
      stopRowClick: true,
      render: (l) =>
        l.qcReportPath ? (
          <QcReportLink path={l.qcReportPath} name={l.qcReportName} label="Report" />
        ) : (
          '—'
        ),
    },
  ];
}
