// PR / PO Approvals inbox — columns for the ADR-199 fit table (one line per
// waiting document, always fits the screen). Split out of routes/page.tsx so
// that file stays the page logic only. The old hand-built table stacked the
// item code and name into one "Item" cell; here each is its own column, as the
// brief asks.

import type { ApprovalInboxRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';

const fmtQty = (n: number | null): string => (n == null ? '—' : n.toLocaleString('en-IN'));

const fmtAmount = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Columns for one inbox section (PR or PO). The header on the first column and
 * the qty/amount columns follow the document kind (`PR No.`/`PO No.`,
 * `PR Qty`/`PO Qty`, `Est. Amount`/`Subtotal`) — the registered names in
 * docs/NAMING.md, never a bare `Qty`/`Amount`. `showAmount` drops the amount
 * column entirely when the caller's access hides prices (`docAmount` null),
 * exactly as the old table did.
 */
export function prPoColumns(
  section: 'pr' | 'po',
  showAmount: boolean,
): DataTableColumn<ApprovalInboxRow>[] {
  return [
    {
      id: 'doc_code',
      sortFilterField: 'docCode',
      kind: 'code',
      header: section === 'pr' ? 'PR No.' : 'PO No.',
      className: 'mono fw-700',
      render: (r) => r.docCode,
      title: (r) => r.docCode,
    },
    {
      id: 'vendor',
      sortFilterField: 'vendorName',
      kind: 'text',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      render: (r) => r.vendorName ?? '—',
      title: (r) => r.vendorName ?? '',
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      className: 'mono fw-700',
      render: (r) =>
        r.itemCode ? <span style={{ color: 'var(--text)' }}>{r.itemCode}</span> : '—',
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (r) => r.itemName ?? '—',
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'qty',
      sortFilterField: 'docQty',
      kind: 'num',
      header: section === 'pr' ? 'PR Qty' : 'PO Qty',
      align: 'right',
      render: (r) => fmtQty(r.docQty),
    },
    ...(showAmount
      ? [
          {
            id: 'amount',
            sortFilterField: 'docAmount',
            kind: 'num' as const,
            header: section === 'pr' ? 'Est. Amount' : 'Subtotal',
            align: 'right' as const,
            render: (r: ApprovalInboxRow) => (r.docAmount != null ? fmtAmount(r.docAmount) : '—'),
          },
        ]
      : []),
    {
      id: 'raised_by',
      sortFilterField: 'createdByName',
      kind: 'text',
      header: 'Raised By',
      align: 'left',
      ellipsis: true,
      render: (r) => r.createdByName ?? '—',
      title: (r) => r.createdByName ?? '',
    },
    {
      id: 'raised_on',
      sortFilterField: 'createdAt',
      kind: 'date',
      header: 'Raised On',
      render: (r) => fmtDate(r.createdAt),
    },
  ];
}
