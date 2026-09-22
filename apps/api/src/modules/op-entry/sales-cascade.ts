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
import { emitActivityLog } from '../activity-log/service';

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
    | 'jw_line_already_terminal'
    | 'so_line_qty_incomplete'
    | 'so_equipment_closes_on_assembly'
    | 'jw_line_qty_incomplete';
}

const TERMINAL_STATUSES = new Set(['closed', 'cancelled']);

// Total finished output produced across ALL non-deleted Job Cards for a
// SO/JW line = SUM of each JC's FINAL-op effective output (QC-accepted for
// QC/qc-required final ops, Incoming-QC-accepted GRN qty for outsource final
// ops, else completed qty). Mirrors the dispatch-readiness calc so "line fully
// produced" and "line fully dispatchable" agree. Used to stop a small JC from
// closing a bigger order line (leftover balance would otherwise be stranded).
async function producedForLine(
  tx: DbTransaction,
  lineCol: 'source_so_line_id' | 'source_jw_line_id',
  lineId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(x.eff), 0)::int AS produced FROM (
      SELECT DISTINCT ON (jc.id)
        CASE
          WHEN vs.op_type = 'qc' OR vs.qc_required THEN vs.qc_accepted_qty
          WHEN vs.op_type = 'outsource' THEN COALESCE((
            SELECT SUM(grl.qc_accepted_qty)
            FROM public.goods_receipt_note_lines grl
            WHERE grl.purchase_order_line_id = jo.outsource_po_line_id
              AND grl.deleted_at IS NULL
          ), 0)
          ELSE vs.completed_qty
        END AS eff
      FROM public.job_cards jc
      JOIN public.v_jc_op_status vs ON vs.job_card_id = jc.id
      LEFT JOIN public.jc_ops jo
        ON jo.job_card_id = jc.id AND jo.op_seq = vs.op_seq AND jo.deleted_at IS NULL
      WHERE jc.${sql.raw(lineCol)} = ${lineId}::uuid AND jc.deleted_at IS NULL
        -- A rework/repair child inherits the parent's line link so its own
        -- closure cascade works, but its output is re-injected into the
        -- PARENT's route and counted there. Summing it here as well would
        -- close the sales line while the parent still had those pieces to
        -- finish (docs/QC-NC-HANDLING-DESIGN.md §4).
        AND jc.recovery_kind IS NULL
      ORDER BY jc.id, vs.op_seq DESC
    ) x
  `)) as unknown as Array<{ produced: number }>;
  return Number(rows[0]?.produced ?? 0);
}

/** If the JC is now `complete`, close its source SO/JW line + cascade to
 *  header. Caller must already be inside withUserContext. */
export async function tryCascadeJcComplete(
  tx: DbTransaction,
  jobCardId: string,
  user: AuthContext,
): Promise<CascadeResult> {
  // Step 1: only fire when the JC is fully complete per v_jc_status.
  // Accept BOTH 'complete' (closed_at IS NULL, just reached the bar) and
  // 'closed' (closed_at already set by a prior cascade run) — the second
  // state happens on idempotent re-runs after this function set closed_at
  // the first time around. Without accepting 'closed', re-runs would
  // short-circuit here instead of flowing through to the inner cascade,
  // breaking the existing idempotency contract (skipped: 'so_line_already_terminal').
  const statusRows = await tx.execute(sql`
    SELECT computed_status FROM public.v_jc_status WHERE job_card_id = ${jobCardId}::uuid
  `);
  const computedStatus =
    (statusRows as unknown as Array<{ computed_status: string }>)[0]?.computed_status ?? null;
  if (computedStatus !== 'complete' && computedStatus !== 'closed') {
    return { skipped: 'jc_not_complete' };
  }

  // Step 2: load the JC's source link (only one of source_so_line_id /
  // source_jw_line_id can be set per ADR-012 #4 CHECK num_nonnulls(...) <= 1).
  const jcRows = await tx
    .select({
      code: jobCards.code,
      sourceSoLineId: jobCards.sourceSoLineId,
      sourceJwLineId: jobCards.sourceJwLineId,
      recoveryKind: jobCards.recoveryKind,
    })
    .from(jobCards)
    .where(eq(jobCards.id, jobCardId))
    .limit(1);
  const jc = jcRows[0];
  if (!jc) return { skipped: 'jc_has_no_source_link' };

  // A rework/repair CHILD is finished the moment its own ops are all complete
  // (Step 1 above), whatever its order line says: its output is re-injected
  // into the parent's route and the line closes from the PARENT's numbers
  // (producedForLine excludes children). Without this, a child whose parent
  // still had ops to run after the origin op sat at `complete` with no
  // closed_at forever — the later close walks go UP from the parent, never
  // back down (QC-NC audit 2026-09-21, follow-up). The line cascade below
  // still runs for a child (it may be the call that closes the line); only
  // the "is this JC finished" rule differs.
  const isRecoveryChild = Boolean(jc.recoveryKind);

  if (!jc.sourceSoLineId && !jc.sourceJwLineId) {
    // A child of a source-less JC has no line to cascade but is still done.
    if (isRecoveryChild) await finishJc(tx, jobCardId, jc.code, user);
    return { skipped: 'jc_has_no_source_link' };
  }

  const result = jc.sourceSoLineId
    ? await cascadeSo(tx, jc.sourceSoLineId, jc.code, user)
    : await cascadeJw(tx, jc.sourceJwLineId!, jc.code, user);

  // "This job card is finished" and "this order line is finished" are separate
  // facts. The JC is finished (its ops are all complete per v_jc_status — that
  // is Step 1) whenever its line is TERMINAL after the cascade, whether this
  // call closed it or an earlier call already had. The second case is the
  // rework chain (QC-NC audit 2026-09-21, gaps 1+2): the child's terminal QC
  // re-injects the recovered pieces into the parent and the child's own
  // cascade closes the SO line first; the parent's cascade then found the
  // line already terminal and never set the parent's closed_at, so the parent
  // stayed `complete` forever with no JC_COMPLETE row. A line whose row is
  // gone is reported as terminal by cascadeSo/cascadeJw too, which is right —
  // nothing the JC can ever do would move it.
  //
  // ADR-132 — an equipment SO's line deliberately stays open until the units
  // are assembled, so its job cards would otherwise never reach `closed`
  // (v_jc_status reads closed_at); the JC still closes on its own ops.
  //
  // Still NOT finished: `so_line_qty_incomplete` / `jw_line_qty_incomplete` —
  // this JC is done but the order line still needs another JC's output.
  const jcFinished =
    isRecoveryChild ||
    Boolean(result.closedSoLineId || result.closedJwLineId) ||
    result.skipped === 'so_line_already_terminal' ||
    result.skipped === 'jw_line_already_terminal' ||
    result.skipped === 'so_equipment_closes_on_assembly';
  if (jcFinished) await finishJc(tx, jobCardId, jc.code, user);
  return result;
}

/** ISSUE-007 — set closed_at when the JC transitions complete → closed.
 *  Idempotent via the closedAt IS NULL guard so re-runs are no-ops, and the
 *  JC_COMPLETE audit row is written ONLY when this call is the one that
 *  flipped closed_at — so a re-run against an already-closed JC still emits
 *  nothing. Done in the SAME tx as the audit row so a rollback unwinds both.
 *  The caller's `skipped` reason is left untouched for the audit trail. */
async function finishJc(
  tx: DbTransaction,
  jobCardId: string,
  jcCode: string,
  user: AuthContext,
): Promise<void> {
  if (!user.companyId) return;
  const flipped = await tx
    .update(jobCards)
    .set({ closedAt: new Date(), updatedBy: user.id })
    .where(and(eq(jobCards.id, jobCardId), isNull(jobCards.closedAt)))
    .returning({ id: jobCards.id });

  if (flipped.length > 0) {
    await emitActivityLog(
      tx,
      {
        action: 'JC_COMPLETE',
        entity: 'JobCard',
        detail: `${jcCode} — All ops complete`,
        refId: jcCode,
      },
      user.companyId,
      user,
    );
  }
}

/**
 * Run tryCascadeJcComplete on a job card AND every ancestor above it —
 * child → parent → grandparent … following job_cards.parent_job_card_id until
 * it is null. Innermost first, so the JC that just logged settles its line
 * before its parent is checked.
 *
 * Why (QC-NC audit 2026-09-21, gap 2): a rework/repair child's terminal QC
 * (or a use_as_is / scrap disposition on one) re-injects pieces up the WHOLE
 * chain — climbRecoveryToAncestors in nc-register/recovery.ts writes the
 * re-inject op_log row on every ancestor's origin op directly, never through
 * submitQcLog — so ANY ancestor can be the one that just reached `complete`,
 * and nothing else will ever run its close check. Checking only the immediate
 * parent left a grandparent (P → P-RW1 → P-RW1-RW1) permanently `complete`
 * with no closed_at.
 *
 * Every level is the same idempotent cascade, so calling it on an ancestor
 * that is not complete, or is already closed, changes nothing. The 50-level
 * bound mirrors climbRecoveryToAncestors and only guards against a cyclic
 * parent link in hand-edited data.
 */
export async function cascadeJcCompleteUpChain(
  tx: DbTransaction,
  jobCardId: string,
  user: AuthContext,
): Promise<CascadeResult[]> {
  const results: CascadeResult[] = [];
  const seen = new Set<string>();
  let jcId: string | null = jobCardId;
  for (let guard = 0; jcId && guard < 50; guard++) {
    if (seen.has(jcId)) break;
    seen.add(jcId);
    results.push(await tryCascadeJcComplete(tx, jcId, user));
    const rows: Array<{ parentJobCardId: string | null }> = await tx
      .select({ parentJobCardId: jobCards.parentJobCardId })
      .from(jobCards)
      .where(and(eq(jobCards.id, jcId), isNull(jobCards.deletedAt)))
      .limit(1);
    jcId = rows[0]?.parentJobCardId ?? null;
  }
  return results;
}

async function cascadeSo(
  tx: DbTransaction,
  soLineId: string,
  jcCode: string,
  user: AuthContext,
): Promise<CascadeResult> {
  const lineRows = await tx
    .select({
      id: salesOrderLines.id,
      salesOrderId: salesOrderLines.salesOrderId,
      status: salesOrderLines.status,
      orderQty: salesOrderLines.orderQty,
    })
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.id, soLineId), isNull(salesOrderLines.deletedAt)))
    .limit(1);
  const line = lineRows[0];
  if (!line) return { skipped: 'so_line_already_terminal' };
  if (TERMINAL_STATUSES.has(line.status)) {
    return { skipped: 'so_line_already_terminal' };
  }

  // Resolve the SO header once — needed for the equipment check below and for
  // the emit refId/detail + header-close path further down.
  const soRows = await tx
    .select({ code: salesOrders.code, status: salesOrders.status, type: salesOrders.type })
    .from(salesOrders)
    .where(eq(salesOrders.id, line.salesOrderId))
    .limit(1);
  const soHeader = soRows[0];

  // ADR-132 — an EQUIPMENT SO line counts finished equipment, but the JCs
  // hanging off that line make BOM COMPONENTS. Comparing the two closed real
  // orders wrongly: IN-SO-00028 (5 equipment) was closed by IN-JC-26-00096
  // producing 49 levers, and vanished from the Assembly Tracker with 0 of 5
  // assembled. Equipment SOs close from the assembly side instead — see
  // syncEquipmentSoClosure in modules/assembly/service.ts. Component and
  // with-material SOs keep the produced-vs-ordered rule unchanged.
  if (soHeader?.type === 'equipment') {
    return { skipped: 'so_equipment_closes_on_assembly' };
  }

  // Only close when the WHOLE order-line qty is produced across its JCs — a
  // partial JC must not close a bigger line and strand the balance.
  const produced = await producedForLine(tx, 'source_so_line_id', soLineId);
  if (produced < Number(line.orderQty)) {
    return { skipped: 'so_line_qty_incomplete' };
  }

  // Close the line.
  await tx
    .update(salesOrderLines)
    .set({ status: 'closed', updatedBy: user.id })
    .where(eq(salesOrderLines.id, soLineId));

  if (soHeader && user.companyId) {
    await emitActivityLog(
      tx,
      {
        action: 'SO_LINE_CLOSED',
        entity: 'SalesOrder',
        detail: `${soHeader.code} — Line auto-closed (JC ${jcCode})`,
        refId: soHeader.code,
      },
      user.companyId,
      user,
    );
  }

  // Cascade to header: if every non-deleted, non-cancelled sibling line is
  // now closed, close the header. Cancelled lines don't block closure
  // (they're terminal too).
  const siblingRows = await tx
    .select({ id: salesOrderLines.id, status: salesOrderLines.status })
    .from(salesOrderLines)
    .where(
      and(eq(salesOrderLines.salesOrderId, line.salesOrderId), isNull(salesOrderLines.deletedAt)),
    );

  const allTerminal = siblingRows.every((s) => TERMINAL_STATUSES.has(s.status));
  const result: CascadeResult = { closedSoLineId: soLineId };
  if (!allTerminal) return result;

  if (!soHeader) return result;
  if (TERMINAL_STATUSES.has(soHeader.status)) return result;

  await tx
    .update(salesOrders)
    .set({ status: 'closed', updatedBy: user.id })
    .where(eq(salesOrders.id, line.salesOrderId));
  result.closedSoHeaderId = line.salesOrderId;

  if (user.companyId) {
    await emitActivityLog(
      tx,
      {
        action: 'SO_CLOSED',
        entity: 'SalesOrder',
        detail: `${soHeader.code} — All lines closed`,
        refId: soHeader.code,
      },
      user.companyId,
      user,
    );
  }
  return result;
}

async function cascadeJw(
  tx: DbTransaction,
  jwLineId: string,
  jcCode: string,
  user: AuthContext,
): Promise<CascadeResult> {
  const lineRows = await tx
    .select({
      id: jobWorkOrderLines.id,
      jobWorkOrderId: jobWorkOrderLines.jobWorkOrderId,
      status: jobWorkOrderLines.status,
      orderQty: jobWorkOrderLines.orderQty,
    })
    .from(jobWorkOrderLines)
    .where(and(eq(jobWorkOrderLines.id, jwLineId), isNull(jobWorkOrderLines.deletedAt)))
    .limit(1);
  const line = lineRows[0];
  if (!line) return { skipped: 'jw_line_already_terminal' };
  if (TERMINAL_STATUSES.has(line.status)) {
    return { skipped: 'jw_line_already_terminal' };
  }

  // Only close when the WHOLE order-line qty is produced across its JCs.
  const produced = await producedForLine(tx, 'source_jw_line_id', jwLineId);
  if (produced < Number(line.orderQty)) {
    return { skipped: 'jw_line_qty_incomplete' };
  }

  await tx
    .update(jobWorkOrderLines)
    .set({ status: 'closed', updatedBy: user.id })
    .where(eq(jobWorkOrderLines.id, jwLineId));

  const jwRows = await tx
    .select({ code: jobWorkOrders.code, status: jobWorkOrders.status })
    .from(jobWorkOrders)
    .where(eq(jobWorkOrders.id, line.jobWorkOrderId))
    .limit(1);
  const jwHeader = jwRows[0];

  if (jwHeader && user.companyId) {
    await emitActivityLog(
      tx,
      {
        action: 'JW_LINE_CLOSED',
        entity: 'JobWorkOrder',
        detail: `${jwHeader.code} — Line auto-closed (JC ${jcCode})`,
        refId: jwHeader.code,
      },
      user.companyId,
      user,
    );
  }

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

  if (!jwHeader) return result;
  if (TERMINAL_STATUSES.has(jwHeader.status)) return result;

  await tx
    .update(jobWorkOrders)
    .set({ status: 'closed', updatedBy: user.id })
    .where(eq(jobWorkOrders.id, line.jobWorkOrderId));
  result.closedJwHeaderId = line.jobWorkOrderId;

  if (user.companyId) {
    await emitActivityLog(
      tx,
      {
        action: 'JW_CLOSED',
        entity: 'JobWorkOrder',
        detail: `${jwHeader.code} — All lines closed`,
        refId: jwHeader.code,
      },
      user.companyId,
      user,
    );
  }
  return result;
}
