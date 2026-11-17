// Sort & Filter (ADR-200) — the OSP Outward DC list's sortable / filterable
// fields. Each expression is the value listDeliveryChallans SELECTs for that
// column (same table aliases), and is the text the column's cell shows: the
// Vendor cell reads vendorName ?? vendorCodeText, the PO cell "NC <code>" on a
// return-to-vendor challan else poCode ?? poCodeText, the SO cell
// soCode ?? soRefText. The aliases beyond `dc` + `v` are reached through
// DC_SF_JOINS, which the count and KPI-summary queries add when a filter is on.

import { sql } from 'drizzle-orm';
import { drawingRevOf } from '../../lib/drawing-rev';

import { createdByNameSql } from '../../lib/created-by-sql';
import {
  sfExtraDistinct,
  sfFirstLine,
  type SfColumnMap,
  type SfLiftSpec,
} from '../../lib/list-query';

/** ADR-289 — the header Rev from the Revs STORED on the challan's lines (only
 *  when they agree on one); NULL for a challan made before 0247, whose header
 *  then falls back to the live SO / JWSO line text as before. */
export const DC_STORED_REV_SQL = sql`(
  SELECT CASE WHEN COUNT(DISTINCT sr.rev) = 1 THEN MIN(sr.rev) END
    FROM public.delivery_challan_lines sl
    JOIN public.item_revisions sr ON sr.id = sl.item_revision_id
   WHERE sl.delivery_challan_id = dc.id AND sl.deleted_at IS NULL)`;

/** ADR-261 / ADR-303 — which order and job card a DC line `dcl` (of challan
 *  `dc`) belongs to; each hop a single-row FK, so no line is multiplied:
 *    SO line  = the PO line's source_so_line_id, else the DC's own
 *               sales_order_line_id, else the job card's source_so_line_id;
 *    job card = PO line → JC op → job card, else the line's NC's job card,
 *               else the DC's own job card (NC return);
 *    JWSO     = that job card's source_jw_line_id;
 *    no link  → the DC's free-text so_ref_text (so_ref, for its Internal SO No.).
 *  Aliases: nc, pol, ljo, ljc, sol, so, jwl, jw, so_ref. The ONE copy — the
 *  line list (list-lines.ts) and the per-DC first-line values (DC_SHOWN_*) both
 *  read it, so the list, its SO dropdown and the Excel export agree. */
export const DC_LINE_ORDER_JOINS = sql`
  -- 0237 — the LINE's NC (one return DC may carry several), header as fallback.
  LEFT JOIN public.nc_register nc
    ON nc.id = COALESCE(dcl.nc_id, dc.nc_id) AND nc.deleted_at IS NULL
  LEFT JOIN public.purchase_order_lines pol
    ON pol.id = dcl.purchase_order_line_id AND pol.deleted_at IS NULL
  LEFT JOIN public.jc_ops ljo ON ljo.id = pol.source_jc_op_id AND ljo.deleted_at IS NULL
  LEFT JOIN public.job_cards ljc
    ON ljc.id = COALESCE(ljo.job_card_id, nc.job_card_id, dc.job_card_id) AND ljc.deleted_at IS NULL
  LEFT JOIN public.sales_order_lines sol
    ON sol.id = COALESCE(pol.source_so_line_id, dc.sales_order_line_id, ljc.source_so_line_id)
   AND sol.deleted_at IS NULL
  LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
  LEFT JOIN public.job_work_order_lines jwl
    ON jwl.id = ljc.source_jw_line_id AND jwl.deleted_at IS NULL
  LEFT JOIN public.job_work_orders jw
    ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
  -- No SO / JWSO link: the SO a free-text so_ref_text names (code is unique per
  -- company) — for its Internal SO No. (ADR-207).
  LEFT JOIN public.sales_orders so_ref
    ON so.id IS NULL AND jw.id IS NULL
   AND so_ref.company_id = dc.company_id AND so_ref.code = dc.so_ref_text
   AND so_ref.deleted_at IS NULL`;

/** A DC line's order No. as the SO No. cell prints it (SO, else JWSO, else the
 *  DC's SO ref), over DC_LINE_ORDER_JOINS. */
export const DC_LINE_SO_CODE = sql`COALESCE(so.code, jw.code, dc.so_ref_text)`;
export const DC_LINE_SO_INTERNAL_NO = sql`COALESCE(so.internal_so_no, so_ref.internal_so_no)`;

/** ADR-303 — the live lines of challan `dc`, with their order (above). */
const DC_LINES_OF = sql`FROM public.delivery_challan_lines dcl
  ${DC_LINE_ORDER_JOINS}
  WHERE dcl.delivery_challan_id = dc.id AND dcl.deleted_at IS NULL`;
const DC_LINE_ORDER = sql`dcl.line_no, dcl.id`;

/** The DC's OWN (header) SO — its SO line, else the PO's SO(s), else the
 *  free-text so_ref_text — and that SO's Internal SO No. (ADR-207). Aliases of
 *  DC_SF_JOINS (so, po_so, so_ref). A legacy / NC-return DC whose lines carry
 *  no PO line still has this one. */
const DC_HEADER_SO_CODE = sql`COALESCE(so.code, po_so.so_code, dc.so_ref_text)`;
const DC_HEADER_SO_INTERNAL_NO = sql`(CASE WHEN so.id IS NOT NULL THEN so.internal_so_no
  WHEN po_so.so_code IS NOT NULL THEN po_so.so_internal_no
  ELSE so_ref.internal_so_no END)`;

const DC_FIRST_SO_CODE = sfFirstLine(DC_LINES_OF, DC_LINE_SO_CODE, DC_LINE_SO_CODE, DC_LINE_ORDER);
const DC_FIRST_JC_CODE = sfFirstLine(DC_LINES_OF, sql`ljc.code`, sql`ljc.code`, DC_LINE_ORDER);
/** What the SO No. / Internal SO No. / JC No. cells show (and sort on): the
 *  first line's value, else the header's. Scalar subqueries — run for the page
 *  rows (or the sort) only. Need DC_SF_JOINS. */
export const DC_SHOWN_SO_CODE = sql`COALESCE(${DC_FIRST_SO_CODE}, ${DC_HEADER_SO_CODE})`;
export const DC_SHOWN_SO_INTERNAL_NO = sql`(CASE WHEN ${DC_FIRST_SO_CODE} IS NOT NULL
  THEN ${sfFirstLine(DC_LINES_OF, DC_LINE_SO_INTERNAL_NO, DC_LINE_SO_CODE, DC_LINE_ORDER)}
  ELSE ${DC_HEADER_SO_INTERNAL_NO} END)`;
export const DC_SO_EXTRA_COUNT = sfExtraDistinct(DC_LINES_OF, DC_LINE_SO_CODE);
export const DC_SHOWN_JC_CODE = sql`COALESCE(${DC_FIRST_JC_CODE}, njc.code)`;
export const DC_JC_EXTRA_COUNT = sfExtraDistinct(DC_LINES_OF, sql`ljc.code`);

/** ADR-303 — the line facts the one-row-per-DC list filters on: the DC's own
 *  (header) value OR any live line (lib/list-query liftLineFilters). The
 *  header expressions need DC_SF_JOINS in every query the filter reaches. */
export const DC_LINE_LIFT: SfLiftSpec = {
  fields: {
    soCode: { line: DC_LINE_SO_CODE, header: DC_HEADER_SO_CODE, type: 'text' },
    soInternalNo: {
      line: DC_LINE_SO_INTERNAL_NO,
      header: DC_HEADER_SO_INTERNAL_NO,
      type: 'text',
    },
    jobCardCode: { line: sql`ljc.code`, header: sql`njc.code`, type: 'text' },
  },
  linesFrom: DC_LINES_OF,
};

export const DC_SF_COLUMNS: SfColumnMap = {
  dcCode: { sql: sql`dc.code`, type: 'text' },
  dcDate: { sql: sql`dc.dc_date`, type: 'date' },
  vendor: { sql: sql`COALESCE(v.name, dc.vendor_code_text)`, type: 'text' },
  // 0237 — a return challan may carry several NCs: the cell lists every one
  // (dc_ncs, line order), the header NC as the old-row fallback.
  poCode: {
    sql: sql`(CASE WHEN dc.nc_id IS NOT NULL
                   THEN 'NC ' || COALESCE(dc_ncs.nc_codes, nc.code, dc.po_code_text)
                   ELSE COALESCE(po.code, dc.po_code_text) END)`,
    type: 'text',
  },
  // ADR-303 — one row per DC: SO No. / Internal SO No. / JC No. show the FIRST
  // line's value, else the DC's own (header) one, and SORT on it (scalar
  // subqueries, DC_SHOWN_*). Their FILTERS (the SO dropdown included) never
  // reach this map: liftLineFilters (lib/list-query) answers them over
  // DC_LINE_LIFT — the header value OR any line.
  soCode: { sql: DC_SHOWN_SO_CODE, type: 'text' },
  soInternalNo: { sql: DC_SHOWN_SO_INTERNAL_NO, type: 'text' },
  totalQty: { sql: sql`COALESCE(line_agg.total_qty, 0)`, type: 'num' },
  lineCount: { sql: sql`COALESCE(line_agg.line_count, 0)::int`, type: 'num' },
  status: { sql: sql`dc.status`, type: 'list' },
  jobCardCode: { sql: DC_SHOWN_JC_CODE, type: 'text' },
  drawingRev: {
    // ADR-289 — same expression as the page's "soLineRevision" column.
    sql: sql`COALESCE(${DC_STORED_REV_SQL}, sol.revision::text, po_so.so_revision, njc_jwl.revision::text)`,
    type: 'text',
  },
  transport: { sql: sql`dc.transport`, type: 'text' },
  createdOn: { sql: sql`(dc.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  createdBy: { sql: createdByNameSql(sql`dc.created_by`), type: 'text' },
};

/**
 * The page query's joins beyond `dc` + `v` — the ONE copy: listDeliveryChallans
 * interpolates it in its page query, and in its count and KPI-summary queries
 * while a filter is on, so every DC_SF_COLUMNS expression is valid there too.
 * Each is one row per DC (FK lookups and single-row LATERAL aggregates), so
 * none can change which DCs, or how many DC lines, are counted.
 *
 * po_so: OSP/vendor DCs carry only purchase_order_id (no sales_order_line_id),
 * so the SO is resolved through the PO's lines' source_so_line_id as a
 * fallback. One drawing revision, or none at all: the SO code beside it is an
 * aggregate over every line of the PO, so pairing "IN-SO-11, IN-SO-12" with
 * "A, B" would leave the reader to guess which belongs to which. A revision is
 * emitted only when all of the PO's SO lines agree on one; otherwise NULL,
 * which prints as no revision rather than as a guess. ::text for the pre-0119
 * integer column.
 */
export const DC_SF_JOINS = sql`
      LEFT JOIN public.purchase_orders po
        ON po.id = dc.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.nc_register nc ON nc.id = dc.nc_id AND nc.deleted_at IS NULL
      -- 0237 — every NC a return challan's lines carry, in line order: the
      -- PO-No. cell's codes and the list item's ncs. One row per DC; nothing
      -- read for an ordinary DC (no header nc_id).
      LEFT JOIN LATERAL (
        SELECT string_agg(x.code, ', ' ORDER BY x.first_line, x.code) AS nc_codes,
          json_agg(json_build_object('id', x.id, 'code', x.code)
                   ORDER BY x.first_line, x.code) AS ncs
        FROM (
          SELECT lnc.id, lnc.code, MIN(ldcl.line_no) AS first_line
          FROM public.delivery_challan_lines ldcl
          JOIN public.nc_register lnc
            ON lnc.id = COALESCE(ldcl.nc_id, dc.nc_id) AND lnc.deleted_at IS NULL
          WHERE ldcl.delivery_challan_id = dc.id AND ldcl.deleted_at IS NULL
            AND dc.nc_id IS NOT NULL
          GROUP BY lnc.id, lnc.code
        ) x
      ) dc_ncs ON TRUE
      LEFT JOIN public.job_cards njc ON njc.id = dc.job_card_id AND njc.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines njc_jwl
        ON njc_jwl.id = njc.source_jw_line_id AND njc_jwl.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = dc.sales_order_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT so2.code, ', ' ORDER BY so2.code) AS so_code,
          CASE WHEN COUNT(DISTINCT sol2.revision) = 1
               THEN MIN(sol2.revision)::text END AS so_revision,
          -- ADR-207: the Internal SO No. only when the PO serves ONE SO.
          CASE WHEN COUNT(DISTINCT so2.id) = 1
               THEN MIN(so2.internal_so_no) END AS so_internal_no
        FROM public.purchase_order_lines pol
        JOIN public.sales_order_lines sol2
          ON sol2.id = pol.source_so_line_id AND sol2.deleted_at IS NULL
        JOIN public.sales_orders so2
          ON so2.id = sol2.sales_order_id AND so2.deleted_at IS NULL
        WHERE pol.purchase_order_id = dc.purchase_order_id
          AND pol.deleted_at IS NULL
      ) po_so ON TRUE
      -- ADR-207: a free-text so_ref_text has no FK; its SO (for the Internal
      -- SO No.) is matched by code within the company — unique per company.
      LEFT JOIN public.sales_orders so_ref
        ON so_ref.company_id = dc.company_id AND so_ref.code = dc.so_ref_text
       AND so_ref.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS line_count,
          COALESCE(SUM(qty), 0) AS total_qty
        FROM public.delivery_challan_lines dcl
        WHERE dcl.delivery_challan_id = dc.id AND dcl.deleted_at IS NULL
      ) line_agg ON TRUE`;

/** ADR-261 — a DC line's drawing revision: the SO line's, else the job-work
 *  line's, and only when that order line is for the SAME item as the challan
 *  line (the DC detail's rule — a raw-material bar never borrows the part's
 *  revision). ::text for the pre-0119 integer column. */
// ADR-289 — the Rev STORED on the line at create first (0247); the live
// order-line text only for a row made before it.
export const DC_LINE_REV_SQL = sql`COALESCE(
  ${drawingRevOf(sql`dcl.item_revision_id`)},
  CASE WHEN sol.item_id = dcl.item_id THEN sol.revision::text END,
  CASE WHEN jwl.item_id = dcl.item_id THEN jwl.revision::text END)`;

/**
 * ADR-261 — the OSP Outward DC LINE list (GET /delivery-challans/lines, one row
 * per DC line). Same field names as DC_SF_COLUMNS where the column means the
 * same thing; every alias is joined ONCE in list-lines.ts's DC_LINE_FROM, which
 * the page, the count and the summary all read, so a filter is always valid.
 */
export const DC_LINE_SF_COLUMNS: SfColumnMap = {
  dcCode: { sql: sql`dc.code`, type: 'text' },
  dcDate: { sql: sql`dc.dc_date`, type: 'date' },
  vendor: { sql: sql`COALESCE(v.name, dc.vendor_code_text)`, type: 'text' },
  // `nc` here is the LINE's NC (list-lines.ts joins COALESCE(dcl.nc_id,
  // dc.nc_id)) — 0237, one return DC may carry several NCs.
  poCode: {
    sql: sql`(CASE WHEN dc.nc_id IS NOT NULL
                   THEN 'NC ' || COALESCE(nc.code, dc.po_code_text)
                   ELSE COALESCE(po.code, dc.po_code_text) END)`,
    type: 'text',
  },
  // The SO No. cell: the SO code, else the JWSO code, else the DC's SO ref.
  soCode: { sql: sql`COALESCE(so.code, jw.code, dc.so_ref_text)`, type: 'text' },
  soInternalNo: { sql: sql`COALESCE(so.internal_so_no, so_ref.internal_so_no)`, type: 'text' },
  clientPoLineNo: {
    sql: sql`COALESCE(sol.client_po_line_no, jwl.client_po_line_no)`,
    type: 'text',
  },
  createdOn: {
    sql: sql`(COALESCE(dcl.created_at, dc.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  createdBy: { sql: createdByNameSql(sql`COALESCE(dcl.created_by, dc.created_by)`), type: 'text' },
  // CODE/REV as the cell prints it (itemCodeWithRev).
  itemCode: {
    sql: sql`(btrim(COALESCE(i.code, dcl.item_code_text)) || COALESCE('/' || NULLIF(btrim(${DC_LINE_REV_SQL}), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`COALESCE(i.name, dcl.item_name_text)`, type: 'text' },
  qty: { sql: sql`dcl.qty`, type: 'num' },
  status: { sql: sql`dc.status`, type: 'list' },
  jobCardCode: { sql: sql`ljc.code`, type: 'text' },
  transport: { sql: sql`dc.transport`, type: 'text' },
};
