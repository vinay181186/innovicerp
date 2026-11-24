// ADR-320 — purchase_order_lines.approved_qty: the qty last APPROVED.
// SO Status counts a PO line by this figure. Null = never approved.
//
// ONE writer (CLAUDE.md §20.1): stampPoApprovedQty is the only code that sets
// the column. It is called, inside the same transaction, wherever a PO ends a
// write in an approved status with its lines possibly changed:
//   approvePurchaseOrder · the three create paths when PO approval is OFF ·
//   updatePurchaseOrderTx when the PO is still approved after the save (so the
//   staged-edit apply, which saves through it, is covered too).
// An edit that sends the PO back to Draft does NOT stamp, so the last approved
// qty keeps counting while it waits for re-approval; a line added in that edit
// stays null until the PO is approved again.
//
// The PR → PO date check (§26.8) lives here too: one place for "this PO's date
// may not be before the PRs it is raised from".
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { purchaseOrderLines, purchaseRequests } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { assertNotBefore, latestDated } from '../../lib/doc-date-order';
import { fmtDate } from '../../lib/format-date';

/** The PO statuses that mean "approved" (ADR-320). */
export const PO_APPROVED_STATUSES = ['open', 'partial', 'qc_pending', 'closed'] as const;

export function isPoApprovedStatus(status: string | null | undefined): boolean {
  return (PO_APPROVED_STATUSES as readonly string[]).includes(status ?? '');
}

/** approved_qty = qty on every live line of the PO. Call inside the write's tx. */
export async function stampPoApprovedQty(
  tx: DbTransaction,
  companyId: string,
  poId: string,
): Promise<void> {
  await tx
    .update(purchaseOrderLines)
    .set({ approvedQty: purchaseOrderLines.qty })
    .where(
      and(
        eq(purchaseOrderLines.purchaseOrderId, poId),
        eq(purchaseOrderLines.companyId, companyId),
        isNull(purchaseOrderLines.deletedAt),
      ),
    );
}

/** Refuses a PO dated before the LATEST of the PRs given (already-loaded rows). */
export function assertPoDateNotBeforePrRows(
  poDate: string,
  prs: ReadonlyArray<{ code: string; prDate: string | null }>,
): void {
  const latest = latestDated(prs.map((p) => ({ code: p.code, date: p.prDate })));
  if (!latest) return;
  assertNotBefore(
    poDate,
    latest.date,
    `PO date ${fmtDate(poDate)} cannot be before PR ${latest.code} date ${fmtDate(latest.date)}.`,
  );
}

/** Same check, reading the PRs by id (company-scoped, live rows only). */
export async function assertPoDateNotBeforePrs(
  tx: DbTransaction,
  companyId: string,
  poDate: string,
  prIds: readonly string[],
): Promise<void> {
  if (prIds.length === 0) return;
  const rows = await tx
    .select({ code: purchaseRequests.code, prDate: purchaseRequests.prDate })
    .from(purchaseRequests)
    .where(
      and(
        inArray(purchaseRequests.id, [...prIds]),
        eq(purchaseRequests.companyId, companyId),
        isNull(purchaseRequests.deletedAt),
      ),
    );
  assertPoDateNotBeforePrRows(poDate, rows);
}
