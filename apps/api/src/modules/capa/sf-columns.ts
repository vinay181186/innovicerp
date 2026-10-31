// Sort & Filter (ADR-200) — the CAPA list's sortable / filterable fields. Each
// expression is the column the CAPA list shows (capa_records, no joins), so the
// same map serves the page and its count.

import { sql } from 'drizzle-orm';

import { capaRecords as c } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

/** NC No. as the cell prints it: the jsonb array joined with ", ". */
export const CAPA_NC_REFS_TEXT = sql`(SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(${c.ncRefs}) AS x)`;

/** ADR-261 lead Internal SO No. — the CAPA's SO, matched by code in its company. */
export const CAPA_SO_INTERNAL = sql`(SELECT NULLIF(btrim(so.internal_so_no), '') FROM public.sales_orders so
  WHERE so.company_id = ${c.companyId} AND so.code = ${c.soNo} AND so.deleted_at IS NULL LIMIT 1)`;
/** ADR-261 lead Item Name — the CAPA's item, matched by code in its company. */
export const CAPA_ITEM_NAME = sql`(SELECT i.name FROM public.items i
  WHERE i.company_id = ${c.companyId} AND i.code = ${c.itemCode} AND i.deleted_at IS NULL LIMIT 1)`;

export const CAPA_SF_COLUMNS: SfColumnMap = {
  // ADR-261 lead columns.
  soNo: { sql: sql`${c.soNo}`, type: 'text' },
  soInternalNo: { sql: CAPA_SO_INTERNAL, type: 'text' },
  itemCode: { sql: sql`${c.itemCode}`, type: 'text' },
  itemName: { sql: CAPA_ITEM_NAME, type: 'text' },
  createdOn: { sql: sql`(${c.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  code: { sql: sql`${c.code}`, type: 'text' },
  type: { sql: sql`${c.type}`, type: 'list' },
  ncRefs: { sql: CAPA_NC_REFS_TEXT, type: 'text' },
  problem: { sql: sql`${c.problem}`, type: 'text' },
  responsible: { sql: sql`${c.responsible}`, type: 'text' },
  targetDate: { sql: sql`${c.targetDate}`, type: 'date' },
  status: { sql: sql`${c.status}`, type: 'list' },
  capaDate: { sql: sql`${c.capaDate}`, type: 'date' },
};
