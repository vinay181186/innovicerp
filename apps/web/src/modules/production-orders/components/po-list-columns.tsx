// Production Orders master — the fit table's columns and row tint (ADR-199,
// table standard 2026-10-01). Split out of routes/list.tsx so that file stays
// under the 400-line ceiling and the sheet is defined in one place, exactly as
// SO Master does it (so-list-columns.tsx is the reference).
//
// One row per order. The first column is Sr No (owner 2026-10-26); it is
// always pinned and carries the fit table's ▸ — the row's one expand control.
// Production Order No. follows it and is pinned by default (PO_LIST_PINNED_IDS). The five
// secondary facts (Plan No., SO / JWSO No., Internal SO No., POL, JC No.) ship
// hidden by default (defaultHidden in list.tsx), so they ride in the ▸ detail
// row rather than the main line. Labels per docs/NAMING.md: Production Order
// No., Production Order Date, Item Code, Item Name, Order Qty, Completed,
// Stock Received, Short Closed Qty (ADR-233), Production Order Status, PRO Target Date (the order's own target date, owner
// label 2026-09-30), plus Plan No., SO / JWSO No., Internal SO No., POL and
// JC No. in the ▸.

import {
  PRODUCTION_ORDER_STATUS_LABEL,
  PRODUCTION_ORDER_STATUSES,
  type ProductionOrderListItem,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { ItemRevLink } from '@/modules/item-revisions/components/item-rev-link';
import { itemCodeWithRev, docDrawingRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { ROW_TINT, leadColumns } from '@/ui/data';
import { PoStatusBadge } from './po-status-badge';

// Sort & Filter (server mode): the status tick list — stored code + label.
const STATUS_OPTIONS = PRODUCTION_ORDER_STATUSES.map((value) => ({
  value,
  label: PRODUCTION_ORDER_STATUS_LABEL[value],
}));

/** ADR-235 — a Cancelled Production Order (listed with includeCancelled):
 *  cancelledAt is the standard Cancel's stamp. */
export function isProCancelled(po: Pick<ProductionOrderListItem, 'cancelledAt'>): boolean {
  return Boolean(po.cancelledAt);
}

/**
 * Whole-row wash by the REAL Production Order status enum only (ADR-199
 * ROW_TINT), so the wash agrees with the PoStatusBadge colour one for one:
 *   open             → no wash   (nothing credited yet)
 *   partially_closed → pending   (amber — some pieces credited, under way)
 *   closed           → done      (green — fully credited)
 *   short_closed     → cancelled (grey — stopped, a dead end)
 */
export function poRowTint(po: ProductionOrderListItem): string | undefined {
  // ADR-235 — a Cancelled order (listed with includeCancelled) is washed grey.
  if (isProCancelled(po)) return ROW_TINT.cancelled;
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

export function poListColumns(
  /** ADR-202 — Production Order ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
  /** The first row's position on this page (ADR-201 paging), so Sr No keeps
   *  counting across pages — page 2 starts at 26. */
  offset = 0,
): DataTableColumn<ProductionOrderListItem>[] {
  return [
    // Owner rule 2026-10-31 (ADR-261 amendment) — Production Order No. first,
    // then the six lead columns, all locked; Sr No and every other fact follow
    // Item Name. Created On is the
    // order's own createdAt (the old "Production Order Date" column showed the
    // same value, so it is folded into the lead column).
    ...leadColumns<ProductionOrderListItem>({
      doc: {
        id: 'pro_no',
        header: 'Production Order No.',
        kind: 'code',
        sortFilterField: 'code',
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
      soNo: (po) => po.soCodeText,
      internalSoNo: (po) => po.soInternalNo,
      pol: (po) => po.clientPoLineNo,
      createdOn: (po) => po.createdAt,
      itemCode: (po) => po.itemCodeText,
      itemRev: (po) => docDrawingRev(po),
      itemName: (po) => po.itemNameText,
      overrides: {
        so_no: { sortFilterField: 'sourceCode' },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: {
          sortFilterField: 'itemCode',
          render: (po) => (
            <span className="td-code" style={{ color: 'var(--text)', fontWeight: 700 }}>
              {/* CODE/REV (ADR-177); bare code when the line has no revision. */}
              <ItemRevLink
                itemRevisionId={po.itemRevisionId}
                label={itemCodeWithRev(po.itemCodeText, docDrawingRev(po))}
                className=""
              />
            </span>
          ),
        },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      // Owner request 2026-10-26 — the client-list Sr No column. Column 0 of a
      // fit table carries the row's ▸; the Production Order No. stays pinned
      // through PO_LIST_PINNED_IDS.
      id: 'sr_no',
      header: 'Sr No',
      width: '4%',
      className: 'text3',
      render: (_po, i) => offset + i + 1,
    },
    {
      id: 'order_qty',
      header: 'Order Qty',
      kind: 'num',
      align: 'right',
      sortFilterField: 'orderQty',
      className: 'mono fw-700',
      nowrap: true,
      render: (po) => po.orderQty,
    },
    {
      id: 'completed',
      header: 'Completed',
      kind: 'num',
      align: 'right',
      sortFilterField: 'jcFinishedQty',
      className: 'mono fw-700',
      nowrap: true,
      render: (po) => <span style={{ color: completedColor(po) }}>{po.jcFinishedQty}</span>,
    },
    {
      // ADR-233 — `Stock Received` (was "Credited"): pieces this order has put
      // into stock, the running total of its closes.
      id: 'stock_received',
      header: 'Stock Received',
      kind: 'num',
      align: 'right',
      sortFilterField: 'creditedQty',
      className: 'mono',
      nowrap: true,
      render: (po) => po.creditedQty ?? 0,
    },
    {
      // ADR-233 — `Short Closed Qty` = Order − Stock Received on an order ended
      // under target (Finish Short or Short Close); Lost is part of it. Blank
      // while the order is still running, so a 0 never reads as a fact.
      id: 'short_closed_qty',
      header: 'Short Closed Qty',
      kind: 'num',
      align: 'right',
      sortFilterField: 'shortClosedQty',
      className: 'mono fw-700',
      nowrap: true,
      render: (po) =>
        po.shortClosedQty > 0 ? (
          <span style={{ color: 'var(--orange2)' }}>{po.shortClosedQty}</span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'pro_status',
      header: 'Production Order Status',
      kind: 'badge',
      sortFilterField: 'status',
      filterOptions: STATUS_OPTIONS,
      nowrap: true,
      // ADR-235: a Cancelled order reads "Cancelled" here instead.
      render: (po) =>
        isProCancelled(po) ? (
          <span className="badge b-red" title={po.cancelReason ?? undefined}>
            Cancelled
          </span>
        ) : (
          <PoStatusBadge
            status={po.status}
            draft={draftIds?.has(po.id)}
            shortClosedQty={po.shortClosedQty}
          />
        ),
    },
    {
      id: 'pro_target_date',
      header: 'PRO Target Date',
      kind: 'date',
      sortFilterField: 'targetDate',
      className: 'mono',
      nowrap: true,
      render: (po) => fmtDate(po.targetDate),
    },
    // ── Secondary facts — ship hidden (defaultHidden), ride in the ▸ detail ──
    {
      id: 'plan_no',
      header: 'Plan No.',
      kind: 'code',
      sortFilterField: 'planCode',
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
      id: 'jc_no',
      header: 'JC No.',
      kind: 'code',
      sortFilterField: 'jcCode',
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

/** Pinned by default beside the always-pinned first column (Sr No), so the
 *  Production Order No. is never dropped into ▸ on a narrow screen. */
export const PO_LIST_PINNED_IDS = ['pro_no'];

/** Column ids shipped in the ▸ detail by default (Plan No., JC No.). The SO
 *  No., Internal SO No. and POL are lead columns now — always shown. */
export const PO_LIST_DETAIL_IDS = ['plan_no', 'jc_no'];
