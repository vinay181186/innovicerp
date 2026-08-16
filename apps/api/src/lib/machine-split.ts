// Per-machine production split for one JC operation (0095 / ADR-125).
//
// Used by the machine-change audit trail. The first version of that trail read
// `v_jc_op_status.completed_qty` (the op TOTAL) and asserted it against the one
// machine being replaced:
//
//   "Machine changed … CNC-02 → CNC-03; 10 pcs already completed stay
//    recorded against CNC-02"
//
// That is wrong from the SECOND machine change onward — traced on
// IN-JC-26-00093 op 1, where the real split was CNC-01 5 + CNC-02 5, not 10 on
// CNC-02. The whole point of 0095 is that each op_log row carries its own
// machine, so the audit line must read the split rather than restate a total.

import { sql } from 'drizzle-orm';
import type { withUserContext } from '../db/with-user-context';

type Tx = Parameters<Parameters<typeof withUserContext<unknown>>[1]>[0];

export interface MachineSplitRow {
  machineCode: string;
  qty: number;
}

/** Per-machine completed qty for one op, busiest machine first. Empty when the
 *  op has no production logged yet. */
export async function loadMachineSplit(tx: Tx, jcOpId: string): Promise<MachineSplitRow[]> {
  const rows = (await tx.execute(sql`
    SELECT machine_code AS "machineCode", completed_qty AS "completedQty"
    FROM public.v_op_machine_output
    WHERE jc_op_id = ${jcOpId}::uuid
    ORDER BY completed_qty DESC, machine_code
  `)) as unknown as Array<{ machineCode: string; completedQty: number }>;
  return rows.map((r) => ({ machineCode: String(r.machineCode), qty: Number(r.completedQty) }));
}

/** The audit-line clause describing what stays where, e.g.
 *  "CNC-01 5 · CNC-02 5 stay recorded against their own machines".
 *  Collapses to the single-machine wording when only one machine ran the op,
 *  and says so plainly when nothing has been made yet. */
export function describeMachineSplit(split: MachineSplitRow[]): string {
  if (split.length === 0) return 'nothing completed yet, so no production is affected';
  if (split.length === 1) {
    const only = split[0]!;
    return `${only.qty} pcs already completed stay recorded against ${only.machineCode}`;
  }
  const parts = split.map((s) => `${s.machineCode} ${s.qty}`).join(' · ');
  return `${parts} stay recorded against their own machines`;
}
