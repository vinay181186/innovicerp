// Sort & Filter (ADR-200/201) — the JC Operations board's sortable /
// filterable fields. Each expression is the SAME one listJcOpsBoard SELECTs
// (same table aliases, used by both its page and its count query), so what the
// user filters is what the row shows. Actual Machine and Qty per Machine come
// from a per-op aggregate and are not here.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

const isOsp = sql`op.op_type = 'outsource'`;

export const JC_OPS_SF_COLUMNS: SfColumnMap = {
  jcCode: { sql: sql`jc.code`, type: 'text' },
  clientPoLineNo: { sql: sql`sol.client_po_line_no`, type: 'text' },
  // CODE/REV as the cell prints it (itemCodeWithRev).
  itemCode: {
    sql: sql`(i.code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, rev_jwl.revision::text)), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`i.name`, type: 'text' },
  opSeq: { sql: sql`op.op_seq`, type: 'num' },
  // An outsource op shows no machine.
  plannedMachine: {
    sql: sql`(CASE WHEN ${isOsp} THEN NULL ELSE COALESCE(m.code, op.machine_code_text) END)`,
    type: 'text',
  },
  operation: { sql: sql`op.operation`, type: 'text' },
  cycleTime: { sql: sql`(COALESCE(op.cycle_time_min, 0) / 60.0)::numeric(10,3)`, type: 'num' },
  qcRequired: { sql: sql`op.qc_required`, type: 'list' },
  jcQty: { sql: sql`jc.order_qty`, type: 'num' },
  completed: {
    sql: sql`COALESCE(CASE WHEN op.op_type = 'qc' THEN s.qc_accepted_qty ELSE s.completed_qty END, 0)::int`,
    type: 'num',
  },
  qcPending: { sql: sql`COALESCE(s.qc_pending, 0)::int`, type: 'num' },
  available: { sql: sql`COALESCE(s.available, 0)::int`, type: 'num' },
  pendingHrs: {
    sql: sql`ROUND((COALESCE(op.cycle_time_min, 0) * COALESCE(s.available, 0) / 60.0)::numeric, 2)`,
    type: 'num',
  },
  status: { sql: sql`COALESCE(s.computed_status, 'waiting')`, type: 'list' },
  // The cell is blank on an in-house op and 'pending' when unset.
  outsourceStatus: {
    sql: sql`(CASE WHEN ${isOsp} THEN COALESCE(op.outsource_status::text, 'pending') END)`,
    type: 'list',
  },
  vendor: { sql: sql`(CASE WHEN ${isOsp} THEN ven.name END)`, type: 'text' },
};
