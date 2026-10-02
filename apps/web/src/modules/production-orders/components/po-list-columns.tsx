// Production Orders master — the fit table's columns and row tint (ADR-199,
// table standard 2026-10-01). Split out of routes/list.tsx so that file stays
// under the 400-line ceiling and the sheet is defined in one place, exactly as
// SO Master does it (so-list-columns.tsx is the reference).
//
// One row per order. The first column (Production Order No.) is always pinned
// and carries the fit table's ▸ — the row's one expand control. The four
// secondary facts (Plan No., SO / JWSO No., POL, JC No.) ship hidden by default
// (defaultHidden in list.tsx), so they ride in the ▸ detail row rather than the
// main line. Labels per docs/NAMING.md: Production Order No., Production Order
// Date, Item Code, Item Name, Order Qty, Completed, Production Order Status,
// PRO Target Date (the order's own target date, owner label 2026-09-30), plus
// Plan No., SO / JWSO No., POL, JC No. in the ▸.

import type { ProductionOrderListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { ROW_TINT } from '@/ui/data';
import { PoStatusBadge } from './po-status-badge';

/**
 * Whole-row wash by the REAL Production Order status enum only (ADR-199
 * ROW_TINT), so the wash agrees with the PoStatusBadge colour one for one:
 *   open             → no wash   (nothing credited yet)
 *   partially_closed → pending   (amber — some pieces credited, under way)
 *   closed           → done      (green — fully credited)
 *   short_closed     → cancelled (grey — stopped, a dead end)
 */
export function poRowTint(po: ProductionOrderListItem): string | undefined {
  switch (po.status) {
    case 'partially_closed':
      return ROW_TINT.pending;
    case 'closed':
      return ROW_TINT.done;
    case 'short_closed':
      return ROW_TINT.cancelled;
    default:
      return undefined;
  }
}

/** Completed colour: green once every ordered piece is finished, amber while
 *  some are, quiet while none are — the rule the retired react-table used. */
function completedColor(po: ProductionOrderListItem): string {
  if (po.jcFinishedQty >= po.orderQty && po.orderQty > 0) return 'var(--green)';
  if (po.jcFinishedQty > 0) return 'var(--amber)';
  return 'var(--text3)';
}

export function poListColumns(): DataTableColumn<ProductionOrderListItem>[] {
  return [
    {
      id: 'pro_no',
      header: 'Production Order No.',
      kind: 'code',
      sortField: 'code',
      nowrap: true,
      // The row's ▸ (fit engine) opens the detail strip; the link opens the PRO
      // detail page. stopPropagation on the link only, so clicking the rest of
      // the cell still opens the row.
      render: (po) => (
        <Link
          to="/production-orders/$id"
          params={{ id: po.id }}
          className="td-code"
          title="Open the Production Order detail page"
          style={{ color: 'var(--text)', fontWeight: 700, textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {po.code}
        </Link>
      ),
    },
    {
      id: 'pro_date',
      header: 'Production Order Date',
      kind: 'date',
      sortField: 'createdAt',
      className: 'mono',
      nowrap: true,
      render: (po) => fmtDate(po.createdAt),
    },
    {
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      sortField: 'itemCodeText',
      className: 'td-code',
      nowrap: true,
      render: (po) => (
        <span className="td-code" style={{ color: 'var(--text)', fontWeight: 700 }}>
          {/* CODE/REV (ADR-177); bare code when the line has no revision. */}
          {itemCodeWithRev(po.itemCodeText, po.itemRevision)}
        </span>
      ),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      kind: 'text',
      sortField: 'itemNameText',
      align: 'left',
      className: 'text2',
      ellipsis: true,
      render: (po) => po.itemNameText ?? '—',
      title: (po) => po.itemNameText ?? '',
    },
    {
      id: 'order_qty',
      header: 'Order Qty',
      kind: 'num',
      align: 'right',
      sortField: 'orderQty',
      className: 'mono fw-700',
      nowrap: true,
      render: (po) => po.orderQty,
    },
    {
      id: 'completed',
      header: 'Completed',
      kind: 'num',
      align: 'right',
      sortField: 'jcFinishedQty',
      className: 'mono fw-700',
      nowrap: true,
      render: (po) => <span style={{ color: completedColor(po) }}>{po.jcFinishedQty}</span>,
    },
    {
      id: 'pro_status',
      header: 'Production Order Status',
      kind: 'badge',
      sortField: 'status',
      nowrap: true,
      render: (po) => <PoStatusBadge status={po.status} />,
    },
    {
      id: 'pro_target_date',
      header: 'PRO Target Date',
      kind: 'date',
      sortField: 'targetDate',
      className: 'mono',
      nowrap: true,
      render: (po) => fmtDate(po.targetDate),
    },
    // ── Secondary facts — ship hidden (defaultHidden), ride in the ▸ detail ──
    {
      id: 'plan_no',
      header: 'Plan No.',
      kind: 'code',
      sortField: 'planCodeText',
      className: 'mono',
      nowrap: true,
      render: (po) => (
        <Link
          to="/plans/$id"
          params={{ id: po.planId }}
          className="mono"
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {po.planCodeText}
        </Link>
      ),
    },
    {
      id: 'so_jwso',
      header: 'SO / JWSO No.',
      kind: 'code',
      sortField: 'soCodeText',
      className: 'mono',
      nowrap: true,
      render: (po) =>
        po.soCodeText ? (
          <span>
            {po.soCodeText}
            {po.lineNo ? <span className="text3">/{po.lineNo}</span> : null}
          </span>
        ) : (
          '—'
        ),
    },
    {
      // POL — the line number printed on the CUSTOMER's own purchase order, off
      // the SO line behind this Production Order. NOT our SO line number (that is
      // the "/n" in the SO / JWSO column).
      id: 'pol',
      header: 'POL',
      kind: 'code',
      headColor: 'var(--purple)',
      sortField: 'clientPoLineNo',
      className: 'mono fw-700',
      nowrap: true,
      render: (po) => <span style={{ color: 'var(--purple)' }}>{po.clientPoLineNo ?? '—'}</span>,
    },
    {
      id: 'jc_no',
      header: 'JC No.',
      kind: 'code',
      sortField: 'jcCodeText',
      className: 'td-code',
      nowrap: true,
      render: (po) => (
        <Link
          to="/job-cards/$id"
          params={{ id: po.jobCardId }}
          className="td-code"
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {po.jcCodeText}
        </Link>
      ),
    },
  ];
}

/** Column ids shipped in the ▸ detail by default (Plan No., SO / JWSO, POL,
 *  JC No.), so the eight primary facts stay on the main line. */
export const PO_LIST_DETAIL_IDS = ['plan_no', 'so_jwso', 'pol', 'jc_no'];
