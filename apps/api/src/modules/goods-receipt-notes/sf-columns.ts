// Sort & Filter (ADR-200) — the GRN list's sortable / filterable fields. Each
// expression is the SAME one listGoodsReceiptNotes SELECTs (or the screen
// renders from it) for that column, with the same table aliases; the summary
// query (which is also the pager count) joins `v`, `po` and `line_agg` too, so
// every one is valid there. There is no money on this list.
//
// Not here: Source (a badge the screen picks from which link the GRN carries)
// and QC Status (worked out per row in the browser, with its own filter) —
// neither is a stored value.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const GRN_SF_COLUMNS: SfColumnMap = {
  grnCode: { sql: sql`grn.code`, type: 'text' },
  grnDate: { sql: sql`grn.grn_date`, type: 'date' },
  // The cell renders vendorName ?? vendorCodeText.
  vendorName: { sql: sql`COALESCE(v.name, grn.vendor_code_text)`, type: 'text' },
  // PO/NC No.: an NC-return GRN shows poCodeText (it holds the NC code);
  // otherwise poCode ?? poCodeText.
  poNcCode: {
    sql: sql`(CASE WHEN grn.nc_id IS NOT NULL THEN grn.po_code_text
              ELSE COALESCE(po.code, grn.po_code_text) END)`,
    type: 'text',
  },
  totalReceivedQty: { sql: sql`COALESCE(line_agg.total_received_qty, 0)::float8`, type: 'num' },
  totalQcAcceptedQty: { sql: sql`COALESCE(line_agg.qc_accepted_qty, 0)::float8`, type: 'num' },
  totalQcRejectedQty: { sql: sql`COALESCE(line_agg.qc_rejected_qty, 0)::float8`, type: 'num' },
  createdOn: { sql: sql`(grn.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
