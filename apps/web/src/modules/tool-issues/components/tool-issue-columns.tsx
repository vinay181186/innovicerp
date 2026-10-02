// Tool Issue Register columns (ADR-199 fit table). First column (Issue No.) is
// pinned by the stylesheet. Numbers right-align, text centres, the item name
// rides under its code. Return status drives both the badge and the row wash
// (ROW_TINT, set in the view). Sort & Filter runs on the SERVER (ADR-200):
// `sortFilterField` names the field in api tool-issues/sf-columns.ts.

import { type ToolIssueListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The Return Status badge values, as the server's sf column computes them. */
const RETURN_STATUS_OPTIONS = [
  { value: 'out', label: 'Out' },
  { value: 'partial', label: 'Partly Returned' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'returned', label: 'Returned' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Columns off by default (DataTable `defaultHidden`); Columns ▾ shows them. */
export const TOOL_ISSUE_HIDDEN_COLUMNS = ['created_on'] as const;

function statusBadge(t: ToolIssueListItem): React.JSX.Element {
  if (t.cancelledAt) return <span className="badge b-red">Cancelled</span>;
  if (t.returnStatus === 'returned') return <span className="badge b-green">Returned</span>;
  if (t.isOverdue) return <span className="badge b-red">Overdue</span>;
  if (t.returnStatus === 'partial') return <span className="badge b-amber">Partly Returned</span>;
  return <span className="badge b-amber">Out</span>;
}

export function toolIssueColumns(): DataTableColumn<ToolIssueListItem>[] {
  return [
    {
      id: 'issue_no',
      sortFilterField: 'code',
      kind: 'code',
      header: 'Issue No.',
      className: 'td-code',
      nowrap: true,
      render: (t) => <span style={{ color: 'var(--cyan)' }}>{t.code}</span>,
    },
    {
      id: 'issue_date',
      sortFilterField: 'issueDate',
      kind: 'date',
      header: 'Issue Date',
      className: 'mono text2',
      nowrap: true,
      render: (t) => fmtDate(t.issueDate),
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      align: 'left',
      render: (t) => (
        <>
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {t.itemCode ?? '—'}
          </span>
          {t.itemName ? (
            <div className="text3" style={{ fontSize: 11 }}>
              {t.itemName}
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: 'serial_no',
      sortFilterField: 'serialNos',
      kind: 'code',
      header: 'Instrument Serial No.',
      className: 'mono',
      render: (t) => t.serialNos || '—',
    },
    {
      id: 'issue_qty',
      sortFilterField: 'qty',
      kind: 'num',
      header: 'Issue Qty',
      align: 'right',
      className: 'mono fw-700',
      render: (t) => r3(t.qty),
    },
    {
      id: 'issued_to',
      sortFilterField: 'issuedTo',
      kind: 'text',
      header: 'Issued To',
      render: (t) => t.issuedTo || '—',
    },
    {
      id: 'expected_return',
      sortFilterField: 'expectedReturnDate',
      kind: 'date',
      header: 'Expected Return',
      className: 'mono text2',
      nowrap: true,
      render: (t) => (t.expectedReturnDate ? fmtDate(t.expectedReturnDate) : '—'),
    },
    {
      id: 'returned_good',
      sortFilterField: 'goodQty',
      kind: 'num',
      header: 'Returned Good',
      align: 'right',
      className: 'mono',
      render: (t) => r3(t.goodQty),
    },
    {
      id: 'still_out',
      sortFilterField: 'stillOutQty',
      kind: 'num',
      header: 'Still Out',
      align: 'right',
      className: 'mono fw-700',
      render: (t) => (
        <>
          {r3(t.stillOutQty)}
          {t.writeoffPendingQty > 0 ? (
            <div style={{ fontSize: 10, color: 'var(--amber2)' }}>
              {r3(t.writeoffPendingQty)} write-off pending
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: 'return_status',
      sortFilterField: 'returnStatus',
      filterOptions: RETURN_STATUS_OPTIONS,
      kind: 'badge',
      header: 'Return Status',
      render: (t) => statusBadge(t),
    },
    {
      // When the issue was entered (IST day). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'mono text2',
      nowrap: true,
      render: (t) => fmtDate(t.createdAt),
    },
  ];
}
