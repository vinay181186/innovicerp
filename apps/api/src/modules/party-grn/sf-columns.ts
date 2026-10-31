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

// ADR-261 — the ONE-ROW-PER-LINE list (GET /party-grn/lines, ./list-lines.ts).
// Aliases: `pg` header, `pgl` the row's line, `jwl` its JWSO line, `c` client.
// The lead columns sort / filter on the LINE; header fields on the header.
export const PARTY_GRN_LINE_SF_COLUMNS: SfColumnMap = {
  jwCode: { sql: sql`pg.jw_code_text`, type: 'text' },
  clientPoLineNo: { sql: sql`jwl.client_po_line_no`, type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(pgl.created_at, pg.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  // CODE/REV as the cell prints it (itemCodeWithRev): RM code, then '/' + the
  // JWSO line's drawing revision when it has one.
  itemCode: {
    sql: sql`(btrim(pgl.party_material_code_text) || COALESCE('/' || NULLIF(btrim(jwl.revision), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`pgl.party_material_name`, type: 'text' },
  code: { sql: sql`pg.code`, type: 'text' },
  grnDate: { sql: sql`pg.grn_date`, type: 'date' },
  customer: { sql: sql`COALESCE(c.name, pg.client_code_text)`, type: 'text' },
  clientPoNo: { sql: sql`pg.client_po_no`, type: 'text' },
  dcNo: { sql: sql`pg.dc_no`, type: 'text' },
  receivedQty: { sql: sql`pgl.received_qty`, type: 'num' },
  acceptedQty: { sql: sql`pgl.accepted_qty`, type: 'num' },
};
