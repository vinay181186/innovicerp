// Sort & Filter (ADR-200/201) — the Incoming QC tables' sortable / filterable
// fields. Each expression is the SAME one getIncomingQc (./read.ts) SELECTs for
// that column, over the same aliases its list and count queries share, so what
// the user filters is what the row shows.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

// CODE/REV as the cell prints it (itemCodeWithRev): the customer's drawing
// revision off the SO / JWSO line behind the receipt, after a slash.
const itemCodeWithRev = sql`(COALESCE(i.code, l.item_code_text) || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, rev_jwl.revision::text)), ''), ''))`;

export const IQC_PENDING_SF_COLUMNS: SfColumnMap = {
  grnNo: { sql: sql`h.code`, type: 'text' },
  // ADR-207 — the Internal SO No. of the SO this receipt traces back to, off
  // the `so` join the shared JOINS already makes (null on a raw-material GRN,
  // exactly as the pending row's soCode is). Only the PENDING table carries
  // the SO trace; the completed table's contract has no SO field.
  soInternalNo: { sql: sql`so.internal_so_no`, type: 'text' },
  itemCode: { sql: itemCodeWithRev, type: 'text' },
  vendorName: { sql: sql`COALESCE(v.name, h.vendor_code_text)`, type: 'text' },
  pendingQty: { sql: sql`(l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty)`, type: 'num' },
  waitDays: { sql: sql`GREATEST(0, (CURRENT_DATE - h.grn_date))`, type: 'num' },
  grnDate: { sql: sql`h.grn_date`, type: 'date' },
};

/** The QC result as dispositionOf() in ./read.ts words it — one CASE so the
 *  tick list, the sort and the row agree. */
export const IQC_DISPOSITION_SQL = sql`(CASE
  WHEN (l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty) > 0 THEN 'Partial Accept'
  WHEN l.qc_accepted_qty > 0 AND l.qc_rejected_qty > 0 THEN 'Partial Accept'
  WHEN l.qc_rejected_qty > 0 THEN 'Rejected'
  ELSE 'Accepted' END)`;

export const IQC_COMPLETED_SF_COLUMNS: SfColumnMap = {
  grnNo: { sql: sql`h.code`, type: 'text' },
  itemCode: { sql: itemCodeWithRev, type: 'text' },
  acceptedQty: { sql: sql`l.qc_accepted_qty`, type: 'num' },
  rejectedQty: { sql: sql`l.qc_rejected_qty`, type: 'num' },
  disposition: { sql: IQC_DISPOSITION_SQL, type: 'list' },
  qcDate: { sql: sql`l.qc_date`, type: 'date' },
};
