// Sort & Filter (ADR-200) — the Operation Log list's sortable / filterable
// fields. Each expression is the SAME one listOpLog SELECTs for that column,
// over the joins the list carries (its count adds them when a filter is set). Not here: the
// Reversal column (a label built per row from two look-ups — "Reversal of …"
// / "Reversed by …").

import { sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  machines,
  opLog,
  salesOrderLines,
  users,
} from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

// Second handle on machines for the PLANNED machine (jc_ops.machine_id); the
// plain `machines` join is the machine the row was ACTUALLY made on (ADR-164).
export const plannedMachine = alias(machines, 'planned_machine');

export const OP_LOG_SF_COLUMNS: SfColumnMap = {
  logNo: { sql: sql`${opLog.logNo}`, type: 'text' },
  jcNo: { sql: sql`${jobCards.code}`, type: 'text' },
  clientPoLineNo: { sql: sql`${salesOrderLines.clientPoLineNo}`, type: 'text' },
  // CODE/REV as the cell prints it (itemCodeWithRev): the customer's drawing
  // revision off the SO line, else the JW line, after a slash.
  itemCode: {
    sql: sql`(btrim(${items.code}) || COALESCE('/' || NULLIF(btrim(COALESCE(${salesOrderLines.revision}::text, ${jobWorkOrderLines.revision}::text)), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`${items.name}`, type: 'text' },
  logDate: { sql: sql`${opLog.logDate}`, type: 'date' },
  opSeq: { sql: sql`${jcOps.opSeq}`, type: 'num' },
  logType: { sql: sql`${opLog.logType}`, type: 'list' },
  shift: { sql: sql`${opLog.shift}`, type: 'list' },
  plannedMachine: {
    sql: sql`COALESCE(${plannedMachine.code}, NULLIF(${jcOps.machineCodeText}, 'QC'))`,
    type: 'text',
  },
  // Live master code first, then the LOG's snapshot, then the OP's snapshot —
  // the order the row is built in.
  actualMachine: {
    sql: sql`COALESCE(${machines.code}, ${opLog.machineCodeText}, ${jcOps.machineCodeText})`,
    type: 'text',
  },
  operation: { sql: sql`${jcOps.operation}`, type: 'text' },
  qty: { sql: sql`${opLog.qty}`, type: 'num' },
  rejectQty: { sql: sql`${opLog.rejectQty}`, type: 'num' },
  operatorName: { sql: sql`${opLog.operatorName}`, type: 'text' },
  remarks: { sql: sql`${opLog.remarks}`, type: 'text' },
  loggedBy: { sql: sql`${users.fullName}`, type: 'text' },
  reversalReason: { sql: sql`${opLog.reversalReason}`, type: 'text' },
  createdOn: { sql: sql`(${opLog.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
