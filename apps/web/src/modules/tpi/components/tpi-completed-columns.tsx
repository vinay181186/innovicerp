// Completed TPI records — the table's columns (ADR-199 fit table: one line per
// row, always fits the screen). Moved out of tpi-view.tsx. Rows are plain
// white now (the standard); the legacy inline odd/even stripe is gone.

import { opSrNo, type TpiCompletedRow } from '@innovic/shared';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';

function respLabel(d: number | null): string {
  if (d === null) return '—';
  return d <= 0 ? 'Same day' : `${d} day${d === 1 ? '' : 's'}`;
}

export function tpiCompletedColumns(): DataTableColumn<TpiCompletedRow>[] {
  return [
    // ADR-261 — JC No. (own number) first, the six lead columns, then Op. No
    // server Sort & Filter map in this module, so no sortFilterField.
    ...leadColumns<TpiCompletedRow>({
      doc: {
        id: 'jc_no',
        kind: 'code',
        header: 'JC No.',
        className: 'fw-700 cyan',
        render: (l) => l.jcCode,
      },
      docDate: {
        id: 'jc_date',
        kind: 'date',
        header: 'JC Date',
        className: 'mono',
        nowrap: true,
        render: (l) => fmtDate(l.jcDate ?? null),
        filterValue: (l) => l.jcDate ?? '',
      },
      soNo: (l) => l.soCode,
      internalSoNo: (l) => l.soInternalNo,
      pol: (l) => l.clientPoLineNo,
      createdOn: (l) => l.createdAt,
      itemCode: (l) => l.itemCode,
      itemRev: (l) => l.itemRevision,
      itemName: (l) => l.itemName,
    }),
    { id: 'op_seq', kind: 'code', header: 'Op', render: (l) => `Op ${opSrNo(l.opSeq)}` },
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
      header: 'Deviated',
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
      // The QC Remarks typed on the TPI entry — one line; the full text is in
      // the title and the ▸ detail row when the column folds away.
      id: 'qc_remarks',
      kind: 'text',
      header: 'QC Remarks',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (l) => l.remarks?.trim() || '—',
      title: (l) => l.remarks ?? '',
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
