// Sort & Filter (ADR-200) — QC History's two tables. Each expression is the
// SAME one sql.ts SELECTs for that column (same aliases, valid in both the
// page query and its count). The Op column prints a converted serial number
// (opSrNo), so it is not offered — a filter on the raw op_seq would not match
// what the cell shows.

import { sql } from 'drizzle-orm';
import type { SfColumnMap } from '../../lib/list-query';
import { ITEM_CODE_REV, PEND_SINCE } from './sql';

const LEAD: SfColumnMap = {
  jcCode: { sql: sql`jc.code`, type: 'text' },
  soCode: { sql: sql`so.code`, type: 'text' },
  clientPoLineNo: { sql: sql`sol.client_po_line_no`, type: 'text' },
  itemCode: { sql: ITEM_CODE_REV, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  operation: { sql: sql`jo.operation`, type: 'text' },
};

export const QC_PENDING_SF_COLUMNS: SfColumnMap = {
  ...LEAD,
  orderQty: { sql: sql`jc.order_qty`, type: 'num' },
  completed: { sql: sql`vos.completed_qty`, type: 'num' },
  qcAccepted: { sql: sql`vos.qc_accepted_qty`, type: 'num' },
  qcRejected: { sql: sql`vos.qc_rejected_qty`, type: 'num' },
  qcPending: { sql: sql`vos.qc_pending`, type: 'num' },
  pendSince: { sql: PEND_SINCE, type: 'date' },
};

export const QC_LOGS_SF_COLUMNS: SfColumnMap = {
  ...LEAD,
  accepted: { sql: sql`ol.qty`, type: 'num' },
  rejected: { sql: sql`ol.reject_qty`, type: 'num' },
  logDate: { sql: sql`ol.log_date`, type: 'date' },
  shift: { sql: sql`ol.shift`, type: 'list' },
  inspector: { sql: sql`ol.operator_name`, type: 'text' },
  remarks: { sql: sql`ol.remarks`, type: 'text' },
};
