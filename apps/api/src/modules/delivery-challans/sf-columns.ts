// Sort & Filter (ADR-200) — the OSP Outward DC list's sortable / filterable
// fields. Each expression is the value listDeliveryChallans SELECTs for that
// column (same table aliases), and is the text the column's cell shows: the
// Vendor cell reads vendorName ?? vendorCodeText, the PO cell "NC <code>" on a
// return-to-vendor challan else poCode ?? poCodeText, the SO cell
// soCode ?? soRefText. The aliases beyond `dc` + `v` are reached through
// DC_SF_JOINS, which the count and KPI-summary queries add when a filter is on.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const DC_SF_COLUMNS: SfColumnMap = {
  dcCode: { sql: sql`dc.code`, type: 'text' },
  dcDate: { sql: sql`dc.dc_date`, type: 'date' },
  vendor: { sql: sql`COALESCE(v.name, dc.vendor_code_text)`, type: 'text' },
  poCode: {
    sql: sql`(CASE WHEN dc.nc_id IS NOT NULL
                   THEN 'NC ' || COALESCE(nc.code, dc.po_code_text)
                   ELSE COALESCE(po.code, dc.po_code_text) END)`,
    type: 'text',
  },
  soCode: { sql: sql`COALESCE(so.code, po_so.so_code, dc.so_ref_text)`, type: 'text' },
  totalQty: { sql: sql`COALESCE(line_agg.total_qty, 0)`, type: 'num' },
  lineCount: { sql: sql`COALESCE(line_agg.line_count, 0)::int`, type: 'num' },
  status: { sql: sql`dc.status`, type: 'list' },
  jobCardCode: { sql: sql`njc.code`, type: 'text' },
  drawingRev: {
    sql: sql`COALESCE(sol.revision::text, po_so.so_revision, njc_jwl.revision::text)`,
    type: 'text',
  },
  transport: { sql: sql`dc.transport`, type: 'text' },
  createdOn: { sql: sql`(dc.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
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
