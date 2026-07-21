// Default terminal QC op (ADR-069, "Rule B").
//
// Finished-goods stock is credited only by a QC log against a JC's LAST op
// (op-entry/qc-stock-cascade.ts:tryApplyQcStockCascade). So a JC whose final op
// is a plain process/outsource step never credits stock — dispatching it then
// drives on-hand negative (the SPACER / IN-JC-26-00007 case: 3 process ops, no
// QC, dispatched 60 → −60).
//
// Fix: every JC must end with a QC op. When the caller's last op is not already
// QC, append a default DIR (Dimensional Inspection Report) QC stage. Applied at
// every jc_ops creation path (manual JW create/edit in job-cards, plan
// execution in plans) so it holds regardless of how the JC was born.

/** Default QC stage name appended as the terminal QC op. DIR = Dimensional
 *  Inspection Report — one of the shop's standard QC stages (MIR/MCR/DIR/TPI). */
export const DEFAULT_FINAL_QC_OP = 'DIR';

/** True when a default terminal QC op should be appended (Rule B, safe form).
 *
 *  Finished stock must be credited exactly ONCE per JC. The crediting events
 *  are: (a) qc_accept on a QC *last* op, and (b) grn_qc when an outsource op's
 *  work is received back. So a DIR QC is appended ONLY when neither already
 *  applies:
 *    - last op is `process` (not qc → would already gate; not outsource →
 *      credited on receive), AND
 *    - the JC has NO outsource op anywhere (in the no-BOM single-item model an
 *      outsource op already credits the same pieces via grn_qc — a terminal QC
 *      on top would DOUBLE-credit; this is exactly why SO-517 must be left
 *      alone while SPACER/IN-JC-26-00007 needs the gate).
 *  Empty routings have nothing to inspect and are left untouched. */
export function needsDefaultQcOp(ops: ReadonlyArray<{ opType: string }>): boolean {
  if (ops.length === 0) return false;
  if (ops[ops.length - 1]!.opType !== 'process') return false;
  if (ops.some((o) => o.opType === 'outsource')) return false;
  return true;
}
