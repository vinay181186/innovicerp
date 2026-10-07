// The PO's line items, revealed in place under an opened row in the Purchase
// Orders list (ADR-199 ▸ expand). Its own fetch — the list endpoint carries no
// lines, so only a row actually opened costs a request. Mirrors the BOM master
// list's ExpandedLines and uses the compact nested-table density.
//
// Shows the line detail the list row cannot: POL, item (CODE/REV) + name, qty,
// received and due date. Prices stay off the expand — the header Value column
// already carries the gated money.

import type { PurchaseOrderLine } from '@innovic/shared';
import { useMemo } from 'react';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { PageState } from '@/ui/layout';
import { usePurchaseOrder } from '../api';

export function PoExpandedLines({ poId }: { poId: string }): React.JSX.Element {
  const { data, isLoading } = usePurchaseOrder(poId);

  const columns = useMemo<DataTableColumn<PurchaseOrderLine>[]>(
    () => [
      {
        header: 'Sr No',
        width: '6%',
        className: 'mono fw-700',
        align: 'right',
        render: (_l, i) => i + 1,
      },
      {
        id: 'pol',
        header: 'POL',
        nowrap: true,
        render: (l) =>
          l.clientPoLineNo ? (
            <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
              {l.clientPoLineNo}
            </span>
          ) : (
            <span className="text3">—</span>
          ),
      },
      {
        id: 'item_code',
        header: 'Item Code',
        className: 'td-code',
        nowrap: true,
        render: (l) => itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision),
      },
      {
        id: 'item_name',
        header: 'Item Name',
        align: 'left',
        ellipsis: true,
        render: (l) => l.itemName?.trim() || '—',
        title: (l) => l.itemName ?? '',
      },
      {
        id: 'qty',
        header: 'Qty',
        align: 'right',
        className: 'mono fw-700',
        nowrap: true,
        render: (l) => l.qty,
      },
      {
        id: 'received',
        // ADR-222 — what this line's GRNs booked in, not the in-hand figure.
        header: 'GRN Received',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span
            className="mono fw-700"
            style={{ color: l.grnReceivedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
          >
            {l.grnReceivedQty}
          </span>
        ),
      },
      {
        id: 'due_date',
        kind: 'date',
        header: 'Due Date',
        className: 'mono',
        nowrap: true,
        render: (l) => fmtDate(l.dueDate),
      },
    ],
    [],
  );

  if (isLoading) {
    return <PageState as="inline" state="loading" message="⟳ Loading lines…" />;
  }
  if (!data) return <PageState as="inline" state="empty" message="—" />;

  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        className="mono fw-700"
        style={{ fontSize: 'var(--fs-xs)', color: 'var(--blue)', marginBottom: 'var(--sp-1)' }}
      >
        ▸ Line Items — {data.code}
      </div>
      <DataTable columns={columns} rows={data.lines} density="compact" emptyText="No lines yet." />
    </div>
  );
}
