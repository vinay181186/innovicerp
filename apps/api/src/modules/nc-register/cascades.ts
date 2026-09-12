// NC disposition cascades (T-040b, reshaped 2026-09-12 for the QC–NC handling
// procedure — docs/QC-NC-HANDLING-DESIGN.md §1–§4).
//
// Six disposition paths. All run in the same DB tx as the NC update — a
// rollback unwinds cleanly. Mirror the GRN cascade module's shape
// (apps/api/src/modules/goods-receipt-notes/cascades.ts) for consistency.
//
//   rework            → status=under_rework; a CHILD rework job card is raised
//                        for the pieces (recovery.ts createRecoveryJobCard).
//                        rework_op_seq is NEVER set on a new disposition: the
//                        in-route rework it drove is the legacy path, kept
//                        alive only for rows that already carry it.
//   repair            → status=under_repair; same mechanics, `-RP<n>` code.
//   scrap             → status=closed; scrap_cost stored on NC. Needs the
//                        `approve` tier on NC Register (§3: "close only after
//                        required authorization").
//   use_as_is         → status=closed; append op_log row with type='qc',
//                        qty=rejected_qty, operator resolved by name lookup,
//                        remarks = 'Use As Is — from <ncCode> (...)'.
//   return_to_vendor  → status=DISPOSED (not closed — ADR-117 / migration 0093).
//                        While it stays open, v_jc_op_status + v_osp_wip count
//                        its rejected_qty as at_vendor and take it out of the
//                        source op's pending, so the vendor visibly owes a
//                        replacement and the op cannot read `complete`. The
//                        challan is a separate action (service.createNcDc).
//   make_fresh        → status=closed; create supplementary JC inheriting
//                        origin's source SO/JW link + parent_nc_id pointing
//                        at this NC; rework_jc_code_text stored on NC.
//
// Partial disposition (interlock 2): `qty` below the NC's rejected qty shrinks
// THIS row to `qty` and inserts a sibling holding the remainder, still
// pending, linked back through split_from_nc_id. Every NC row is therefore
// exactly one disposition — there is no child table to reconcile.

import { and, eq, isNull, like, sql } from 'drizzle-orm';
import { items, jobCards, ncRegister, opLog, operators } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { createRecoveryJobCard, ncOpenQty } from './recovery';
import type { DisposeNcInput } from './schema';

type NcRow = typeof ncRegister.$inferSelect;

export interface DisposeNcContext {
  companyId: string;
  userId: string;
  userName: string; // for op_log.operator_name + nc.disposition_by_text fallback
  user: AuthContext; // for the activity-log rows and the approve-tier gate
}

/** What the cascade did, for the service to phrase its audit rows and build
 *  the API result. Distinct from the shared `DisposeNcResult`, which is the
 *  wire shape. */
export interface DisposeNcCascadeResult {
  ncId: string;
  status: NcRow['status'];
  /** The qty this disposition covered (after any split). */
  qty: number;
  /** The sibling holding the undispositioned remainder, when qty < rejected. */
  remainderNcId?: string;
  remainderNcCode?: string;
  /** The rework / repair child job card. */
  childJcId?: string;
  childJcCode?: string;
  /** make_fresh supplementary JC. */
  newJcCode?: string;
  newJcId?: string;
  /** use_as_is op_log row. */
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
): Promise<DisposeNcCascadeResult> {
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
  const loaded = ncRows[0];
  if (!loaded) {
    throw new ValidationError(`NC ${ncId} not found`);
  }
  if (loaded.status !== 'pending') {
    throw new ConflictError(`NC ${loaded.code} is already ${loaded.status} — cannot re-dispose`);
  }

  // Interlock 2: never disposition more than the NC still owes.
  const open = ncOpenQty(loaded);
  const qty = input.qty ?? open;
  if (qty > open) {
    throw new ValidationError(`Disposition qty ${qty} exceeds the open NC qty ${open}`);
  }
  if (qty <= 0) {
    throw new ValidationError(
      `Disposition qty must be at least 1 (NC ${loaded.code} has ${open} open)`,
    );
  }

  // Scrap is the one disposition that closes the NC with the pieces written
  // off, so it carries the approve tier — checked before anything is written,
  // including the split below.
  if (input.action === 'scrap') {
    await requireFormAccess(ctx.user, 'nc_dispose', 'approve');
  }

  const today = new Date().toISOString().slice(0, 10);
  const result: DisposeNcCascadeResult = { ncId, status: 'disposed', qty };

  // Partial disposition: this row keeps `qty`, the sibling takes the rest.
  let nc: NcRow = loaded;
  const rejectedBefore = Math.round(Number(loaded.rejectedQty));
  if (qty < rejectedBefore) {
    const remainder = rejectedBefore - qty;
    const siblingCode = await nextSplitNcCode(tx, ctx.companyId, loaded);
    const sibling = await tx
      .insert(ncRegister)
      .values({
        companyId: loaded.companyId,
        code: siblingCode,
        ncDate: loaded.ncDate,
        jobCardId: loaded.jobCardId,
        jcOpId: loaded.jcOpId,
        opSeq: loaded.opSeq,
        operationText: loaded.operationText,
        qcOperationText: loaded.qcOperationText,
        itemId: loaded.itemId,
        itemCodeText: loaded.itemCodeText,
        itemNameText: loaded.itemNameText,
        soCodeText: loaded.soCodeText,
        machineCodeText: loaded.machineCodeText,
        operatorText: loaded.operatorText,
        rejectedQty: remainder.toFixed(2),
        reasonCategory: loaded.reasonCategory,
        reason: loaded.reason,
        status: 'pending',
        reportedByText: loaded.reportedByText,
        timeLogged: loaded.timeLogged,
        qcLogId: loaded.qcLogId,
        grnLineId: loaded.grnLineId,
        splitFromNcId: loaded.id,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: ncRegister.id, code: ncRegister.code });
    const sib = sibling[0];
    if (!sib) throw new ValidationError('Failed to split the NC');
    await tx
      .update(ncRegister)
      .set({ rejectedQty: qty.toFixed(2), updatedBy: ctx.userId })
      .where(eq(ncRegister.id, ncId));
    nc = { ...loaded, rejectedQty: qty.toFixed(2) };
    result.remainderNcId = sib.id;
    result.remainderNcCode = sib.code;
    await emitActivityLog(
      tx,
      {
        action: 'NC_SPLIT',
        entity: 'NonConformance',
        detail:
          `${loaded.code} — ${qty} of ${rejectedBefore} pcs dispositioned; ` +
          `${remainder} pcs remain pending as ${sib.code}`,
        refId: loaded.code,
      },
      ctx.companyId,
      ctx.user,
    );
  }

  const rejectedQtyInt = Math.round(Number(nc.rejectedQty));

  if (input.action === 'rework' || input.action === 'repair') {
    // `reworkOpSeq` in the input is the legacy in-route field; a new rework
    // raises a child card instead, so it is deliberately ignored here.
    const child = await createRecoveryJobCard(tx, nc, input.action, qty, ctx.user);
    const status = input.action === 'rework' ? 'under_rework' : 'under_repair';
    await tx
      .update(ncRegister)
      .set({
        status,
        disposition: input.action,
        dispositionDate: today,
        dispositionByText: ctx.userName,
        dispositionRemarks: input.remarks ?? null,
        childJobCardId: child.id,
        reworkJcCodeText: child.code,
        updatedBy: ctx.userId,
      })
      .where(eq(ncRegister.id, ncId));
    result.status = status;
    result.childJcId = child.id;
    result.childJcCode = child.code;
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
        closedAt: new Date(),
        closedBy: ctx.userId,
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
        closedAt: new Date(),
        closedBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .where(eq(ncRegister.id, ncId));

    result.status = 'closed';
    const insertedId = inserted[0]?.id;
    if (insertedId) result.opLogId = insertedId;
    return result;
  }

  if (input.action === 'return_to_vendor') {
    // ADR-117 / migration 0093 — the piece goes back on the VENDOR's account.
    // Left at `disposed`, NOT closed: while this NC is open, v_jc_op_status and
    // v_osp_wip count its rejected_qty as at_vendor and take it out of the op's
    // pending, so the vendor visibly owes a replacement. Closing it here (what
    // this branch used to do) made the piece vanish — it was not in stock, not
    // at the vendor, and the op it came from owed a qty nothing could ever
    // satisfy, so the JC and its SO line could never close.
    //
    // The challan itself is raised by service.createNcDc (design §5); the PO
    // received-qty adjustment of §12.2 happens there, at DC time, not here.
    await tx
      .update(ncRegister)
      .set({
        status: 'disposed',
        disposition: 'return_to_vendor',
        dispositionDate: today,
        dispositionByText: ctx.userName,
        dispositionRemarks: input.remarks ?? null,
        updatedBy: ctx.userId,
      })
      .where(eq(ncRegister.id, ncId));
    result.status = 'disposed';
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
      // Raw material (0106): the replacement is the SAME part as the JC it
      // replaces, so it is cut from the same stock — straight inheritance, id
      // and text both taken from the origin JC's own row. Not re-read from the
      // master, so a supplementary raised after a grade rename still records
      // what the original JC was raised with.
      rawMaterialGradeId: origin.rawMaterialGradeId,
      rawMaterialGradeText: origin.rawMaterialGradeText,
      rawMaterialSizeId: origin.rawMaterialSizeId,
      rawMaterialSizeText: origin.rawMaterialSizeText,
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
      closedAt: new Date(),
      closedBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .where(eq(ncRegister.id, ncId));

  result.status = 'closed';
  result.newJcCode = newJc.code;
  result.newJcId = newJc.id;
  return result;
}

/**
 * Code for the remainder row of a partial disposition: `<code>/2`, then `/3`…
 * until nothing live carries it. When the row being split is itself a
 * remainder (it has split_from_nc_id) its own `/n` tail is stripped first, so
 * a second split of NC-1 reads NC-1/3 rather than NC-1/2/2. A code that
 * merely contains a slash is left alone — only a known split tail is removed.
 */
async function nextSplitNcCode(tx: DbTransaction, companyId: string, nc: NcRow): Promise<string> {
  const base = nc.splitFromNcId ? nc.code.replace(/\/\d+$/, '') : nc.code;
  for (let i = 2; ; i++) {
    const candidate = `${base}/${i}`;
    const dup = await tx
      .select({ id: ncRegister.id })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.companyId, companyId),
          eq(ncRegister.code, candidate),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length === 0) return candidate;
  }
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
  /** The op_log inspection row that rejected the pieces (design §3). Null on
   *  an Incoming-QC reject, which has no op_log row. */
  qcLogId?: string | null;
  /** The GRN line an Incoming-QC reject was raised from. Null on an op QC. */
  grnLineId?: string | null;
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
      qcLogId: ctx.qcLogId ?? null,
      grnLineId: ctx.grnLineId ?? null,
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
