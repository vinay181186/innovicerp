// Sort & Filter (ADR-200) — the JW DC Outward / Inward registers' sortable /
// filterable fields. Both list queries read their rows through a derived table
// `z` (the very SELECT the register shows), and their count query counts that
// same derived table — so every expression here is a column the row prints,
// valid in the list AND the count. Field names are the screen's `sortFilterField`.

import { sql } from 'drizzle-orm';

import {
  sfExtraDistinct,
  sfFirstLine,
  type SfColumnMap,
  type SfLiftSpec,
} from '../../lib/list-query';

/** The order hops off an outward line (alias jdol). Needs the line joined.
 *  Also read by the document registers (service.ts, ADR-303) and the
 *  first-line values below. */
export const ORDER_JOINS_SQL = sql.raw(`
  LEFT JOIN public.items i ON i.id = jdol.item_id AND i.deleted_at IS NULL
  LEFT JOIN public.purchase_order_lines pol
    ON pol.id = jdol.purchase_order_line_id AND pol.deleted_at IS NULL
  LEFT JOIN public.jc_ops jco ON jco.id = pol.source_jc_op_id AND jco.deleted_at IS NULL
  LEFT JOIN public.job_cards jc ON jc.id = jco.job_card_id AND jc.deleted_at IS NULL
  LEFT JOIN public.job_work_order_lines jwl
    ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
  LEFT JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id AND jwo.deleted_at IS NULL
  LEFT JOIN public.sales_order_lines sol
    ON sol.id = COALESCE(pol.source_so_line_id, jc.source_so_line_id) AND sol.deleted_at IS NULL
  LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
`);

/** A challan's own lines (alias jdol, header jdoh): live ones, or — on a
 *  Cancelled challan — those cancelled with it (the header's deleted_at). For
 *  a live header this is exactly `jdol.deleted_at IS NULL`. */
export const JDOL_OF_HEADER_SQL =
  '(jdol.deleted_at IS NULL OR (jdoh.deleted_at IS NOT NULL AND jdol.deleted_at = jdoh.deleted_at))';

/** ADR-303 — an outward DC's lines with the order hops (aliases jdol, jdoh +
 *  ORDER_JOINS_SQL's i / so / jwo …). Scope with JDOL_OF_HEADER_SQL. */
export const OUTWARD_LINES_FROM = sql`
  FROM public.jw_dc_outward_lines jdol
  JOIN public.jw_dc_outward jdoh ON jdoh.id = jdol.jw_dc_outward_id
  ${ORDER_JOINS_SQL}`;
/** ADR-303 — an inward receipt's lines with the order hops (aliases jdil,
 *  jdol + ORDER_JOINS_SQL). */
export const INWARD_LINES_FROM = sql`
  FROM public.jw_dc_inward_lines jdil
  JOIN public.jw_dc_outward_lines jdol ON jdol.id = jdil.jw_dc_outward_line_id
  ${ORDER_JOINS_SQL}`;

/** The order behind ONE line: the SO code, else the JWSO code. */
const LINE_ORDER_CODE = sql`COALESCE(so.code, jwo.code)`;

/** The lines of the register row `z` (its derived-table alias): live ones, or
 *  on a Cancelled document those cancelled with it. */
const OUTWARD_LINES_OF_Z = sql`${OUTWARD_LINES_FROM}
  WHERE jdol.jw_dc_outward_id = z.id AND ${sql.raw(JDOL_OF_HEADER_SQL)}`;
const INWARD_LINES_OF_Z = sql`${INWARD_LINES_FROM}
  WHERE jdil.jw_dc_inward_id = z.id
    AND (jdil.deleted_at IS NULL
         OR (z."cancelledAt" IS NOT NULL AND jdil.deleted_at = z."deletedAt"))`;
const OUT_ORDER = sql`jdol.line_no, jdol.id`;
const IN_ORDER = sql`jdol.line_no, jdil.id`;

/** ADR-303 — the first line's order (SO, else JWSO) / its Internal SO No. /
 *  how many more orders: scalar subqueries over `z`, put in the OUTER page
 *  SELECT, so they run for the page rows only (never in the count). */
export const JW_DC_OUTWARD_FIRST_ORDER = sfFirstLine(
  OUTWARD_LINES_OF_Z,
  LINE_ORDER_CODE,
  LINE_ORDER_CODE,
  OUT_ORDER,
);
export const JW_DC_OUTWARD_FIRST_SO_INTERNAL_NO = sfFirstLine(
  OUTWARD_LINES_OF_Z,
  sql`so.internal_so_no`,
  LINE_ORDER_CODE,
  OUT_ORDER,
);
export const JW_DC_OUTWARD_ORDER_EXTRA = sfExtraDistinct(OUTWARD_LINES_OF_Z, LINE_ORDER_CODE);
export const JW_DC_INWARD_FIRST_ORDER = sfFirstLine(
  INWARD_LINES_OF_Z,
  LINE_ORDER_CODE,
  LINE_ORDER_CODE,
  IN_ORDER,
);
export const JW_DC_INWARD_ORDER_EXTRA = sfExtraDistinct(INWARD_LINES_OF_Z, LINE_ORDER_CODE);

/** ADR-303 — SO No. / Internal SO No. filters (the SO dropdown, ADR-267) on
 *  the one-row-per-document registers: judged over every line of `z`
 *  (lib/list-query liftLineFilters), so a document whose lines cover several
 *  SOs is found by any of them and still shows once. Internal SO No. is lifted
 *  exactly like SO No. */
export const JW_DC_OUTWARD_LINE_LIFT: SfLiftSpec = {
  fields: {
    soCode: { line: LINE_ORDER_CODE, type: 'text' },
    soInternalNo: { line: sql`so.internal_so_no`, type: 'text' },
  },
  linesFrom: OUTWARD_LINES_OF_Z,
};
export const JW_DC_INWARD_LINE_LIFT: SfLiftSpec = {
  fields: {
    soCode: { line: LINE_ORDER_CODE, type: 'text' },
    soInternalNo: { line: sql`so.internal_so_no`, type: 'text' },
  },
  linesFrom: INWARD_LINES_OF_Z,
};

export const JW_DC_OUTWARD_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`z.code`, type: 'text' },
  dcDate: { sql: sql`z."dcDate"`, type: 'date' },
  poNo: { sql: sql`z."jwpoCodeText"`, type: 'text' },
  soNo: { sql: sql`z."soCode"`, type: 'text' },
  // Vendor as the cell prints it: master name, else the snapshot name / code.
  vendor: {
    sql: sql`COALESCE(z."vendorName", z."vendorNameText", z."vendorCodeText")`,
    type: 'text',
  },
  sentQty: { sql: sql`z."totalSentQty"`, type: 'num' },
  receivedQty: { sql: sql`z."totalReturnedQty"`, type: 'num' },
  pendingQty: { sql: sql`z."pendingQty"`, type: 'num' },
  returnStatus: { sql: sql`z."returnStatus"`, type: 'list' },
  // ADR-303 — one row per DC. SO No. / Internal SO No. sort by the FIRST
  // line's order; their filters go through JW_DC_OUTWARD_LINE_LIFT.
  soCode: { sql: JW_DC_OUTWARD_FIRST_ORDER, type: 'text' },
  soInternalNo: { sql: JW_DC_OUTWARD_FIRST_SO_INTERNAL_NO, type: 'text' },
  lineCount: { sql: sql`z."linesCount"`, type: 'num' },
  createdOn: { sql: sql`(z."createdAt" AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  createdBy: { sql: sql`z."createdByName"`, type: 'text' },
};

export const JW_DC_INWARD_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`z.code`, type: 'text' },
  inwardDate: { sql: sql`z."inwardDate"`, type: 'date' },
  dcNo: { sql: sql`z."dcCodeText"`, type: 'text' },
  vendor: { sql: sql`COALESCE(z."vendorName", z."vendorNameText")`, type: 'text' },
  receivedQty: { sql: sql`z."totalReceivedQty"`, type: 'num' },
  acceptedQty: { sql: sql`z."totalOkQty"`, type: 'num' },
  rejectedQty: { sql: sql`z."totalRejectedQty"`, type: 'num' },
  // ADR-303 — one row per receipt.
  poNo: { sql: sql`z."jwpoCodeText"`, type: 'text' },
  lineCount: { sql: sql`z."lineCount"`, type: 'num' },
  createdOn: { sql: sql`(z."createdAt" AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  createdBy: { sql: sql`z."createdByName"`, type: 'text' },
  // Sort on the first line's order; the filter goes through JW_DC_INWARD_LINE_LIFT.
  soCode: { sql: JW_DC_INWARD_FIRST_ORDER, type: 'text' },
};

// ADR-261 — the one-row-per-LINE registers (list-lines.ts). Same derived-row
// pattern: every expression is a column of `z`, valid in the list and count.
// Field names match the document registers where the column means the same
// thing, so a filter kept in the tab carries over.
const JW_DC_LINE_LEAD_SF: SfColumnMap = {
  // SO No. as the cell prints it: the SO code, else the JWSO code.
  soCode: { sql: sql`z."orderCode"`, type: 'text' },
  soInternalNo: { sql: sql`z."soInternalNo"`, type: 'text' },
  clientPoLineNo: { sql: sql`z."clientPoLineNo"`, type: 'text' },
  createdOn: { sql: sql`z."createdOn"`, type: 'date' },
  createdBy: { sql: sql`z."createdByName"`, type: 'text' },
  // CODE/REV as the cell prints it.
  itemCode: { sql: sql`z."itemCodeRev"`, type: 'text' },
  itemName: { sql: sql`z."itemName"`, type: 'text' },
  vendor: { sql: sql`z."vendorName"`, type: 'text' },
  poNo: { sql: sql`z."jwpoCodeText"`, type: 'text' },
};

export const JW_DC_OUTWARD_LINES_SF_COLUMNS: SfColumnMap = {
  ...JW_DC_LINE_LEAD_SF,
  code: { sql: sql`z."docCode"`, type: 'text' },
  dcDate: { sql: sql`z."docDate"`, type: 'date' },
  sentQty: { sql: sql`z."sentQty"`, type: 'num' },
  receivedQty: { sql: sql`z."receivedQty"`, type: 'num' },
  pendingQty: { sql: sql`z."pendingQty"`, type: 'num' },
  returnStatus: { sql: sql`z."returnStatus"`, type: 'list' },
};

export const JW_DC_INWARD_LINES_SF_COLUMNS: SfColumnMap = {
  ...JW_DC_LINE_LEAD_SF,
  code: { sql: sql`z."docCode"`, type: 'text' },
  inwardDate: { sql: sql`z."docDate"`, type: 'date' },
  dcNo: { sql: sql`z."dcCodeText"`, type: 'text' },
  receivedQty: { sql: sql`z."receivedQty"`, type: 'num' },
  acceptedQty: { sql: sql`z."okQty"`, type: 'num' },
  rejectedQty: { sql: sql`z."rejectedQty"`, type: 'num' },
};
