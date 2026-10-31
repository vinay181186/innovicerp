// Sort & Filter (ADR-200) — the Customer Material Return list's fields.
// Each expression is the SAME one listCustomerMaterialReturns SELECTs for that
// column (aliases `r`, `jw`, `cl`, `agg`; its count query carries the same
// joins and the same `agg` lateral), so what the user filters is what the row
// shows. No money on this document.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const CUSTOMER_MATERIAL_RETURN_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`r.code`, type: 'text' },
  returnDate: { sql: sql`r.return_date`, type: 'date' },
  jwCode: { sql: sql`jw.code`, type: 'text' },
  customer: { sql: sql`cl.name`, type: 'text' },
  vehicleNo: { sql: sql`r.vehicle_no`, type: 'text' },
  status: { sql: sql`r.status`, type: 'list' },
  totalQty: { sql: sql`COALESCE(agg.total_qty, 0)`, type: 'num' },
};

/** ADR-261 — the ONE-ROW-PER-LINE register (list-lines.ts). Aliases `l`
 *  (return line), `r`, `jw`, `cl`, `jwl` (JWSO line), `i` (its item),
 *  `pm` / `ri` (the customer RM) — all joined by BOTH its page and its count. */
export const CUSTOMER_MATERIAL_RETURN_LINE_SF_COLUMNS: SfColumnMap = {
  jwCode: { sql: sql`jw.code`, type: 'text' },
  clientPoLineNo: { sql: sql`jwl.client_po_line_no`, type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(l.created_at, r.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  // CODE/REV as the cell prints it (itemCodeWithRev).
  itemCode: {
    sql: sql`(btrim(COALESCE(i.code, jwl.item_code_text)) || COALESCE('/' || NULLIF(btrim(jwl.revision::text), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`COALESCE(NULLIF(btrim(jwl.part_name), ''), i.name)`, type: 'text' },
  code: { sql: sql`r.code`, type: 'text' },
  returnDate: { sql: sql`r.return_date`, type: 'date' },
  customer: { sql: sql`cl.name`, type: 'text' },
  qty: { sql: sql`l.qty`, type: 'num' },
  // The old document list's Total Qty field: a sort / filter kept in the
  // browser tab from before ADR-261 still reads (as the line's qty).
  totalQty: { sql: sql`l.qty`, type: 'num' },
  kind: { sql: sql`l.kind`, type: 'list' },
  rmItemCode: { sql: sql`COALESCE(ri.code, pm.item_code_text)`, type: 'text' },
  status: { sql: sql`r.status`, type: 'list' },
  vehicleNo: { sql: sql`r.vehicle_no`, type: 'text' },
};
