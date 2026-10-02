// Sort & Filter (ADR-200) — the Party GRN list's sortable / filterable fields.
// Each expression is the SAME one listPartyGrn SELECTs for that column (same
// aliases `pg`, `c`, `agg`; its total/summary query carries the same joins and
// the same `agg` lateral), so what the user filters is what the row shows.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const PARTY_GRN_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`pg.code`, type: 'text' },
  grnDate: { sql: sql`pg.grn_date`, type: 'date' },
  customer: { sql: sql`COALESCE(c.name, pg.client_code_text)`, type: 'text' },
  jwCode: { sql: sql`pg.jw_code_text`, type: 'text' },
  clientPoNo: { sql: sql`pg.client_po_no`, type: 'text' },
  dcNo: { sql: sql`pg.dc_no`, type: 'text' },
  receivedQty: { sql: sql`COALESCE(agg.total_received, 0)`, type: 'num' },
  linesCount: { sql: sql`COALESCE(agg.lines_count, 0)`, type: 'num' },
  createdOn: { sql: sql`(pg.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
