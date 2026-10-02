// QC History — the columns of its two tables, QC Pending and QC Entries
// (ADR-199 fit table: one line per row, always fits the screen). Columns carry
// `sortFilterField` — the server's Sort & Filter field (ADR-200/201). Moved out of
// routes/index.tsx. An overdue pending row keeps its red blink through
// DataTable's rowClassName (`qc-alert-blink`).

import {
  type QcHistoryLogRow,
  type QcHistoryPendingRow,
  SHIFT_LABELS,
  opSrNo,
} from '@innovic/shared';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';

export const QC_HISTORY_DEFAULT_PINNED = ['item_code'];

// Sort & Filter (server mode, ADR-200): the Shift tick list — stored code + label.
const SHIFT_OPTIONS = Object.entries(SHIFT_LABELS as Record<string, string>).map(
  ([value, label]) => ({ value, label }),
);

interface QcRowBase {
  jcCode: string;
  opSeq: number;
  soCode: string | null;
  clientPoLineNo: string | null;
  itemCode: string | null;
  itemRevision: string | null;
  itemName: string | null;
  operation: string;
}

/** The seven leading columns both tables share: JC No. … Operation. */
function leadColumns<T extends QcRowBase>(): DataTableColumn<T>[] {
  return [
    {
      id: 'jc_no',
      sortFilterField: 'jcCode',
      kind: 'code',
      header: 'JC No.',
      className: 'td-code cyan',
      render: (o) => o.jcCode,
    },
    {
      id: 'op_seq',
      kind: 'code',
      header: 'Op',
      className: 'mono',
      render: (o) => `Op ${opSrNo(o.opSeq)}`,
    },
    {
      id: 'so_no',
      sortFilterField: 'soCode',
      kind: 'code',
      header: 'SO No.',
      className: 'mono',
      render: (o) => <span style={{ color: 'var(--blue)' }}>{o.soCode ?? '—'}</span>,
    },
    {
      // POL — the CUSTOMER's own purchase-order line number, before the item code.
      id: 'client_po_line_no',
      sortFilterField: 'clientPoLineNo',
      kind: 'code',
      header: 'POL',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (o) => <span style={{ color: 'var(--purple)' }}>{o.clientPoLineNo ?? '—'}</span>,
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      className: 'td-code',
      render: (o) => (
        <span style={{ color: 'var(--text)' }}>{itemCodeWithRev(o.itemCode, o.itemRevision)}</span>
      ),
    },
    {
      // An unresolved item prints nothing — a dash would read as a part that
      // was deliberately left unnamed.
      id: 'item_name',
      sortFilterField: 'itemName',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (o) => o.itemName ?? '',
      title: (o) => o.itemName ?? '',
    },
    {
      id: 'operation',
      sortFilterField: 'operation',
      kind: 'text',
      header: 'Operation',
      ellipsis: true,
      render: (o) => o.operation,
      title: (o) => o.operation,
    },
  ];
}

function numCol<T>(
  id: string,
  header: string,
  pick: (r: T) => number,
  color?: string,
  sortFilterField?: string,
): DataTableColumn<T> {
  return {
    id,
    kind: 'num',
    sortFilterField,
    header,
    align: 'right',
    headColor: color,
    className: 'mono fw-700',
    render: (r) => <span style={color ? { color } : undefined}>{pick(r)}</span>,
  };
}

export function qcPendingColumns(): DataTableColumn<QcHistoryPendingRow>[] {
  return [
    ...leadColumns<QcHistoryPendingRow>(),
    numCol<QcHistoryPendingRow>('order_qty', 'Order Qty', (o) => o.orderQty, undefined, 'orderQty'),
    numCol<QcHistoryPendingRow>(
      'completed',
      'Completed',
      (o) => o.completed,
      undefined,
      'completed',
    ),
    numCol<QcHistoryPendingRow>(
      'accepted',
      'Accepted',
      (o) => o.qcAccepted,
      'var(--green2)',
      'qcAccepted',
    ),
    numCol<QcHistoryPendingRow>(
      'rejected',
      'Rejected',
      (o) => o.qcRejected,
      'var(--red2)',
      'qcRejected',
    ),
    numCol<QcHistoryPendingRow>(
      'qc_pending',
      'QC Pending',
      (o) => o.qcPending,
      'var(--amber2)',
      'qcPending',
    ),
    {
      id: 'pending_since',
      sortFilterField: 'pendSince',
      kind: 'date',
      header: 'Pending Since',
      className: 'text3',
      render: (o) => (
        <>
          {fmtDate(o.pendSince)}
          {o.overdue ? <span style={{ color: 'var(--red2)', fontWeight: 700 }}> ⚠</span> : null}
        </>
      ),
    },
  ];
}

export function qcEntryColumns(): DataTableColumn<QcHistoryLogRow>[] {
  return [
    ...leadColumns<QcHistoryLogRow>(),
    numCol<QcHistoryLogRow>('accepted', 'Accepted', (l) => l.accepted, 'var(--green2)', 'accepted'),
    numCol<QcHistoryLogRow>('rejected', 'Rejected', (l) => l.rejected, 'var(--red2)', 'rejected'),
    {
      id: 'qc_date',
      kind: 'date',
      header: 'QC Date',
      sortFilterField: 'logDate',
      render: (l) => fmtDate(l.logDate),
    },
    {
      id: 'shift',
      sortFilterField: 'shift',
      filterType: 'list',
      filterOptions: SHIFT_OPTIONS,
      kind: 'code',
      header: 'Shift',
      render: (l) =>
        l.shift ? ((SHIFT_LABELS as Record<string, string>)[l.shift] ?? l.shift) : '—',
    },
    {
      id: 'inspected_by',
      sortFilterField: 'inspector',
      kind: 'text',
      header: 'Inspected By',
      ellipsis: true,
      render: (l) => l.inspector ?? '—',
      title: (l) => l.inspector ?? '',
    },
    {
      id: 'remarks',
      sortFilterField: 'remarks',
      kind: 'text',
      header: 'Remarks',
      align: 'left',
      ellipsis: true,
      render: (l) => l.remarks ?? '—',
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
