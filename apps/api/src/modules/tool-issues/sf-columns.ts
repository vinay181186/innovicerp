// Sort & Filter (ADR-200) — the Tool Issue Register's sortable / filterable
// fields. listToolIssues reads ISSUE_SELECT wrapped as `x`, and its list and
// count both filter over `x`, so each expression is the SAME `x` column the
// row shows.
//   returnStatus — the badge the screen draws (tool-issue-columns.tsx
//                  statusBadge): Cancelled, Returned, Overdue (out past its
//                  expected return, India today), Partly Returned, else Out.
// Item Name rides under the Item Code in one column, so only the code is here.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const TOOL_ISSUE_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`x.code`, type: 'text' },
  issueDate: { sql: sql`x.issue_date`, type: 'date' },
  itemCode: { sql: sql`x.item_code`, type: 'text' },
  serialNos: { sql: sql`x.serial_nos`, type: 'text' },
  qty: { sql: sql`x.qty`, type: 'num' },
  issuedTo: { sql: sql`x.issued_to`, type: 'text' },
  expectedReturnDate: { sql: sql`x.expected_return_date`, type: 'date' },
  goodQty: { sql: sql`x.good_qty`, type: 'num' },
  stillOutQty: { sql: sql`x.still_out_qty`, type: 'num' },
  returnStatus: {
    sql: sql`(CASE
      WHEN x.cancelled_at IS NOT NULL THEN 'cancelled'
      WHEN x.return_status = 'returned' THEN 'returned'
      WHEN x.return_status <> 'cancelled' AND x.still_out_qty > 0
        AND x.expected_return_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'overdue'
      WHEN x.return_status = 'partial' THEN 'partial'
      ELSE 'out'
    END)`,
    type: 'list',
  },
  createdOn: { sql: sql`(x.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};

/** Who-holds-what (listToolHolders, also over `x`): Serial No. shows only the
 *  instruments not yet back, so it filters on out_serial_nos. */
export const TOOL_HOLDER_SF_COLUMNS: SfColumnMap = {
  issuedTo: { sql: sql`x.issued_to`, type: 'text' },
  itemCode: { sql: sql`x.item_code`, type: 'text' },
  serialNos: { sql: sql`x.out_serial_nos`, type: 'text' },
  stillOutQty: { sql: sql`x.still_out_qty`, type: 'num' },
  code: { sql: sql`x.code`, type: 'text' },
  expectedReturnDate: { sql: sql`x.expected_return_date`, type: 'date' },
};
