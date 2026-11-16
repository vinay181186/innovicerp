// Sort & Filter (ADR-200) — the Purchase Order list's sortable / filterable
// fields. Each expression is the SAME one listPurchaseOrders SELECTs (or the
// screen renders from it) for that column, with the same table aliases; the
// count query joins `v` and `line_agg` too, so every one is valid there.
// Value (total_amount) is money: only a user who may see PO prices can sort or
// filter by it (`price: true` + canSeeFormPrice).

import { sql } from 'drizzle-orm';

import { createdByNameSql } from '../../lib/created-by-sql';
import {
  sfExtraDistinct,
  sfFirstLine,
  type SfColumnMap,
  type SfLiftSpec,
} from '../../lib/list-query';
import { PO_LINE_ORDER_JOINS, PO_LINE_SO_CODE } from './list-lines';

/** ADR-303 — the live lines of PO `po`, with their order (PO_LINE_ORDER_JOINS). */
const PO_LINES_OF = sql`FROM public.purchase_order_lines pol
  ${PO_LINE_ORDER_JOINS}
  WHERE pol.purchase_order_id = po.id AND pol.deleted_at IS NULL`;
const PO_LINE_ORDER = sql`pol.line_no, pol.id`;
/** The first line's SO (else JWSO) No. / its Internal SO No. / how many more —
 *  scalar subqueries, run for the page rows only. */
export const PO_FIRST_SO_CODE = sfFirstLine(
  PO_LINES_OF,
  PO_LINE_SO_CODE,
  PO_LINE_SO_CODE,
  PO_LINE_ORDER,
);
export const PO_FIRST_SO_INTERNAL_NO = sfFirstLine(
  PO_LINES_OF,
  sql`so.internal_so_no`,
  PO_LINE_SO_CODE,
  PO_LINE_ORDER,
);
export const PO_SO_EXTRA_COUNT = sfExtraDistinct(PO_LINES_OF, PO_LINE_SO_CODE);

export const PO_SF_COLUMNS: SfColumnMap = {
  poCode: { sql: sql`po.code`, type: 'text' },
  poDate: { sql: sql`po.po_date`, type: 'date' },
  poType: { sql: sql`po.po_type`, type: 'list' },
  // The cell renders vendorName ?? vendorCodeText.
  vendorName: { sql: sql`COALESCE(v.name, po.vendor_code_text)`, type: 'text' },
  prCodeText: { sql: sql`po.pr_code_text`, type: 'text' },
  totalQty: { sql: sql`COALESCE(line_agg.total_qty, 0)::float8`, type: 'num' },
  receivedQty: { sql: sql`COALESCE(line_agg.received_qty, 0)::float8`, type: 'num' },
  // ADR-189 — the one Pending rule, as the SELECT has it.
  pendingQty: {
    sql: sql`(CASE WHEN po.status IN ('draft', 'open', 'partial', 'qc_pending')
              THEN COALESCE(line_agg.pending_qty, 0) ELSE 0 END)::float8`,
    type: 'num',
  },
  totalAmount: { sql: sql`po.total_amount`, type: 'num', price: true },
  status: { sql: sql`po.status`, type: 'list' },
  createdOn: { sql: sql`(po.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  // ADR-303 — one row per PO. SO No. / Internal SO No. SORT on the first line's
  // order (a scalar subquery; ORDER BY never reaches the count). Their FILTERS
  // never reach this map: liftLineFilters (lib/list-query) answers them over
  // PO_LINE_LIFT, on list and count.
  soCode: { sql: PO_FIRST_SO_CODE, type: 'text' },
  soInternalNo: { sql: PO_FIRST_SO_INTERNAL_NO, type: 'text' },
  createdBy: { sql: createdByNameSql(sql`po.created_by`), type: 'text' },
  lineCount: { sql: sql`COALESCE(line_agg.line_count, 0)::int`, type: 'num' },
  grnReceivedQty: { sql: sql`COALESCE(line_agg.grn_received_qty, 0)::float8`, type: 'num' },
  qcAcceptedQty: { sql: sql`COALESCE(line_agg.accepted_qty, 0)::float8`, type: 'num' },
  // Total Value (Basic) — before GST (NAMING.md: no bare "Value" on PO).
  subtotal: { sql: sql`po.subtotal`, type: 'num', price: true },
  // Deliberately NOT here: dcSentQty (dc_agg) and rtvAwaitingChallanQty
  // (rtv_agg, "Return Challan Pending"). Those two aliases are joined by the
  // LIST query only — the COUNT query does not carry them, because an
  // unfiltered count must not aggregate every challan line and every
  // non-conformance a second time. Registering either would let a ▾ filter
  // build a count predicate that names an alias the count has no join for, so
  // the rows would come back and the header count would throw. Both are
  // display-only figures; if one ever has to be sortable, the count query must
  // join the same alias in the same commit.
};

/** ADR-303 — the LINE facts the one-row-per-PO list filters on: judged over
 *  every live line (lib/list-query liftLineFilters). The PO header carries no
 *  SO of its own. */
export const PO_LINE_LIFT: SfLiftSpec = {
  fields: {
    soCode: { line: PO_LINE_SO_CODE, type: 'text' },
    soInternalNo: { line: sql`so.internal_so_no`, type: 'text' },
  },
  linesFrom: PO_LINES_OF,
};
