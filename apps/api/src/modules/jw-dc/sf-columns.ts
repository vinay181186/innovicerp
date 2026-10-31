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

// ADR-261 — the one-row-per-LINE registers (list-lines.ts). Same derived-row
// pattern: every expression is a column of `z`, valid in the list and count.
// Field names match the document registers where the column means the same
// thing, so a filter kept in the tab carries over.
const JW_DC_LINE_LEAD_SF: SfColumnMap = {
  // SO No. as the cell prints it: the SO code, else the JWSO code.
  soCode: { sql: sql`z."orderCode"`, type: 'text' },
  soInternalNo: { sql: sql`z."soInternalNo"`, type: 'text' },
  clientPoLineNo: { sql: sql`z."clientPoLineNo"`, type: 'text' },
  createdOn: { sql: sql`z."createdOn"`, type: 'date' },
  // CODE/REV as the cell prints it.
  itemCode: { sql: sql`z."itemCodeRev"`, type: 'text' },
  itemName: { sql: sql`z."itemName"`, type: 'text' },
  vendor: { sql: sql`z."vendorName"`, type: 'text' },
  poNo: { sql: sql`z."jwpoCodeText"`, type: 'text' },
};

export const JW_DC_OUTWARD_LINES_SF_COLUMNS: SfColumnMap = {
  ...JW_DC_LINE_LEAD_SF,
  code: { sql: sql`z."docCode"`, type: 'text' },
  dcDate: { sql: sql`z."docDate"`, type: 'date' },
  sentQty: { sql: sql`z."sentQty"`, type: 'num' },
  receivedQty: { sql: sql`z."receivedQty"`, type: 'num' },
  pendingQty: { sql: sql`z."pendingQty"`, type: 'num' },
  returnStatus: { sql: sql`z."returnStatus"`, type: 'list' },
};

export const JW_DC_INWARD_LINES_SF_COLUMNS: SfColumnMap = {
  ...JW_DC_LINE_LEAD_SF,
  code: { sql: sql`z."docCode"`, type: 'text' },
  inwardDate: { sql: sql`z."docDate"`, type: 'date' },
  dcNo: { sql: sql`z."dcCodeText"`, type: 'text' },
  receivedQty: { sql: sql`z."receivedQty"`, type: 'num' },
  acceptedQty: { sql: sql`z."okQty"`, type: 'num' },
  rejectedQty: { sql: sql`z."rejectedQty"`, type: 'num' },
};
