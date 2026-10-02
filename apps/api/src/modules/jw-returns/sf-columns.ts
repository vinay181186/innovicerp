// Sort & Filter (ADR-200) — the JW Return register's sortable / filterable
// fields. listJwReturnChallans reads jw_return_challans LEFT JOIN clients,
// job_work_order_lines and items; its list AND count queries carry those
// joins, so each expression is the one the row shows (Item Code as
// itemCodeWithRev prints it: live item code, else the JWSO line's snapshot,
// then "/rev"). No money on this register.

import { sql } from 'drizzle-orm';

import { clients, items, jobWorkOrderLines, jwReturnChallans } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const JW_RETURN_SF_COLUMNS: SfColumnMap = {
  returnCode: { sql: sql`${jwReturnChallans.code}`, type: 'text' },
  returnDate: { sql: sql`${jwReturnChallans.returnDate}`, type: 'date' },
  jwsoCode: { sql: sql`${jwReturnChallans.jwCodeText}`, type: 'text' },
  customer: { sql: sql`${clients.name}`, type: 'text' },
  itemCode: {
    sql: sql`(COALESCE(${items.code}, ${jobWorkOrderLines.itemCodeText}) || COALESCE('/' || NULLIF(btrim(${jobWorkOrderLines.revision}::text), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`${jobWorkOrderLines.partName}`, type: 'text' },
  qty: { sql: sql`${jwReturnChallans.qty}`, type: 'num' },
  status: { sql: sql`${jwReturnChallans.status}`, type: 'list' },
};
