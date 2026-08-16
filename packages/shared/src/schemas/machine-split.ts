// Per-machine production split — the shared shape (0095 / ADR-126).
//
// ADR-125 moved the machine onto `op_log`, so the DATA knows which machine made
// which pieces. ADR-126 is about the SCREENS, which still pair a machine label
// with an operation-level total:
//
//   IN-JC-26-00093 · op 1 · CNC-03 · order 50 · done 10 · avail 40
//
// where the log actually held CNC-01 5 + CNC-02 5 and CNC-03 had made nothing.
// The confusion is that one column carries two meanings:
//
//   jc_ops.machine_id  — where the REMAINING qty runs   (forward-looking)
//   op_log.machine_id  — who made THESE pieces          (historical)
//
// Every row type that shows a machine beside a completed qty carries this
// array, so the two meanings can be told apart on screen. Sourced from the view
// `public.v_op_machine_output` via this canonical correlated LATERAL — copy it
// verbatim rather than reinventing the aggregate:
//
//   LEFT JOIN LATERAL (
//     SELECT json_agg(
//              json_build_object('machineCode', v.machine_code, 'qty', v.completed_qty)
//              ORDER BY v.completed_qty DESC, v.machine_code
//            ) AS machines
//     FROM public.v_op_machine_output v
//     WHERE v.jc_op_id = <the op alias>.id
//   ) mo ON true
//
// Render rule (see MachineChip / MachineSplitLines in
// apps/web/src/components/shared/machine-split.tsx):
//   length <= 1 → render exactly as before. This is the normal case.
//   length  > 1 → mark the machine cell and break the qty out per machine.

import { z } from 'zod';

export const machineSplitEntrySchema = z.object({
  machineCode: z.string(),
  qty: z.number().int().nonnegative(),
});
export type MachineSplitEntry = z.infer<typeof machineSplitEntrySchema>;

/** Busiest machine first. Empty when nothing is logged yet; ONE entry for the
 *  ordinary never-re-routed op; more than one only after a machine change.
 *  Σ qty <= the op's completed qty — never more. The gap is OSP-accepted qty,
 *  which was made by a vendor and belongs to no machine. */
export const machineSplitSchema = z.array(machineSplitEntrySchema).default([]);
export type MachineSplit = z.infer<typeof machineSplitSchema>;
