// Purchase Request list columns (ADR-199 fit table). Moved out of
// routes/list.tsx so that file stays under 400 lines.
//
// Visible order (ADR-261 lead columns first): PR No. · SO No. · Internal SO No. ·
// POL · Created On · Item Code · Item Name · Sr No · PR Date · Vendor · PR Qty ·
// On PO · Pending · Due · PR Status. A Sr No column ships hidden
// (defaultHidden in the route). Qty / On PO / Pending are `num`
// (right-aligned, tabular). Everything the old card showed in its title + metric
// bands is here; POL, source, operation, est. rate, approval and PO details move
// into the ▸ expand (pr-list-expand.tsx).

import { type PurchaseRequestListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import { prBalanceColor, prOrderBalance } from '../lib/pr-balance';
import { PR_STATUS_LABELS } from '../lib/pr-labels';
import { PrStatusBadge } from './pr-status-badge';

/** Sort & Filter tick list (server mode): stored PR status → the label shown. */
const PR_STATUS_OPTIONS = Object.entries(PR_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** @param firstRowNo the Sr No of the page's first row (offset + 1), so Sr No
 *  runs on across pages (page 2 starts at 26). */
export function prListColumns(
  firstRowNo = 1,
  /** ADR-202 — PR ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<PurchaseRequestListItem>[] {
  return [
    ...leadColumns<PurchaseRequestListItem>({
      doc: {
        id: 'pr_no',
        sortFilterField: 'prCode',
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
      docDate: {
        id: 'pr_date',
        sortFilterField: 'prDate',
        header: 'PR Date',
        kind: 'date',
        nowrap: true,
        render: (pr) => fmtDate(pr.prDate),
      },
      soNo: (pr) => pr.soCode,
      internalSoNo: (pr) => pr.soInternalNo,
      pol: (pr) => pr.clientPoLineNo,
      createdOn: (pr) => pr.createdAt,
      itemCode: (pr) => pr.itemCode ?? pr.itemCodeText,
      itemRev: (pr) => pr.itemRevision,
      itemName: (pr) => pr.itemName,
      overrides: {
        so_internal_no: { sortFilterField: 'soInternalNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'sr_no',
      header: 'Sr No',
      kind: 'num',
      className: 'text3',
      render: (_pr, i) => firstRowNo + i,
    },
    {
      id: 'vendor',
      sortFilterField: 'vendorName',
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
      sortFilterField: 'qty',
      header: 'PR Qty',
      kind: 'num',
      className: 'mono fw-700',
      nowrap: true,
      render: (pr) => pr.qty,
    },
    {
      id: 'on_po',
      sortFilterField: 'orderedQty',
      header: 'On PO',
      kind: 'num',
      className: 'mono',
      nowrap: true,
      render: (pr) => prOrderBalance(pr).ordered,
    },
    {
      id: 'pending',
      sortFilterField: 'balanceQty',
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
      sortFilterField: 'requiredDate',
      header: 'Due',
      kind: 'date',
      nowrap: true,
      render: (pr) => fmtDate(pr.requiredDate),
    },
    {
      id: 'pr_status',
      sortFilterField: 'status',
      filterOptions: PR_STATUS_OPTIONS,
      header: 'PR Status',
      kind: 'badge',
      nowrap: true,
      render: (pr) => <PrStatusBadge status={pr.status} draft={draftIds?.has(pr.id)} />,
    },
  ];
}
