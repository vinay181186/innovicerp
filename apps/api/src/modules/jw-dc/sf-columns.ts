// Sort & Filter (ADR-200) — the JW DC Outward / Inward registers' sortable /
// filterable fields. Both list queries read their rows through a derived table
// `z` (the very SELECT the register shows), and their count query counts that
// same derived table — so every expression here is a column the row prints,
// valid in the list AND the count. Field names are the screen's `sortFilterField`.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const JW_DC_OUTWARD_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`z.code`, type: 'text' },
  dcDate: { sql: sql`z."dcDate"`, type: 'date' },
  poNo: { sql: sql`z."jwpoCodeText"`, type: 'text' },
  soNo: { sql: sql`z."soCode"`, type: 'text' },
  // Vendor as the cell prints it: master name, else the snapshot name / code.
  vendor: {
    sql: sql`COALESCE(z."vendorName", z."vendorNameText", z."vendorCodeText")`,
    type: 'text',
  },
  sentQty: { sql: sql`z."totalSentQty"`, type: 'num' },
  receivedQty: { sql: sql`z."totalReturnedQty"`, type: 'num' },
  pendingQty: { sql: sql`z."pendingQty"`, type: 'num' },
  returnStatus: { sql: sql`z."returnStatus"`, type: 'list' },
};

export const JW_DC_INWARD_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`z.code`, type: 'text' },
  inwardDate: { sql: sql`z."inwardDate"`, type: 'date' },
  dcNo: { sql: sql`z."dcCodeText"`, type: 'text' },
  vendor: { sql: sql`COALESCE(z."vendorName", z."vendorNameText")`, type: 'text' },
  receivedQty: { sql: sql`z."totalReceivedQty"`, type: 'num' },
  acceptedQty: { sql: sql`z."totalOkQty"`, type: 'num' },
  rejectedQty: { sql: sql`z."totalRejectedQty"`, type: 'num' },
};
