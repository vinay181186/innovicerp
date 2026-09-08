// An outsourced job-card operation and the purchase order lines that cover it
// (migration 0118, ADR-152 phase 4).
//
// `jc_ops.outsource_po_line_id` holds ONE line, and it is the join key for the
// whole outsource chain — the outward-DC quantity guard, the receive-back
// cascade and the job card's OSP view all match on it. Once a purchase request
// may be covered by several purchase orders, an outsourced op can be asked to
// follow more than one, and a single column cannot: the second PO's challan and
// receipt never cascade back, so the material sits at the vendor and the
// operation stays at `sent` forever with no error anywhere.
//
// `jc_op_po_lines` is one row per (op, PO line) with the quantity that link
// carries. The op's outsourced quantity is the SUM of its live links.
//
// The old column is deliberately still written — with the FIRST link only — so
// every caller that has not moved across keeps working (calc-engine, the JC edit
// form's "committed" test, the purchase-request picker's `is null` filter).

import { and, eq, isNull } from 'drizzle-orm';
import { jcOpPoLines, jcOps } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';

export interface LinkJcOpToPoLineArgs {
  companyId: string;
  jcOpId: string;
  purchaseOrderLineId: string;
  /** How much of the operation this PO line covers — the PO line's own qty. */
  qty: number;
  /** Who is writing (the acting user; the audit columns are NOT NULL). */
  userId: string;
}

/**
 * Record that `purchaseOrderLineId` covers `qty` pieces of `jcOpId`, and — only
 * when the op has no PO line yet — stamp that FIRST link onto the legacy
 * `jc_ops.outsource_po_line_id` column and advance the op to `po_created`.
 *
 * Runs inside the caller's transaction so the link cannot outlive a PO write
 * that later rolls back. Idempotent: a live link for the same (op, line) is
 * left alone rather than duplicated, matching the partial unique index.
 *
 * The op-status flip is guarded the same way as the link stamp, so a SECOND
 * purchase order raised against an op that is already `sent` to the vendor does
 * not drag it backwards to `po_created`.
 */
export async function linkJcOpToPoLine(
  tx: DbTransaction,
  args: LinkJcOpToPoLineArgs,
): Promise<void> {
  const { companyId, jcOpId, purchaseOrderLineId, qty, userId } = args;
  // qty is the PO line quantity, and the table's CHECK refuses 0 or less. A
  // zero-quantity line cannot exist (purchase_order_lines_qty_positive), so
  // clamping here would hide a bug rather than fix one — but the link is not
  // worth failing a PO over either, so nothing to record means nothing written.
  if (qty <= 0) return;

  const existing = await tx
    .select({ id: jcOpPoLines.id })
    .from(jcOpPoLines)
    .where(
      and(
        eq(jcOpPoLines.jcOpId, jcOpId),
        eq(jcOpPoLines.purchaseOrderLineId, purchaseOrderLineId),
        eq(jcOpPoLines.companyId, companyId),
        isNull(jcOpPoLines.deletedAt),
      ),
    )
    .limit(1);

  if (!existing[0]) {
    await tx.insert(jcOpPoLines).values({
      companyId,
      jcOpId,
      purchaseOrderLineId,
      qty,
      createdBy: userId,
      updatedBy: userId,
    });
  }

  await tx
    .update(jcOps)
    .set({
      outsourcePoLineId: purchaseOrderLineId,
      outsourceStatus: 'po_created',
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(and(eq(jcOps.id, jcOpId), isNull(jcOps.outsourcePoLineId)));
}
