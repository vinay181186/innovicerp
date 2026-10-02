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
