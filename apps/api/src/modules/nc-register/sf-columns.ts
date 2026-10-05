// Sort & Filter (ADR-200) — the NC Register list's sortable / filterable
// fields. Each expression is the value listNcRegister SELECTs for that column
// (same table aliases as its list query), and
// is what the cell shows: Item Code / Item Name read the master row first, the
// stored snapshot second. No money here: scrap cost is not a list column.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const NC_SF_COLUMNS: SfColumnMap = {
  ncCode: { sql: sql`nc.code`, type: 'text' },
  status: { sql: sql`nc.status`, type: 'list' },
  disposition: { sql: sql`nc.disposition`, type: 'list' },
  // CODE/REV as the cell prints it: the master code with the customer's drawing
  // revision (SO line, else JW line) after a slash, else the typed snapshot.
  // sol / rev_jwl are joined by the list, and by its count when a filter is set.
  itemCode: {
    sql: sql`(CASE WHEN NULLIF(i.code, '') IS NOT NULL
      THEN btrim(i.code) || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, rev_jwl.revision::text)), ''), '')
      ELSE nc.item_code_text END)`,
    type: 'text',
  },
  itemName: { sql: sql`COALESCE(i.name, nc.item_name_text)`, type: 'text' },
  // ADR-207 — the Internal SO No., the SAME scalar the list SELECTs: read live
  // off the NC's own SO (nc.so_id). A scalar, so it cannot multiply the row and
  // is valid in the count query, which selects from nc_register too.
  soInternalNo: {
    sql: sql`(SELECT nso.internal_so_no FROM public.sales_orders nso
      WHERE nso.id = nc.so_id)`,
    type: 'text',
  },
  rejectedQty: { sql: sql`nc.rejected_qty`, type: 'num' },
  reasonCategory: { sql: sql`nc.reason_category`, type: 'list' },
  ncDate: { sql: sql`nc.nc_date`, type: 'date' },
  createdOn: { sql: sql`(nc.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
