// Sales-chain auto-close cascade (T-033).
//
// When a JC reaches the `complete` computed_status (all ops done, all QC
// resolved per v_jc_status), close its source SO/JW line. If that close
// makes ALL lines of the parent SO/JW closed, close the header too.
//
// Called from `submitOpLog` after the existing post-insert availability
// check; runs in the same Drizzle transaction so a cascade failure rolls
// back the op_log insert.
//
// Fixes legacy bug: `_autoCloseSO()` (legacy line 1355-1369) only fires on
// the explicit Submit-Complete path, not on Stop+Complete or partial-then-
// final-Complete sequences. By keying off `v_jc_status.computed_status`
// (the same view that drives the UI), this implementation fires on EVERY
// completion path that brings the JC to the canonical `complete` state.
//
// Idempotent: SO/JW lines or headers already in `closed` (or `cancelled`)
// are not re-flipped — no `updated_at` thrash on re-runs.

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';

export interface CascadeResult {
  /** SO line id whose status was flipped from open → closed. */
  closedSoLineId?: string;
  /** SO header id closed because the last open line just closed. */
  closedSoHeaderId?: string;
  /** JW line id whose status was flipped from open → closed. */
  closedJwLineId?: string;
  /** JW header id closed because the last open line just closed. */
  closedJwHeaderId?: string;
  /** Reason the cascade did NOT fire (for logs / tests). Absent on success. */
  skipped?:
    | 'jc_not_complete'
    | 'jc_has_no_source_link'
    | 'so_line_already_terminal'
    | 'jw_line_already_terminal';
}

const TERMINAL_STATUSES = new Set(['closed', 'cancelled']);

/** If the JC is now `complete`, close its source SO/JW line + cascade to
 *  header. Caller must already be inside withUserContext. */
export async function tryCascadeJcComplete(
  tx: DbTransaction,
  jobCardId: string,
  user: AuthContext,
): Promise<CascadeResult> {
  // Step 1: only fire when the JC is fully complete per v_jc_status.
  const statusRows = await tx.execute(sql`
    SELECT computed_status FROM public.v_jc_status WHERE job_card_id = ${jobCardId}::uuid
  `);
  const computedStatus =
    (statusRows as unknown as Array<{ computed_status: string }>)[0]?.computed_status ?? null;
  if (computedStatus !== 'complete') {
    return { skipped: 'jc_not_complete' };
  }

  // Step 2: load the JC's source link (only one of source_so_line_id /
  // source_jw_line_id can be set per ADR-012 #4 CHECK num_nonnulls(...) <= 1).
  const jcRows = await tx
    .select({
      sourceSoLineId: jobCards.sourceSoLineId,
      sourceJwLineId: jobCards.sourceJwLineId,
    })
    .from(jobCards)
    .where(eq(jobCards.id, jobCardId))
    .limit(1);
  const jc = jcRows[0];
  if (!jc) return { skipped: 'jc_has_no_source_link' };
  if (!jc.sourceSoLineId && !jc.sourceJwLineId) {
    return { skipped: 'jc_has_no_source_link' };
  }

  if (jc.sourceSoLineId) {
    return cascadeSo(tx, jc.sourceSoLineId, user);
  }
  return cascadeJw(tx, jc.sourceJwLineId!, user);
}

async function cascadeSo(
  tx: DbTransaction,
  soLineId: string,
  user: AuthContext,
): Promise<CascadeResult> {
  const lineRows = await tx
    .select({
      id: salesOrderLines.id,
      salesOrderId: salesOrderLines.salesOrderId,
      status: salesOrderLines.status,
    })
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.id, soLineId), isNull(salesOrderLines.deletedAt)))
    .limit(1);
  const line = lineRows[0];
  if (!line) return { skipped: 'so_line_already_terminal' };
  if (TERMINAL_STATUSES.has(line.status)) {
    return { skipped: 'so_line_already_terminal' };
  }

  // Close the line.
  await tx
    .update(salesOrderLines)
    .set({ status: 'closed', updatedBy: user.id })
    .where(eq(salesOrderLines.id, soLineId));

  // Cascade to header: if every non-deleted, non-cancelled sibling line is
  // now closed, close the header. Cancelled lines don't block closure
  // (they're terminal too).
  const siblingRows = await tx
    .select({ id: salesOrderLines.id, status: salesOrderLines.status })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.salesOrderId, line.salesOrderId),
        isNull(salesOrderLines.deletedAt),
      ),
    );

  const allTerminal = siblingRows.every((s) => TERMINAL_STATUSES.has(s.status));
  const result: CascadeResult = { closedSoLineId: soLineId };
  if (!allTerminal) return result;

  const headerRows = await tx
    .select({ id: salesOrders.id, status: salesOrders.status })
    .from(salesOrders)
    .where(eq(salesOrders.id, line.salesOrderId))
    .limit(1);
  const header = headerRows[0];
  if (!header) return result;
  if (TERMINAL_STATUSES.has(header.status)) return result;

  await tx
    .update(salesOrders)
    .set({ status: 'closed', updatedBy: user.id })
    .where(eq(salesOrders.id, header.id));
  result.closedSoHeaderId = header.id;
  return result;
}

async function cascadeJw(
  tx: DbTransaction,
  jwLineId: string,
  user: AuthContext,
): Promise<CascadeResult> {
  const lineRows = await tx
    .select({
      id: jobWorkOrderLines.id,
      jobWorkOrderId: jobWorkOrderLines.jobWorkOrderId,
      status: jobWorkOrderLines.status,
    })
    .from(jobWorkOrderLines)
    .where(and(eq(jobWorkOrderLines.id, jwLineId), isNull(jobWorkOrderLines.deletedAt)))
    .limit(1);
  const line = lineRows[0];
  if (!line) return { skipped: 'jw_line_already_terminal' };
  if (TERMINAL_STATUSES.has(line.status)) {
    return { skipped: 'jw_line_already_terminal' };
  }

  await tx
    .update(jobWorkOrderLines)
    .set({ status: 'closed', updatedBy: user.id })
    .where(eq(jobWorkOrderLines.id, jwLineId));

  const siblingRows = await tx
    .select({ id: jobWorkOrderLines.id, status: jobWorkOrderLines.status })
    .from(jobWorkOrderLines)
    .where(
      and(
        eq(jobWorkOrderLines.jobWorkOrderId, line.jobWorkOrderId),
        isNull(jobWorkOrderLines.deletedAt),
      ),
    );

  const allTerminal = siblingRows.every((s) => TERMINAL_STATUSES.has(s.status));
  const result: CascadeResult = { closedJwLineId: jwLineId };
  if (!allTerminal) return result;

  const headerRows = await tx
    .select({ id: jobWorkOrders.id, status: jobWorkOrders.status })
    .from(jobWorkOrders)
    .where(eq(jobWorkOrders.id, line.jobWorkOrderId))
    .limit(1);
  const header = headerRows[0];
  if (!header) return result;
  if (TERMINAL_STATUSES.has(header.status)) return result;

  await tx
    .update(jobWorkOrders)
    .set({ status: 'closed', updatedBy: user.id })
    .where(eq(jobWorkOrders.id, header.id));
  result.closedJwHeaderId = header.id;
  return result;
}
