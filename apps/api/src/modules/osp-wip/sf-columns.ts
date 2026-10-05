// Sort & Filter (ADR-200) — the At-Vendor Register's sortable / filterable
// fields. Each expression is the SAME one listOspWip SELECTs for that column
// (v_osp_wip w + the sol / rev_jwl joins, shared by the page and its summary).

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const OSP_WIP_SF_COLUMNS: SfColumnMap = {
  jcCode: { sql: sql`w.jc_code`, type: 'text' },
  clientPoLineNo: { sql: sql`sol.client_po_line_no`, type: 'text' },
  // CODE/REV as the cell prints it (itemCodeWithRev).
  itemCode: {
    sql: sql`(w.item_code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, rev_jwl.revision::text)), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`w.item_name`, type: 'text' },
  soCode: { sql: sql`w.so_code`, type: 'text' },
  // ADR-207 — the Internal SO No. of that same SO, off the `so` join the
  // register's shared FROM makes (page and summary alike).
  soInternalNo: { sql: sql`so.internal_so_no`, type: 'text' },
  vendorName: { sql: sql`w.vendor_name`, type: 'text' },
  operation: { sql: sql`w.operation`, type: 'text' },
  orderQty: { sql: sql`w.order_qty`, type: 'num' },
  sentQty: { sql: sql`w.sent_qty`, type: 'num' },
  atVendorQty: { sql: sql`w.at_vendor_qty`, type: 'num' },
  inQcQty: { sql: sql`w.in_qc_qty`, type: 'num' },
  acceptedQty: { sql: sql`w.accepted_qty`, type: 'num' },
  rejectedQty: { sql: sql`w.rejected_qty`, type: 'num' },
  notSentQty: { sql: sql`w.not_sent_qty`, type: 'num' },
  readyToSendQty: { sql: sql`w.ready_to_send_qty`, type: 'num' },
};
