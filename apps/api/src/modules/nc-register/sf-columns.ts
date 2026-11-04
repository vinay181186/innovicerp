// Sort & Filter (ADR-200) — the NC Register list's sortable / filterable
// fields. Each expression is the value listNcRegister SELECTs for that column
// (same table aliases as its list query), and
// is what the cell shows: Item Code / Item Name read the master row first, the
// stored snapshot second. No money here: scrap cost is not a list column.

import { sql } from 'drizzle-orm';

import { createdByNameSql } from '../../lib/created-by-sql';
import type { SfColumnMap } from '../../lib/list-query';
import { ncSoKeySql } from './so-key';

export const NC_SF_COLUMNS: SfColumnMap = {
  ncCode: { sql: sql`nc.code`, type: 'text' },
  // ADR-261 lead SO No. — the SO code the cell prints (nc.so_code_text).
  soCode: { sql: sql`nc.so_code_text`, type: 'text' },
  // ADR-267 — the bare order No. for the order dropdown: the NC's SO, else the JWSO
  // of its job card, else the JWSO of its Party GRN (the row's sourceJwCode), the
  // snapshot last. Scalars, so the count query needs no extra join.
  orderCode: {
    sql: sql`COALESCE(
      (SELECT oso.code FROM public.sales_orders oso WHERE oso.id = ${ncSoKeySql('nc')}),
      (SELECT ojw.code FROM public.job_cards ojc
         JOIN public.job_work_order_lines ojwl ON ojwl.id = ojc.source_jw_line_id
         JOIN public.job_work_orders ojw ON ojw.id = ojwl.job_work_order_id
        WHERE ojc.id = nc.job_card_id AND ojc.company_id = nc.company_id LIMIT 1),
      (SELECT COALESCE(ogjw.code, NULLIF(opg.jw_code_text, '')) FROM public.party_grn_lines opgl
         JOIN public.party_grn opg ON opg.id = opgl.party_grn_id
         LEFT JOIN public.job_work_orders ogjw
           ON ogjw.id = opg.job_work_order_id AND ogjw.deleted_at IS NULL
        WHERE opgl.id = nc.party_grn_line_id AND opgl.company_id = nc.company_id LIMIT 1),
      NULLIF(nc.so_code_text, '')
    )`,
    type: 'text',
  },
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
  // off the NC's SO key (so-key.ts: nc.so_id, else the card's SO line's SO). A
  // scalar, so it cannot multiply the row and is valid in the count query,
  // which selects from nc_register too.
  soInternalNo: {
    sql: sql`(SELECT nso.internal_so_no FROM public.sales_orders nso
      WHERE nso.id = ${ncSoKeySql('nc')})`,
    type: 'text',
  },
  rejectedQty: { sql: sql`nc.rejected_qty`, type: 'num' },
  reasonCategory: { sql: sql`nc.reason_category`, type: 'list' },
  ncDate: { sql: sql`nc.nc_date`, type: 'date' },
  createdOn: { sql: sql`(nc.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  createdBy: { sql: createdByNameSql(sql`nc.created_by`), type: 'text' },
};
