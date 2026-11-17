// Sort & Filter (ADR-200) — the GRN list's sortable / filterable fields. Each
// expression is the SAME one listGoodsReceiptNotes SELECTs (or the screen
// renders from it) for that column, with the same table aliases; the summary
// query (which is also the pager count) joins `v`, `po` and `line_agg` too, so
// every one is valid there. There is no money on this list.
//
// ADR-303 (one row per GRN): GRN Type and QC Status are here now, each as the
// SAME expression the SELECT returns (grnType / docQcStatus).

import { sql, type SQL } from 'drizzle-orm';

import { createdByNameSql } from '../../lib/created-by-sql';
import {
  sfExtraDistinct,
  sfFirstLine,
  type SfColumnMap,
  type SfLiftSpec,
} from '../../lib/list-query';
import { GRN_LINE_ORDER_JOINS, GRN_LINE_SO_CODE } from './list-lines';

/** GRN Type — which paper the receipt is against; same order as the web's
 *  grnTypeLabel (NC first: an NC-return GRN also carries a DC). */
export const GRN_TYPE_SQL = sql`(CASE WHEN grn.nc_id IS NOT NULL THEN 'nc'
  WHEN grn.delivery_challan_id IS NOT NULL THEN 'dc'
  WHEN grn.purchase_order_id IS NOT NULL THEN 'po' END)`;

/** ADR-303 — the receipt's ONE QC status from three line counts: `done` when
 *  no line waits (ADR-189 rule — a line with nothing left to inspect is done),
 *  `pending` when every line waits and none is part-inspected (a GRN with no
 *  lines too), else `partly_done`. A Cancelled GRN (deleted_at set) waits for
 *  nothing and is not done either: NULL, the cell reads "Cancelled". */
export function grnDocQcStatusOf(lineCount: SQL, pendingCount: SQL, touchedCount: SQL): SQL {
  return sql`(CASE
  WHEN grn.deleted_at IS NOT NULL THEN NULL
  WHEN COALESCE(${lineCount}, 0) > 0 AND COALESCE(${pendingCount}, 0) = 0 THEN 'done'
  WHEN COALESCE(${pendingCount}, 0) = COALESCE(${lineCount}, 0)
   AND COALESCE(${touchedCount}, 0) = 0 THEN 'pending'
  ELSE 'partly_done' END)`;
}

/** Over the list query's `line_agg` (the cell and its ▾ filter). */
export const GRN_DOC_QC_STATUS_SQL = grnDocQcStatusOf(
  sql`line_agg.line_count`,
  sql`line_agg.qc_pending_count`,
  sql`line_agg.qc_touched_count`,
);

/** The SAME status, self-contained (its own subquery over the live lines) —
 *  for the QC Status dropdown's filter and counts, which run in the summary
 *  query too (no line_agg there). */
export const GRN_DOC_QC_STATUS_SUB = sql`(SELECT ${grnDocQcStatusOf(
  sql`q.lc`,
  sql`q.pc`,
  sql`q.tc`,
)} FROM (
    SELECT COUNT(*) AS lc,
      COUNT(*) FILTER (WHERE qgl.received_qty - qgl.qc_accepted_qty - qgl.qc_rejected_qty > 0) AS pc,
      COUNT(*) FILTER (WHERE qgl.qc_accepted_qty + qgl.qc_rejected_qty > 0) AS tc
    FROM public.goods_receipt_note_lines qgl
    WHERE qgl.goods_receipt_note_id = grn.id AND qgl.deleted_at IS NULL) q)`;

/** ADR-303 — the lines of GRN `grn` (live, plus those cancelled WITH a
 *  Cancelled GRN), with their order (GRN_LINE_ORDER_JOINS). */
const GRN_LINES_OF = sql`FROM public.goods_receipt_note_lines gl
  ${GRN_LINE_ORDER_JOINS}
  WHERE gl.goods_receipt_note_id = grn.id
    AND (gl.deleted_at IS NULL OR gl.deleted_at = grn.deleted_at)`;
const GRN_LINE_ORDER = sql`gl.line_no, gl.id`;
/** The first line's SO (else JWSO) No. / Internal SO No. / how many more —
 *  scalar subqueries, run for the page rows only. */
export const GRN_FIRST_SO_CODE = sfFirstLine(
  GRN_LINES_OF,
  GRN_LINE_SO_CODE,
  GRN_LINE_SO_CODE,
  GRN_LINE_ORDER,
);
export const GRN_FIRST_SO_INTERNAL_NO = sfFirstLine(
  GRN_LINES_OF,
  sql`so.internal_so_no`,
  GRN_LINE_SO_CODE,
  GRN_LINE_ORDER,
);
export const GRN_SO_EXTRA_COUNT = sfExtraDistinct(GRN_LINES_OF, GRN_LINE_SO_CODE);

/** 0237 — every NC a replacement GRN's lines settle (line NC, header as
 *  old-row fallback), in line order, as one "IN-NC-1, IN-NC-2" string; NULL on
 *  an ordinary GRN. The ONE copy: the list's ncCode and its PO/NC filter. */
export const GRN_NC_CODES_SQL = sql`(SELECT string_agg(x.code, ', ' ORDER BY x.first_line, x.code)
  FROM (SELECT n.code, MIN(nl.line_no) AS first_line
          FROM public.goods_receipt_note_lines nl
          JOIN public.nc_register n
            ON n.id = COALESCE(nl.nc_id, grn.nc_id) AND n.deleted_at IS NULL
         WHERE nl.goods_receipt_note_id = grn.id
           AND (nl.deleted_at IS NULL OR nl.deleted_at = grn.deleted_at)
           AND grn.nc_id IS NOT NULL
         GROUP BY n.id, n.code) x)`;

export const GRN_SF_COLUMNS: SfColumnMap = {
  grnCode: { sql: sql`grn.code`, type: 'text' },
  grnDate: { sql: sql`grn.grn_date`, type: 'date' },
  // The cell renders vendorName ?? vendorCodeText.
  vendorName: { sql: sql`COALESCE(v.name, grn.vendor_code_text)`, type: 'text' },
  // PO/NC No. ADR-217: an NC-return GRN shows the NC's OWN code, resolved, never
  // `po_code_text` — that column held the NC code only while a return had no
  // purchase order behind it, and a return raised after ADR-217 has one. The
  // cell (grn-list-columns.tsx) reads `ncCode ?? poCodeText`; this must read the
  // same, or the column's filter and sort disagree with what is on screen.
  poNcCode: {
    sql: sql`(CASE WHEN grn.nc_id IS NOT NULL
              THEN COALESCE(${GRN_NC_CODES_SQL},
                            (SELECT n.code FROM public.nc_register n
                             WHERE n.id = grn.nc_id AND n.deleted_at IS NULL),
                            grn.po_code_text)
              ELSE COALESCE(po.code, grn.po_code_text) END)`,
    type: 'text',
  },
  totalReceivedQty: { sql: sql`COALESCE(line_agg.total_received_qty, 0)::float8`, type: 'num' },
  totalQcAcceptedQty: { sql: sql`COALESCE(line_agg.qc_accepted_qty, 0)::float8`, type: 'num' },
  totalQcRejectedQty: { sql: sql`COALESCE(line_agg.qc_rejected_qty, 0)::float8`, type: 'num' },
  createdOn: { sql: sql`(grn.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  // ADR-303 — one row per GRN. SO No. / Internal SO No. SORT on the first
  // line's order (scalar subqueries — ORDER BY never reaches the summary);
  // their FILTERS go through liftLineFilters over GRN_LINE_LIFT.
  soCode: { sql: GRN_FIRST_SO_CODE, type: 'text' },
  soInternalNo: { sql: GRN_FIRST_SO_INTERNAL_NO, type: 'text' },
  createdBy: { sql: createdByNameSql(sql`grn.created_by`), type: 'text' },
  lineCount: { sql: sql`COALESCE(line_agg.line_count, 0)::int`, type: 'num' },
  grnType: { sql: GRN_TYPE_SQL, type: 'list' },
  dcNo: { sql: sql`grn.dc_no`, type: 'text' },
  invoiceNo: { sql: sql`grn.invoice_no`, type: 'text' },
  docQcStatus: { sql: GRN_DOC_QC_STATUS_SQL, type: 'list' },
};

/** ADR-303 — the LINE facts the one-row-per-GRN list filters on, judged over
 *  every line (lib/list-query liftLineFilters). The GRN header has no SO. */
export const GRN_LINE_LIFT: SfLiftSpec = {
  fields: {
    soCode: { line: GRN_LINE_SO_CODE, type: 'text' },
    soInternalNo: { line: sql`so.internal_so_no`, type: 'text' },
  },
  linesFrom: GRN_LINES_OF,
};
