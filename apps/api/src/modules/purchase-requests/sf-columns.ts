// Sort & Filter (ADR-200) — the Purchase Request list's sortable / filterable
// fields. Each expression is the SAME one listPurchaseRequests SELECTs (or the
// screen renders from it) for that column, with the same table aliases, and
// every alias it needs is joined by BOTH the list and the count query.
//
// On PO / Pending are the ordered and balance quantities (ADR-152). The row
// works them out in deriveOrderedQty / deriveBalanceQty, but their one SQL twin
// is orderedQtySql (the expression convertibleOnly already filters on), so the
// caller passes it in — imported here it would make a cycle with service.ts.
// Est. cost is not a column on this screen, so there is no money field.

import { type SQL, sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export function prSfColumns(orderedQty: SQL): SfColumnMap {
  return {
    prCode: { sql: sql`pr.code`, type: 'text' },
    prDate: { sql: sql`pr.pr_date`, type: 'date' },
    // The cell renders itemCode ?? itemCodeText (live master, then the snapshot).
    itemCode: { sql: sql`COALESCE(i.code, pr.item_code_text)`, type: 'text' },
    itemName: { sql: sql`pr.item_name`, type: 'text' },
    // The cell renders vendorName ?? vendorCodeText; vendorName = COALESCE(v.name, vt.name).
    vendorName: { sql: sql`COALESCE(v.name, vt.name, pr.vendor_code_text)`, type: 'text' },
    qty: { sql: sql`pr.qty`, type: 'num' },
    orderedQty: { sql: orderedQty, type: 'num' },
    // The Pending cell (web prOrderBalance): qty − ordered, not clamped; once
    // short-closed 0 — or still negative if the PR was over-ordered.
    balanceQty: {
      sql: sql`(CASE WHEN pr.balance_closed_at IS NOT NULL THEN LEAST(0, pr.qty - ${orderedQty})
                ELSE pr.qty - ${orderedQty} END)`,
      type: 'num',
    },
    requiredDate: { sql: sql`pr.required_date`, type: 'date' },
    status: { sql: sql`pr.status`, type: 'list' },
    createdOn: { sql: sql`(pr.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  };
}
