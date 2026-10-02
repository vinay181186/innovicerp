// Sort & Filter (ADR-200) — the Purchase Order list's sortable / filterable
// fields. Each expression is the SAME one listPurchaseOrders SELECTs (or the
// screen renders from it) for that column, with the same table aliases; the
// count query joins `v` and `line_agg` too, so every one is valid there.
// Value (total_amount) is money: only a user who may see PO prices can sort or
// filter by it (`price: true` + canSeeFormPrice).

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

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
};
