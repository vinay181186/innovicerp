// NC disposition cascades (T-040b).
//
// Five disposition paths from legacy `_disposeNC` (legacy line 22618). All
// run in the same DB tx as the NC update — rollback unwinds cleanly. Mirror
// the GRN cascade module's shape (apps/api/src/modules/goods-receipt-notes/
// cascades.ts) for consistency.
//
//   rework            → status=disposed; jc_ops.rework_qty += rejected_qty
//                        for the picked rework op; rework_op_seq stored on NC.
//   scrap             → status=closed; scrap_cost stored on NC.
//   use_as_is         → status=closed; append op_log row with type='qc',
//                        qty=rejected_qty, operator resolved by name lookup,
//                        remarks = 'Use As Is — from <ncCode> (...)'.
//   return_to_vendor  → status=closed; no other cascade.
//   make_fresh        → status=closed; create supplementary JC inheriting
//                        origin's source SO/JW link + parent_nc_id pointing
//                        at this NC; rework_jc_code_text stored on NC.
//
// Rework qty interaction with planned-vs-actual is deliberately PASSIVE
// (audit column only) per T-040b decision #4 — op-entry calc is not
// re-routed through rework_qty until shop-floor reports an actual issue.

import { and, eq, isNull, like, or, sql } from 'drizzle-orm';
import { items, jcOps, jobCards, ncRegister, opLog, operators } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

const DISPOSITION_DATE_NOT_NULL_ACTIONS = new Set([
  'rework',
  'scrap',
  'use_as_is',
  'return_to_vendor',
  'make_fresh',
] as const);

type DispositionAction = 'rework' | 'scrap' | 'use_as_is' | 'return_to_vendor' | 'make_fresh';

export interface DisposeNcInput {
  action: DispositionAction;
  remarks?: string | undefined;
  // Rework-only
  reworkOpSeq?: number | undefined;
  // Scrap-only
  scrapCost?: number | undefined;
}

export interface DisposeNcContext {
  companyId: string;
  userId: string;
  userName: string; // for op_log.operator_name + nc.disposition_by_text fallback
}

export interface DisposeNcResult {
  ncId: string;
  status: 'disposed' | 'closed';
  reworkOpId?: string;
  reworkOpSeqApplied?: number;
  newJcCode?: string;
  newJcId?: string;
  opLogId?: string;
}

/**
 * Atomically apply a disposition to an NC + run its cascades.
 *
 * Caller wraps this in `withUserContext` so the transaction picks up
 * `current_user_role()`/`current_company_id()` for RLS. The NC row is
 * re-read inside the same tx to confirm status='pending' (defends against
 * concurrent dispose attempts).
 */
export async function disposeNcCascade(
  tx: DbTransaction,
  ncId: string,
  input: DisposeNcInput,
  ctx: DisposeNcContext,
): Promise<DisposeNcResult> {
  // Re-read NC inside this tx — defends against concurrent dispose.
  const ncRows = await tx
    .select()
    .from(ncRegister)
    .where(
      and(
        eq(ncRegister.id, ncId),
        eq(ncRegister.companyId, ctx.companyId),
        isNull(ncRegister.deletedAt),
      ),
    )
    .limit(1);
  const nc = ncRows[0];
  if (!nc) {
    throw new ValidationError(`NC ${ncId} not found`);
  }
  if (nc.status !== 'pending') {
    throw new ConflictError(`NC ${nc.code} is already ${nc.status} — cannot re-dispose`);
  }

  if (!DISPOSITION_DATE_NOT_NULL_ACTIONS.has(input.action)) {
    // type-system also rejects this path, but keep an explicit guard.
    throw new ValidationError(`Unknown disposition action: ${String(input.action)}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const result: DisposeNcResult = { ncId, status: 'disposed' };

  if (input.action === 'rework') {
    const reworkOpSeq = input.reworkOpSeq ?? nc.opSeq;
    if (reworkOpSeq == null) {
      throw new ValidationError(
        'Rework disposition requires reworkOpSeq (or NC must have opSeq set)',
      );
    }
    const reworkOpRows = await tx
      .select({ id: jcOps.id, opSeq: jcOps.opSeq, reworkQty: jcOps.reworkQty })
      .from(jcOps)
      .where(
        and(
          eq(jcOps.jobCardId, nc.jobCardId),
          eq(jcOps.opSeq, reworkOpSeq),
          eq(jcOps.companyId, ctx.companyId),
          isNull(jcOps.deletedAt),
        ),
      )
      .limit(1);
    const reworkOp = reworkOpRows[0];
    if (!reworkOp) {
      throw new ValidationError(`Rework op_seq ${reworkOpSeq} not found on JC ${nc.jobCardId}`);
    }
    const rejectedQtyInt = Math.round(Number(nc.rejectedQty));
    await tx
      .update(jcOps)
      .set({
        reworkQty: (reworkOp.reworkQty ?? 0) + rejectedQtyInt,
        updatedBy: ctx.userId,
      })
      .where(eq(jcOps.id, reworkOp.id));

    await tx
      .update(ncRegister)
      .set({
        status: 'disposed',
        disposition: 'rework',
        dispositionDate: today,
        dispositionByText: ctx.userName,
        dispositionRemarks: input.remarks ?? null,
        reworkOpSeq: reworkOpSeq,
        updatedBy: ctx.userId,
      })
      .where(eq(ncRegister.id, ncId));

    result.status = 'disposed';
    result.reworkOpId = reworkOp.id;
    result.reworkOpSeqApplied = reworkOpSeq;
    return result;
  }

  if (input.action === 'scrap') {
    const scrapCost = Math.max(0, input.scrapCost ?? 0);
    await tx
      .update(ncRegister)
      .set({
        status: 'closed',
        disposition: 'scrap',
        dispositionDate: today,
        dispositionByText: ctx.userName,
        dispositionRemarks: input.remarks ?? null,
        scrapCost: scrapCost.toFixed(2),
        updatedBy: ctx.userId,
      })
      .where(eq(ncRegister.id, ncId));
    result.status = 'closed';
    return result;
  }

  if (input.action === 'use_as_is') {
    if (nc.opSeq == null) {
      throw new ValidationError(
        'Use-As-Is disposition requires the NC to have op_seq + jc_op_id set',
      );
    }
    if (nc.jcOpId == null) {
      throw new ValidationError(
        'Use-As-Is disposition requires the NC to have a resolved jc_op_id',
      );
    }

    // Operator resolution: byName lookup against operators master. Falls
    // back to NULL operator_id with a remarks note if no match — preserves
    // the audit trail per T-040b decision #5.
    const opRows = await tx
      .select({ id: operators.id })
      .from(operators)
      .where(
        and(
          eq(operators.companyId, ctx.companyId),
          isNull(operators.deletedAt),
          // Case-insensitive name match
          sql`lower(${operators.name}) = lower(${ctx.userName})`,
        ),
      )
      .limit(1);
    const operatorId = opRows[0]?.id ?? null;

    const rejectedQtyInt = Math.round(Number(nc.rejectedQty));
    const baseRemarks = `Use As Is — from ${nc.code} (${rejectedQtyInt} pcs accepted with concession)`;
    const opLogRemarks = operatorId
      ? baseRemarks
      : `${baseRemarks} — disposition_by=${ctx.userName} (operator FK unresolved)`;

    // Generate a deterministic-ish log_no in line with the legacy "LOG-NNN"
    // pattern. Log_no isn't unique in the schema (per T-024c notes), so we
    // can use a synthetic prefix tied to the NC code.
    const logNo = `LOG-NC-${nc.code}`;

    const inserted = await tx
      .insert(opLog)
      .values({
        companyId: ctx.companyId,
        jcOpId: nc.jcOpId,
        logNo,
        logType: 'qc',
        logDate: today,
        shift: 'day',
        qty: rejectedQtyInt,
        rejectQty: 0,
        operatorId,
        operatorName: ctx.userName,
        remarks: opLogRemarks,
        createdBy: ctx.userId,
      })
      .returning({ id: opLog.id });

    await tx
      .update(ncRegister)
      .set({
        status: 'closed',
        disposition: 'use_as_is',
        dispositionDate: today,
        dispositionByText: ctx.userName,
        dispositionRemarks: input.remarks ?? null,
        updatedBy: ctx.userId,
      })
      .where(eq(ncRegister.id, ncId));

    result.status = 'closed';
    const insertedId = inserted[0]?.id;
    if (insertedId) result.opLogId = insertedId;
    return result;
  }

  if (input.action === 'return_to_vendor') {
    await tx
      .update(ncRegister)
      .set({
        status: 'closed',
        disposition: 'return_to_vendor',
        dispositionDate: today,
        dispositionByText: ctx.userName,
        dispositionRemarks: input.remarks ?? null,
        updatedBy: ctx.userId,
      })
      .where(eq(ncRegister.id, ncId));
    result.status = 'closed';
    return result;
  }

  // make_fresh
  const originRows = await tx
    .select()
    .from(jobCards)
    .where(
      and(
        eq(jobCards.id, nc.jobCardId),
        eq(jobCards.companyId, ctx.companyId),
        isNull(jobCards.deletedAt),
      ),
    )
    .limit(1);
  const origin = originRows[0];
  if (!origin) {
    throw new ValidationError(`Origin JC ${nc.jobCardId} not found`);
  }

  const newJcCode = await nextSupplementaryJcCode(tx, ctx.companyId, origin.code);
  const rejectedQtyInt = Math.round(Number(nc.rejectedQty));

  // job_cards has no itemCodeText / remarks columns — the supplementary
  // traceability is captured via parent_nc_id + the legacy ref string.
  const insertedJc = await tx
    .insert(jobCards)
    .values({
      companyId: ctx.companyId,
      code: newJcCode,
      jcDate: today,
      itemId: origin.itemId,
      orderQty: rejectedQtyInt,
      priority: origin.priority,
      dueDate: origin.dueDate,
      drawingFilePath: origin.drawingFilePath,
      // Inherit source link so T-033 close cascade still works on the supp.
      sourceSoLineId: origin.sourceSoLineId,
      sourceJwLineId: origin.sourceJwLineId,
      sourceLegacyRef: `supp-of:${nc.code}`,
      parentNcId: ncId,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: jobCards.id, code: jobCards.code });

  const newJc = insertedJc[0];
  if (!newJc) {
    throw new ValidationError('Failed to create supplementary JC');
  }

  await tx
    .update(ncRegister)
    .set({
      status: 'closed',
      disposition: 'make_fresh',
      dispositionDate: today,
      dispositionByText: ctx.userName,
      dispositionRemarks: input.remarks ?? null,
      reworkJcCodeText: newJc.code,
      updatedBy: ctx.userId,
    })
    .where(eq(ncRegister.id, ncId));

  result.status = 'closed';
  result.newJcCode = newJc.code;
  result.newJcId = newJc.id;
  return result;
}

/**
 * Generate the next supplementary JC code. Pattern: `<originCode>-S<n>` where
 * `<n>` is 1-indexed. Mirrors the legacy "Supplementary for ..." remarks
 * convention but with a deterministic code so both supp JCs are queryable.
 */
async function nextSupplementaryJcCode(
  tx: DbTransaction,
  companyId: string,
  originCode: string,
): Promise<string> {
  const prefix = `${originCode}-S`;
  const existing = await tx
    .select({ code: jobCards.code })
    .from(jobCards)
    .where(
      and(
        eq(jobCards.companyId, companyId),
        like(jobCards.code, `${prefix}%`),
        isNull(jobCards.deletedAt),
      ),
    );
  let max = 0;
  for (const row of existing) {
    const tail = row.code.slice(prefix.length);
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/**
 * Close-rework action: flips a `disposed` NC (with disposition='rework') →
 * `closed`, optionally capturing the rework_done_qty. Mirrors legacy
 * `_closeNCRework` (line 22708).
 */
export async function closeNcReworkCascade(
  tx: DbTransaction,
  ncId: string,
  reworkDoneQty: number | undefined,
  ctx: DisposeNcContext,
): Promise<{ ncId: string; status: 'closed' }> {
  const ncRows = await tx
    .select()
    .from(ncRegister)
    .where(
      and(
        eq(ncRegister.id, ncId),
        eq(ncRegister.companyId, ctx.companyId),
        isNull(ncRegister.deletedAt),
      ),
    )
    .limit(1);
  const nc = ncRows[0];
  if (!nc) {
    throw new ValidationError(`NC ${ncId} not found`);
  }
  if (nc.disposition !== 'rework') {
    throw new ConflictError(
      `NC ${nc.code} is not on a rework path (disposition=${nc.disposition ?? 'null'})`,
    );
  }
  if (nc.status !== 'disposed' && nc.status !== 'rework_done') {
    throw new ConflictError(`NC ${nc.code} cannot be rework-closed (status=${nc.status})`);
  }

  const updates: Record<string, unknown> = {
    status: 'closed',
    updatedBy: ctx.userId,
  };
  if (reworkDoneQty != null && Number.isFinite(reworkDoneQty) && reworkDoneQty >= 0) {
    updates['reworkDoneQty'] = reworkDoneQty.toFixed(2);
  }

  await tx.update(ncRegister).set(updates).where(eq(ncRegister.id, ncId));
  return { ncId, status: 'closed' };
}

// ─── T-040e: auto-create NC from QC reject ───────────────────────────────
//
// Mirrors legacy `_autoCreateNC()` (HTML L3946 inside submitQcLog handler).
// Caller is op-entry/service.submitQcLog; this runs in the SAME tx so a
// rollback unwinds both the QC log and the auto-NC together.
//
// Generated NC code shape: `NC-AUTO-<jcCode>-Op<seq>-<HHMMSSmmm>` — embeds
// the source for human readability + millisecond suffix for uniqueness under
// bursty parallel submits without a counter query. Falls back to a random
// suffix if codes still collide (createNcRegister-equivalent uniqueness check
// is inline below).

export interface AutoCreateNcContext {
  companyId: string;
  jobCardId: string;
  jcOpId: string;
  jcCode: string;
  opSeq: number;
  operationText: string;
  rejectedQty: number; // > 0 (caller checks)
  ncDate: string; // YYYY-MM-DD (matches the QC log's date)
  reportedByText: string | null;
  remarks: string | null;
}

export interface AutoCreateNcResult {
  ncId: string;
  ncCode: string;
}

function generateAutoNcCode(jcCode: string, opSeq: number): string {
  const now = new Date();
  const stamp =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0') +
    String(now.getMilliseconds()).padStart(3, '0');
  // NC code regex permits letters/digits/./_/- (per createNcRegisterInputSchema).
  // Replace any character outside that set in jcCode to be safe.
  const safeJcCode = jcCode.replace(/[^A-Za-z0-9._-]/g, '_');
  return `NC-AUTO-${safeJcCode}-Op${opSeq}-${stamp}`;
}

export async function autoCreateNcFromQcReject(
  tx: DbTransaction,
  ctx: AutoCreateNcContext,
  user: AuthContext,
): Promise<AutoCreateNcResult> {
  if (ctx.rejectedQty <= 0) {
    throw new ValidationError('autoCreateNcFromQcReject called with rejectedQty <= 0');
  }

  // Look up itemId + itemCode from the JC. NC requires itemId NOT NULL +
  // snapshots itemCodeText for durable display.
  const jcRows = await tx
    .select({ itemId: jobCards.itemId })
    .from(jobCards)
    .where(and(eq(jobCards.id, ctx.jobCardId), eq(jobCards.companyId, ctx.companyId)))
    .limit(1);
  const jc = jcRows[0];
  if (!jc) throw new NotFoundError(`JC ${ctx.jobCardId} not found for auto-NC`);

  const itemRows = await tx
    .select({ code: items.code })
    .from(items)
    .where(
      and(eq(items.id, jc.itemId), eq(items.companyId, ctx.companyId), isNull(items.deletedAt)),
    )
    .limit(1);
  const itemCode = itemRows[0]?.code ?? '';

  // Generate code with retry on collision (vanishingly unlikely with ms
  // resolution but cheap to be defensive).
  let code = generateAutoNcCode(ctx.jcCode, ctx.opSeq);
  for (let attempt = 0; attempt < 3; attempt++) {
    const dup = await tx
      .select({ id: ncRegister.id })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.companyId, ctx.companyId),
          eq(ncRegister.code, code),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length === 0) break;
    // Append a random 3-digit nonce for the next attempt.
    const nonce = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    code = `${generateAutoNcCode(ctx.jcCode, ctx.opSeq)}-${nonce}`;
  }

  const reason =
    ctx.remarks && ctx.remarks.length > 0
      ? `Auto-created from QC inspection: ${ctx.remarks}`
      : `Auto-created from QC inspection on ${ctx.jcCode} Op #${ctx.opSeq}`;

  const inserted = await tx
    .insert(ncRegister)
    .values({
      companyId: ctx.companyId,
      code,
      ncDate: ctx.ncDate,
      jobCardId: ctx.jobCardId,
      jcOpId: ctx.jcOpId,
      opSeq: ctx.opSeq,
      operationText: ctx.operationText,
      qcOperationText: ctx.operationText,
      itemId: jc.itemId,
      itemCodeText: itemCode,
      itemNameText: null,
      soCodeText: null,
      machineCodeText: null,
      rejectedQty: ctx.rejectedQty.toFixed(2),
      reasonCategory: 'other',
      reason,
      status: 'pending',
      reportedByText: ctx.reportedByText,
      timeLogged: new Date(),
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  const row = inserted[0]!;

  // Emit CREATE NonConformance audit row inline — matches the format used by
  // the public createNcRegister service so audit-log filters look uniform.
  await emitActivityLog(
    tx,
    {
      action: 'CREATE',
      entity: 'NonConformance',
      detail: `${row.code} — ${itemCode || '—'} qty=${row.rejectedQty} (auto from QC reject)`,
      refId: row.code,
    },
    ctx.companyId,
    user,
  );

  return { ncId: row.id, ncCode: row.code };
}

// Silence unused-import false positives — `or` is reserved for future
// queries, kept here to match the GRN cascade module's import pattern.
void or;
