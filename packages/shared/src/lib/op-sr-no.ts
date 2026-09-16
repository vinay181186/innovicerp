// The operation number a person SEES: 10, 20, 30 … (user, 2026-09-16).
//
// The routing is STORED as 1, 2, 3 in `route_card_ops.op_seq` / `jc_ops.op_seq`
// and that does not change: v_jc_op_status finds the first op with
// `op_seq = 1`, the API finds the next op with `op_seq + 1`, and the NC
// register keeps "rework raised to ops" as the text "1, 3". Every one of those
// would have to move together, in both databases, for the stored number to
// become 10 -- so the number on paper is a DISPLAY rule instead, and this is
// the one place it lives.
//
// SHARED ON PURPOSE. The web screens, the prints, the Excel exports AND the
// API's own text (activity-log lines, alerts, error messages such as
// "Op 3 MIR on IN-JC-26-00001 is finished") must all say the same number for
// the same operation, or a supervisor reading "Op 30" on the job card and
// "Op 3" in the activity log would think they were two different steps.
//
// Only ever pass a stored sequence in; never feed the result back into a
// query or a comparison.

/** Stored sequence → the "Sr No" shown to people. `3` → `30`. */
export function opSrNo(opSeq: number): number {
  return opSeq * 10;
}

/** The same number as text, for labels and messages. `3` → `"30"`. */
export function fmtOpSrNo(opSeq: number): string {
  return String(opSrNo(opSeq));
}
