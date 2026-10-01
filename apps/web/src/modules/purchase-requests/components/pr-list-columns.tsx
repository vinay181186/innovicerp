// Purchase Request list columns (ADR-199 fit table). Moved out of
// routes/list.tsx so that file stays under 400 lines.
//
// Visible order: PR No. (doc no., pinned first) · PR Date · Item Code · Item
// Name · Vendor · PR Qty · On PO · Pending · Due · PR Status. A Sr No column
// ships hidden (defaultHidden in the route). Qty / On PO / Pending are `num`
// (right-aligned, tabular). Everything the old card showed in its title + metric
// bands is here; POL, source, operation, est. rate, approval and PO details move
// into the ▸ expand (pr-list-expand.tsx).

import { type PurchaseRequestListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { prBalanceColor, prOrderBalance } from '../lib/pr-balance';
import { PrStatusBadge } from './pr-status-badge';

export function prListColumns(): DataTableColumn<PurchaseRequestListItem>[] {
  return [
    {
      id: 'pr_no',
      header: 'PR No.',
      kind: 'code',
      nowrap: true,
      // A real link so the code can be ctrl / middle-clicked into a new tab;
      // stopPropagation sits on the link so clicking the rest of the cell still
      // opens the row (same pattern as the vendor list).
      render: (pr) => (
        <Link
          to="/purchase-requests/$id"
          params={{ id: pr.id }}
          className="td-code"
          style={{ color: 'var(--blue)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {pr.code}
        </Link>
      ),
    },
    {
      id: 'sr_no',
      header: 'Sr No',
      kind: 'num',
      className: 'text3',
      render: (_pr, i) => i + 1,
    },
    {
      id: 'pr_date',
      header: 'PR Date',
      kind: 'date',
      nowrap: true,
      render: (pr) => fmtDate(pr.prDate),
    },
    {
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      nowrap: true,
      // CODE/REV — the customer's drawing revision off the SO line behind this
      // request; the bare code when there is no SO line behind it.
      render: (pr) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(pr.itemCode ?? pr.itemCodeText, pr.itemRevision)}
        </span>
      ),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      render: (pr) => pr.itemName ?? '—',
      title: (pr) => pr.itemName ?? '',
    },
    {
      id: 'vendor',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      render: (pr) => (
        <span style={{ color: 'var(--amber2)', fontWeight: 600 }}>
          {pr.vendorName ?? pr.vendorCodeText ?? '—'}
        </span>
      ),
      title: (pr) => pr.vendorName ?? pr.vendorCodeText ?? '',
    },
    {
      id: 'pr_qty',
      header: 'PR Qty',
      kind: 'num',
      className: 'mono fw-700',
      nowrap: true,
      render: (pr) => pr.qty,
    },
    {
      id: 'on_po',
      header: 'On PO',
      kind: 'num',
      className: 'mono',
      nowrap: true,
      render: (pr) => prOrderBalance(pr).ordered,
    },
    {
      id: 'pending',
      header: 'Pending',
      kind: 'num',
      nowrap: true,
      // Negative = more ordered than requested; flagged, never clamped to 0.
      render: (pr) => {
        const bal = prOrderBalance(pr);
        return (
          <span className="mono fw-700" style={{ color: prBalanceColor(bal.state) }}>
            {bal.balance < 0 ? `⚠ ${bal.balance}` : bal.balance}
          </span>
        );
      },
    },
    {
      id: 'due',
      header: 'Due',
      kind: 'date',
      nowrap: true,
      render: (pr) => fmtDate(pr.requiredDate),
    },
    {
      id: 'pr_status',
      header: 'PR Status',
      kind: 'badge',
      nowrap: true,
      render: (pr) => <PrStatusBadge status={pr.status} />,
    },
  ];
}
