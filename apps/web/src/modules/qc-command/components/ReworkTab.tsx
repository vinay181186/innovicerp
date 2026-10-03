// Rework Cycles tab (legacy _qccRenderRework L18920). Ops inspected more than
// once, or once with rejects — these directly impact project timeline.
//
// ADR-199 table standard: the data table is the shared fit table
// (<DataTable tableKey={TABLE_KEYS.qcCommandRework}>). One line per row — the
// item code, item name and operation that used to stack in one cell are now
// their own columns. Numbers right-aligned.

import { type QcReworkRow, opSrNo } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { type QcPager, TablePager } from './TablePager';

function attemptColor(attempts: number): string {
  if (attempts === 1) return 'var(--amber)';
  if (attempts === 2) return 'var(--orange2)';
  return 'var(--red)';
}

const columns: DataTableColumn<QcReworkRow>[] = [
  {
    id: 'jc_op',
    header: 'JC / Op',
    nowrap: true,
    className: 'td-code',
    render: (g) => (
      <>
        <span style={{ color: 'var(--cyan)' }}>{g.jcCode}</span>{' '}
        <span style={{ color: 'var(--red2)', fontWeight: 700 }}>Op {opSrNo(g.opSeq)}</span>
      </>
    ),
  },
  {
    // POL — the CUSTOMER's own purchase-order line number, its own column.
    id: 'pol',
    header: 'POL',
    headColor: 'var(--purple)',
    nowrap: true,
    className: 'mono fw-700',
    render: (g) => <span style={{ color: 'var(--purple)' }}>{g.clientPoLineNo ?? '—'}</span>,
  },
  {
    id: 'item_code',
    header: 'Item Code',
    nowrap: true,
    // Item code strong in the body colour (item-code rule).
    render: (g) => (
      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
        {itemCodeWithRev(g.itemCode, g.itemRevision)}
      </span>
    ),
  },
  {
    id: 'item_name',
    header: 'Item Name',
    align: 'left',
    ellipsis: true,
    className: 'fw-700',
    render: (g) => g.itemName?.trim() || '—',
    title: (g) => g.itemName ?? '',
  },
  {
    id: 'operation',
    header: 'Operation',
    align: 'left',
    ellipsis: true,
    className: 'text3',
    render: (g) => g.operation,
    title: (g) => g.operation,
  },
  {
    id: 'so_code',
    header: 'SO No.',
    nowrap: true,
    render: (g) => (
      <span style={{ color: 'var(--cyan)' }}>
        {g.soCode ? soNoWithInternal(g.soCode, g.soInternalNo) : '—'}
      </span>
    ),
  },
  {
    id: 'attempts',
    kind: 'badge',
    header: 'Attempts',
    nowrap: true,
    render: (g) => (
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          padding: '2px 10px',
          borderRadius: 10,
          background: 'var(--bg3)',
          color: attemptColor(g.attempts),
        }}
      >
        {g.attempts}
      </span>
    ),
    filterValue: (g) => g.attempts,
  },
  {
    id: 'rejected',
    header: 'Rejected',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (g) => <span style={{ color: 'var(--red2)' }}>{g.totalRejected}</span>,
  },
  {
    id: 'first_entry',
    kind: 'date',
    header: 'First Entry',
    nowrap: true,
    render: (g) => fmtDate(g.firstEntry),
    filterValue: (g) => g.firstEntry ?? '',
  },
  {
    id: 'last_entry',
    kind: 'date',
    header: 'Last Entry',
    nowrap: true,
    render: (g) => fmtDate(g.lastEntry),
    filterValue: (g) => g.lastEntry ?? '',
  },
  {
    id: 'days_elapsed',
    header: 'Days Elapsed',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (g) => (
      <span style={{ color: g.daysElapsed > 5 ? 'var(--red)' : 'var(--amber)' }}>
        {g.daysElapsed} {g.daysElapsed === 1 ? 'day' : 'days'}
      </span>
    ),
    filterValue: (g) => g.daysElapsed,
  },
];

export function ReworkTab({
  rework,
  pager,
}: {
  /** This page of rework rows (server-paged, ADR-201). */
  rework: QcReworkRow[];
  pager: QcPager;
}): React.JSX.Element {
  return (
    <>
      <div className="panel">
        {/* Legacy L18924 hand-rolls this sub-header instead of .panel-hdr. */}
        <div
          style={{
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 700,
            borderBottom: '1px solid var(--border)',
            color: 'var(--text2)',
          }}
        >
          Rework Cycle Tracking — {pager.total} items with multiple attempts
        </div>
        {pager.total === 0 ? (
          <div className="empty-state" style={{ color: 'var(--green2)' }}>
            No rework cycles yet.
          </div>
        ) : (
          <DataTable
            tableKey={TABLE_KEYS.qcCommandRework}
            columns={columns}
            rows={rework}
            rowKey={(g) => g.jcOpId}
          />
        )}
        {pager.total > 0 ? <TablePager pager={pager} noun="rework item" /> : null}
      </div>
    </>
  );
}
