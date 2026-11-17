// Sort & Filter (ADR-200) — the Customer Material Issue register's fields.
// listPartyMaterialIssues reads party_material_issues LEFT JOIN job_cards,
// items, sales_order_lines and job_work_order_lines; its list AND count
// queries carry those joins, so each expression is the one the row shows
// (Item Code = the job card's PRODUCED part as itemCodeWithRev prints it;
// Customer Material = the client's supplied material's -RM item code). No money here.

import { sql } from 'drizzle-orm';

import { items, jobWorkOrderLines, partyMaterialIssues, salesOrderLines } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const PARTY_ISSUE_SF_COLUMNS: SfColumnMap = {
  issueCode: { sql: sql`${partyMaterialIssues.code}`, type: 'text' },
  issueDate: { sql: sql`${partyMaterialIssues.issueDate}`, type: 'date' },
  jwsoCode: { sql: sql`${partyMaterialIssues.jwCodeText}`, type: 'text' },
  jcCode: { sql: sql`${partyMaterialIssues.jcCodeText}`, type: 'text' },
  itemCode: {
    sql: sql`(${items.code} || COALESCE('/' || NULLIF(btrim(COALESCE(${salesOrderLines.revision}::text, ${jobWorkOrderLines.revision}::text)), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`${items.name}`, type: 'text' },
  // Owner 2026-11-17: the live -RM item code (PM-#### snapshot only as fallback).
  customerMaterial: {
    sql: sql`COALESCE((
      SELECT COALESCE(ri.code, rpm.item_code_text)
        FROM public.party_materials rpm
        LEFT JOIN public.items ri ON ri.id = rpm.item_id
       WHERE rpm.id = ${partyMaterialIssues.partyMaterialId}
    ), ${partyMaterialIssues.partyMaterialCodeText})`,
    type: 'text',
  },
  qty: { sql: sql`${partyMaterialIssues.qty}`, type: 'num' },
};
