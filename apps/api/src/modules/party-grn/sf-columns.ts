// Sort & Filter (ADR-200) — the Party GRN list's sortable / filterable fields.
// Each expression is the SAME one listPartyGrn SELECTs for that column (same
// aliases `pg`, `c`, `agg`; its total/summary query carries the same joins and
// the same `agg` lateral), so what the user filters is what the row shows.

import { sql } from 'drizzle-orm';

import { createdByNameSql } from '../../lib/created-by-sql';
import type { SfColumnMap } from '../../lib/list-query';
import { PARTY_GRN_DOC_QC_STATUS_SQL } from './qc-state';

/** The order a Party GRN was received against: JWSO No. else the Equipment SO
 *  No. (ADR-307). A subquery so it needs no extra join on either list. */
const PARTY_GRN_ORDER_CODE_SQL = sql`COALESCE(pg.jw_code_text,
  (SELECT so.code FROM public.sales_orders so WHERE so.id = pg.sales_order_id))`;

export const PARTY_GRN_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`pg.code`, type: 'text' },
  grnDate: { sql: sql`pg.grn_date`, type: 'date' },
  customer: { sql: sql`COALESCE(c.name, pg.client_code_text)`, type: 'text' },
  // ADR-307: an SO GRN has no JWSO — its order column shows the SO No.
  jwCode: { sql: PARTY_GRN_ORDER_CODE_SQL, type: 'text' },
  clientPoNo: { sql: sql`pg.client_po_no`, type: 'text' },
  dcNo: { sql: sql`pg.dc_no`, type: 'text' },
  receivedQty: { sql: sql`COALESCE(agg.total_received, 0)`, type: 'num' },
  linesCount: { sql: sql`COALESCE(agg.lines_count, 0)`, type: 'num' },
  createdOn: { sql: sql`(pg.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  // ADR-303 — one row per Party GRN. Its JWSO is the HEADER's (one per GRN),
  // so the JWSO dropdown (`jwCode`, ADR-267) already keeps each GRN once.
  createdBy: { sql: createdByNameSql(sql`pg.created_by`), type: 'text' },
  acceptedQty: { sql: sql`COALESCE(agg.total_accepted, 0)`, type: 'num' },
  docQcStatus: { sql: PARTY_GRN_DOC_QC_STATUS_SQL, type: 'list' },
};

// ADR-261 — the ONE-ROW-PER-LINE list (GET /party-grn/lines, ./list-lines.ts).
// Aliases: `pg` header, `pgl` the row's line, `jwl` its JWSO line, `oi` that
// line's item, `c` client.
// The lead columns sort / filter on the LINE; header fields on the header.
export const PARTY_GRN_LINE_SF_COLUMNS: SfColumnMap = {
  // ADR-307: an SO GRN has no JWSO — its order column shows the SO No.
  jwCode: { sql: PARTY_GRN_ORDER_CODE_SQL, type: 'text' },
  clientPoLineNo: { sql: sql`jwl.client_po_line_no`, type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(pgl.created_at, pg.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  createdBy: { sql: createdByNameSql(sql`COALESCE(pgl.created_by, pg.created_by)`), type: 'text' },
  // The raw material has no Rev, so its code is the whole cell.
  // Owner 2026-11-17: the live -RM item code (lpm/lri joined in list-lines.ts),
  // PM-#### only as the legacy fallback — the same expression the cell shows.
  itemCode: {
    sql: sql`btrim(COALESCE(lri.code, lpm.item_code_text, pgl.party_material_code_text))`,
    type: 'text',
  },
  // The finished part, CODE/REV as the cell prints it (itemCodeWithRev).
  orderItemCode: {
    sql: sql`(btrim(COALESCE(oi.code, jwl.item_code_text)) || COALESCE('/' || NULLIF(btrim(jwl.revision), ''), ''))`,
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
