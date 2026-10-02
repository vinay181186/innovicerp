// Sort & Filter (ADR-200) — the NC Register list's sortable / filterable
// fields. Each expression is the value listNcRegister SELECTs for that column
// (same table aliases — nc and i are in both its list and its count query), and
// is what the cell shows: Item Code / Item Name read the master row first, the
// stored snapshot second. No money here: scrap cost is not a list column.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const NC_SF_COLUMNS: SfColumnMap = {
  ncCode: { sql: sql`nc.code`, type: 'text' },
  status: { sql: sql`nc.status`, type: 'list' },
  disposition: { sql: sql`nc.disposition`, type: 'list' },
  itemCode: { sql: sql`COALESCE(i.code, nc.item_code_text)`, type: 'text' },
  itemName: { sql: sql`COALESCE(i.name, nc.item_name_text)`, type: 'text' },
  rejectedQty: { sql: sql`nc.rejected_qty`, type: 'num' },
  reasonCategory: { sql: sql`nc.reason_category`, type: 'list' },
  ncDate: { sql: sql`nc.nc_date`, type: 'date' },
  createdOn: { sql: sql`(nc.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
