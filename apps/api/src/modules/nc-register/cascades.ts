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
//   scrap             → status=closed; failed_qty = rejected_qty (ledger
//                        balances); scrap_cost stored on NC. Needs the
//                        `approve` tier on NC Register (§3: "close only after
//                        required authorization"). On a recovery child the
//                        failed qty climbs to every ancestor NC.
//   use_as_is         → status=closed; cleared_qty = rejected_qty; append
//                        op_log row with type='qc', qty=rejected_qty, operator
//                        resolved by name lookup, remarks = 'Use As Is — from
//                        <ncCode> (...)'. On the JC's LAST op the pieces are
//                        credited to finished stock once (same guards as a
//                        keyed QC log). On a recovery child (last op) the
//                        pieces climb to the ancestors like a child QC accept.
//                        Both then run the JC-close walk up the parent chain.
//   return_to_vendor  → status=DISPOSED (not closed — ADR-117 / migration 0093).
//                        While it stays open, v_jc_op_status + v_osp_wip count
//                        its rejected_qty as at_vendor and take it out of the
//                        source op's pending, so the vendor visibly owes a
//                        replacement and the op cannot read `complete`. The
//                        challan is a separate action (service.createNcDc).
//   make_fresh        → status=closed; failed_qty = rejected_qty (needs view
//                        migration 0138); create supplementary JC inheriting
//                        origin's source SO/JW link + parent_nc_id pointing
//                        at this NC; rework_jc_code_text stored on NC.
//                        ADR-184: refused on a Production Order's card (use
//                        Scrap); otherwise the new JC gets a copy of the
//                        origin card's live ops, progress zeroed.
//
// Partial disposition (interlock 2): `qty` below the NC's rejected qty shrinks
// THIS row to `qty` and inserts a sibling holding the remainder, still
// pending, linked back through split_from_nc_id. Every NC row is therefore
// exactly one disposition — there is no child table to reconcile.

import { opSrNo } from '@innovic/shared';
import { and, asc, desc, eq, isNull, like, sql } from 'drizzle-orm';
import {
  goodsReceiptNoteLines,
  goodsReceiptNotes,
  items,
  jcOps,
  jobCards,
  ncRegister,
  opLog,
  operators,
} from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { nextNcCodeFrom } from '../../lib/nc-code';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { jobCardOrderChainCte } from '../../lib/production-order-link';
import { emitActivityLog } from '../activity-log/service';
import { recoveryChildCreditsStock, tryApplyQcStockCascade } from '../op-entry/qc-stock-cascade';
import { reinjectLogType } from './reinject-log-type';
import { cascadeJcCompleteUpChain } from '../op-entry/sales-cascade';
import { climbRecoveryToAncestors, createRecoveryJobCard, ncOpenQty } from './recovery';
import type { DisposeNcInput } from './schema';

type NcRow = typeof ncRegister.$inferSelect;

// ─── NC material source (Tier A) ─────────────────────────────────────────────
//
// Where the rejected material CAME FROM, derived on read from the NC's own
// links — never a stored column. Two sources, GRN first:
//   (a) grn_line_id set (Incoming-QC reject) → the GRN header's vendor + codes.
//   (b) else the origin op (jc_op_id) is an outsource op → its outsource PO line
//       vendor + PO code.
// `isVendorSourced` is true whenever the material came from a vendor — a GRN
// line is set, OR the origin op is outsource — even when no vendor row resolves.
// It drives the return-vendor default (createNcDc, WI4) and the disposition
// guard (disposeNcCascade, WI5). A pure in-house reject resolves to all-null,
// isVendorSourced=false. The NC list reader mirrors this same logic inline as a
// LEFT JOIN LATERAL for pagination; keep the two in step.

export interface NcSource {
  sourceVendorId: string | null;
  sourceVendorCode: string | null;
  sourceVendorName: string | null;
  sourcePoCode: string | null;
  sourceGrnCode: string | null;
  isVendorSourced: boolean;
}

const EMPTY_NC_SOURCE: NcSource = {
  sourceVendorId: null,
  sourceVendorCode: null,
  sourceVendorName: null,
  sourcePoCode: null,
  sourceGrnCode: null,
  isVendorSourced: false,
};

export async function resolveNcSource(
  tx: DbTransaction,
  companyId: string,
  nc: { grnLineId: string | null; jcOpId: string | null },
): Promise<NcSource> {
  // (a) Incoming-QC reject: the GRN line names the vendor directly.
  if (nc.grnLineId) {
    const rows = (await tx.execute(sql`
      SELECT grn.vendor_id AS "vendorId", v.code AS "vendorCode", v.name AS "vendorName",
             grn.code AS "grnCode", grn.po_code_text AS "poCode"
      FROM public.goods_receipt_note_lines gl
      JOIN public.goods_receipt_notes grn
        ON grn.id = gl.goods_receipt_note_id AND grn.deleted_at IS NULL
      LEFT JOIN public.vendors v ON v.id = grn.vendor_id AND v.deleted_at IS NULL
      WHERE gl.id = ${nc.grnLineId}::uuid AND gl.company_id = ${companyId}::uuid
        AND gl.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    const r = rows[0];
    // A GRN line is always a vendor source, even if the GRN row was since deleted.
    return {
      sourceVendorId: (r?.['vendorId'] as string | null) ?? null,
      sourceVendorCode: (r?.['vendorCode'] as string | null) ?? null,
      sourceVendorName: (r?.['vendorName'] as string | null) ?? null,
      sourcePoCode: (r?.['poCode'] as string | null) ?? null,
      sourceGrnCode: (r?.['grnCode'] as string | null) ?? null,
      isVendorSourced: true,
    };
  }

  // (b) Origin op outsourced: its outsource PO line names the vendor.
  if (nc.jcOpId) {
    const rows = (await tx.execute(sql`
      SELECT po.vendor_id AS "vendorId", v.code AS "vendorCode", v.name AS "vendorName",
             po.code AS "poCode",
             (o.op_type = 'outsource') AS "isOutsource"
      FROM public.jc_ops o
      LEFT JOIN public.purchase_order_lines pol
        ON pol.source_jc_op_id = o.id AND pol.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.vendors v ON v.id = po.vendor_id AND v.deleted_at IS NULL
      WHERE o.id = ${nc.jcOpId}::uuid AND o.company_id = ${companyId}::uuid
      ORDER BY (po.id IS NOT NULL) DESC, pol.created_at DESC
      LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    const r = rows[0];
    if (r && Boolean(r['isOutsource'])) {
      return {
        sourceVendorId: (r['vendorId'] as string | null) ?? null,
        sourceVendorCode: (r['vendorCode'] as string | null) ?? null,
        sourceVendorName: (r['vendorName'] as string | null) ?? null,
        sourcePoCode: (r['poCode'] as string | null) ?? null,
        sourceGrnCode: null,
        isVendorSourced: true,
      };
    }
  }

  return { ...EMPTY_NC_SOURCE };
}

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

  // WI5: match the disposition to where the material CAME FROM. Vendor-sourced
  // material — an Incoming-QC reject on a GRN line, or a reject at an outsource
  // op — goes BACK to the vendor and is not reworked in-house; an in-house
  // reject has no vendor to return to. scrap / use_as_is / make_fresh apply to
  // either source and stay unrestricted.
  //
  // CREATE-TIME only: this checks the disposition being applied now. It does not
  // retroactively re-classify NC rows dispositioned before this guard existed
  // (e.g. the existing prod NC-…-00006-Op8), whose disposition columns are left
  // exactly as they were.
  if (
    input.action === 'return_to_vendor' ||
    input.action === 'rework' ||
    input.action === 'repair'
  ) {
    const source = await resolveNcSource(tx, ctx.companyId, {
      grnLineId: loaded.grnLineId,
      jcOpId: loaded.jcOpId,
    });
    if (input.action === 'return_to_vendor' && !source.isVendorSourced) {
      throw new ConflictError(
        'This NC has no vendor source; in-house rejected material is reworked or scrapped, not returned to a vendor.',
      );
    }
    if ((input.action === 'rework' || input.action === 'repair') && source.isVendorSourced) {
      throw new ConflictError(
        "This NC's material came from a vendor; return it to the vendor rather than reworking it in-house.",
      );
    }
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
        // G8: the split half carries the same pieces, so it continues the same
        // parent NC (if any) as the row it was split from.
        parentNcId: loaded.parentNcId,
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
        // Ledger (QC-NC audit 2026-09-21, gap 8): the scrapped pieces are
        // written off on THIS row, so cleared + failed = rejected and the NC's
        // open qty reads 0 rather than the whole rejected qty after close.
        // Before, only the ANCESTOR NCs received `failed` (via the climb
        // below) and a top-level scrap left its own ledger at 0/0. Readers
        // are unaffected: v_nc_op_breakup.scrap_qty and the production-order
        // loss sum both key scrap on disposition + rejected_qty, and
        // nc_closed_qty excludes scrap outright.
        failedQty: rejectedQtyInt.toFixed(2),
        closedAt: new Date(),
        closedBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .where(eq(ncRegister.id, ncId));
    result.status = 'closed';
    // If this scrapped NC sits on a recovery child, the pieces are genuinely
    // gone — climb the failed qty up the ancestor chain so every ancestor NC
    // (kept open while the pieces were still in rework) can now settle.
    await climbRecoveryToAncestors(
      tx,
      nc.jobCardId,
      0,
      qty,
      `scrap ${nc.code}`,
      today,
      'day',
      ctx.companyId,
      ctx.user,
    );
    // Settling an ancestor NC lifts the "open rework child" hold on its origin
    // op (v_jc_op_status rework_child_open), so an ancestor whose other pieces
    // were already accepted can reach `complete` right here — run the same
    // idempotent JC-close walk op-entry runs after a QC log (gap 2). A no-op
    // when nothing reached complete (a scrap that leaves the op short of its
    // input — see the completion question in the audit report).
    await cascadeJcCompleteUpChain(tx, nc.jobCardId, ctx.user);
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
        // 'complete' when the NC came from a production entry (ADR-183).
        logType: await reinjectLogType(tx, nc),
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
        // Ledger (QC-NC audit 2026-09-21, gap 8): the pieces are accepted with
        // concession, i.e. CLEARED — the qc row above is the same mechanism a
        // rework child's recovery uses, so the NC books it the same way and
        // cleared + failed = rejected. Before, the row closed with 0/0 and its
        // open qty read the whole rejected qty forever. v_nc_op_breakup
        // (0131) counts a closed non-scrap NC by cleared_qty once a ledger is
        // present, which equals what it counted before (rejected_qty).
        clearedQty: rejectedQtyInt.toFixed(2),
        closedAt: new Date(),
        closedBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .where(eq(ncRegister.id, ncId));

    result.status = 'closed';
    const insertedId = inserted[0]?.id;
    if (insertedId) result.opLogId = insertedId;

    // On a rework/repair CHILD the concession settles pieces the PARENT NC is
    // still waiting for: climb them exactly as the child's own terminal QC
    // accept would (recovery.ts onRecoveryJobCardQc) — credit each ancestor NC
    // and re-inject into each ancestor's origin op. Same guard as that hook:
    // only when the NC's op is the child's LAST op. On an intermediate op the
    // concession row feeds the next child op instead, and the child's terminal
    // QC climbs the pieces when they get there — climbing here as well would
    // put them on the parent twice. The climb starts from the child's parent
    // NC (job_cards.parent_nc_id), never from THIS NC, so the qc row already
    // written on nc.jcOpId above is the only row this op gets — no double
    // re-injection on the child's own op. A plain (top-level) JC has no
    // parent NC and is skipped.
    const jcRows = await tx
      .select({
        code: jobCards.code,
        recoveryKind: jobCards.recoveryKind,
        parentNcId: jobCards.parentNcId,
      })
      .from(jobCards)
      .where(and(eq(jobCards.id, nc.jobCardId), eq(jobCards.companyId, ctx.companyId)))
      .limit(1);
    const lastOpRows = await tx
      .select({ opSeq: jcOps.opSeq })
      .from(jcOps)
      .where(and(eq(jcOps.jobCardId, nc.jobCardId), isNull(jcOps.deletedAt)))
      .orderBy(desc(jcOps.opSeq))
      .limit(1);
    const isChildLastOp = lastOpRows[0]?.opSeq != null && lastOpRows[0].opSeq === nc.opSeq;

    // Finished stock, exactly ONCE per piece (ADR-069) — the same two checks
    // submitQcLog runs after a keyed QC log. A concession on the JC's LAST op
    // is the last inspection those pieces ever get, and the qc row above was
    // written directly (never through submitQcLog), so nothing else would
    // credit them: the SO line closed at 10 while the store held 8. Guard:
    //   - tryApplyQcStockCascade is a no-op unless nc.opSeq is the JC's last op
    //     (and skips Production-Order JCs, ADR-170);
    //   - recoveryChildCreditsStock walks a rework chain to the TOP job card
    //     and says yes only when the pieces re-enter the top route at ITS last
    //     op — then the climb's re-inject rows (written directly too) are the
    //     end of the road and this is the one place they are credited. Any
    //     earlier re-entry op means the top JC's own terminal QC credits them.
    // Ordinary (non-recovery) JC → the guard is simply true.
    if (jcRows[0]?.code && (await recoveryChildCreditsStock(tx, ctx.companyId, nc.jobCardId))) {
      await tryApplyQcStockCascade(
        tx,
        {
          companyId: ctx.companyId,
          jobCardId: nc.jobCardId,
          jcCode: jcRows[0].code,
          opSeq: nc.opSeq,
          acceptedQty: rejectedQtyInt,
          txnDate: today,
        },
        ctx.user,
      );
    }

    if (jcRows[0]?.recoveryKind && jcRows[0].parentNcId && isChildLastOp) {
      await climbRecoveryToAncestors(
        tx,
        nc.jobCardId,
        rejectedQtyInt,
        0,
        `use_as_is ${nc.code}`,
        today,
        'day',
        ctx.companyId,
        ctx.user,
      );
    }
    // The qc row (and, on a child, the re-injected ancestor rows) can be what
    // brings this JC or any ancestor to `complete`; nothing else runs the
    // close check for a row written here. Same idempotent walk as op-entry.
    await cascadeJcCompleteUpChain(tx, nc.jobCardId, ctx.user);
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

  // ADR-184 — Make Fresh is refused on a Production Order's card (or any
  // rework / repair child of one — the walk goes up parent_job_card_id). A
  // supplementary JC there would be a second, order-less card making pieces
  // the order's plan already counts: the plan's Covered would never see it.
  // The order-shaped route is Scrap: once the order is closed or short
  // closed, the lost pieces are Pending on the plan again and a new
  // Production Order is raised for them.
  const orderRows = (await tx.execute(sql`
    ${jobCardOrderChainCte(nc.jobCardId)}
    SELECT po.code AS po_code,
           COALESCE(p.code, po.plan_code_text) AS plan_code
    FROM chain
    JOIN public.production_orders po ON po.id = chain.production_order_id
    LEFT JOIN public.plans p ON p.id = po.plan_id
    WHERE po.deleted_at IS NULL
    ORDER BY chain.depth
    LIMIT 1
  `)) as unknown as Array<{ po_code: string; plan_code: string | null }>;
  const owningOrder = orderRows[0];
  if (owningOrder) {
    throw new ValidationError(
      `${origin.code} belongs to Production Order ${owningOrder.po_code}. Use Scrap: the lost ` +
        `pieces return to plan ${owningOrder.plan_code ?? '(unknown)'} as Pending and a new ` +
        `Production Order is raised from it.`,
    );
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

  // ADR-184 — the supplementary JC makes the SAME part by the SAME route, so
  // it is seeded with a copy of the origin card's live operations. Only the
  // columns that DEFINE an op are copied (sequence, machine, operation, type,
  // cycle time, program, tool, QC flag, outsource vendor + cost). Every
  // progress / document column (rework qty, OSP status / PR / PO line / DC /
  // sent / returned, QC call dates, schedule) starts at its default — a new
  // card has done nothing yet. Before ADR-184 the card was created with no
  // ops at all and could not be worked.
  // Review fix: the route is read off the TOP card of the chain (the origin's
  // furthest ancestor via parent_job_card_id), never off a rework / repair
  // child, whose ops are only the corrective steps, not the part's route.
  const rootRows = (await tx.execute(sql`
    ${jobCardOrderChainCte(origin.id)}
    SELECT chain.id AS id FROM chain ORDER BY chain.depth DESC LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  const routeJcId = rootRows[0]?.id ?? origin.id;
  const originOps = await tx
    .select({
      opSeq: jcOps.opSeq,
      machineId: jcOps.machineId,
      machineCodeText: jcOps.machineCodeText,
      operation: jcOps.operation,
      opType: jcOps.opType,
      cycleTimeMin: jcOps.cycleTimeMin,
      program: jcOps.program,
      toolNo: jcOps.toolNo,
      toolDetails: jcOps.toolDetails,
      qcRequired: jcOps.qcRequired,
      outsourceVendorId: jcOps.outsourceVendorId,
      outsourceVendorText: jcOps.outsourceVendorText,
      outsourceCost: jcOps.outsourceCost,
    })
    .from(jcOps)
    .where(and(eq(jcOps.jobCardId, routeJcId), isNull(jcOps.deletedAt)))
    .orderBy(asc(jcOps.opSeq));
  if (originOps.length > 0) {
    await tx.insert(jcOps).values(
      originOps.map((op) => ({
        ...op,
        companyId: ctx.companyId,
        jobCardId: newJc.id,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })),
    );
  }

  // Ledger (QC-NC audit 2026-09-21, gap 8): the pieces are written off and
  // the supplementary JC replaces them, so failed_qty = rejected_qty and the
  // NC's open qty reads 0 after close (cleared + failed = rejected).
  // DEPENDS ON migration 0138 (v_nc_op_breakup): before it, the view counted
  // a closed non-scrap NC by cleared_qty the moment ANY ledger was present,
  // so this write would have dropped make_fresh pieces out of the op's
  // "closed" strip; 0138 keys make_fresh on rejected_qty regardless. The
  // production-order loss sum already keys make_fresh on disposition.
  await tx
    .update(ncRegister)
    .set({
      status: 'closed',
      disposition: 'make_fresh',
      dispositionDate: today,
      dispositionByText: ctx.userName,
      dispositionRemarks: input.remarks ?? null,
      reworkJcCodeText: newJc.code,
      failedQty: rejectedQtyInt.toFixed(2),
      closedAt: new Date(),
      closedBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .where(eq(ncRegister.id, ncId));

  // If this NC sits on a recovery CHILD, the written-off pieces are gone from
  // the whole chain exactly as a scrap is (the supplementary JC replaces them
  // as its own document): climb `failed` up to every ancestor NC so each can
  // settle instead of waiting forever for pieces that will never come back,
  // then run the same JC-close walk the scrap branch runs — lifting the
  // "open rework child" hold can be what lets an ancestor read `complete`.
  // Both are no-ops on a top-level NC (no parent NC to climb to).
  await climbRecoveryToAncestors(
    tx,
    nc.jobCardId,
    0,
    qty,
    `make fresh ${nc.code}`,
    today,
    'day',
    ctx.companyId,
    ctx.user,
  );
  await cascadeJcCompleteUpChain(tx, nc.jobCardId, ctx.user);

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
// Generated NC code shape: `NC-#####`, the company's series (ADR-183; see
// nextNcCode below). Codes minted before it read
// `NC-AUTO-<jcCode>-Op<srNo>-<HHMMSSmmm>` and are left as they are.

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
  /** The ACTUAL producing machine for the rejected pieces (ADR-164/0095),
   *  resolved by the caller from the producing op's op_log. Null when there is
   *  no in-house machine (e.g. an Incoming-QC reject of vendor material). This
   *  is the machine that MADE the pieces — nc.opSeq/operationText still name the
   *  rejecting/QC op and are left untouched. */
  machineCodeText?: string | null;
  /** The operator who ran the producing op — the person responsible for the
   *  rejected pieces, resolved by the caller from the producing op's op_log
   *  operator_name. Distinct from reportedByText (the QC inspector). Null when
   *  none was recorded, or on an Incoming-QC reject of vendor material. */
  operatorText?: string | null;
  /** The op_log inspection row that rejected the pieces (design §3). Null on
   *  an Incoming-QC reject, which has no op_log row. */
  qcLogId?: string | null;
  /** The GRN line an Incoming-QC reject was raised from. Null on an op QC. */
  grnLineId?: string | null;
  /** What the person was doing when the reject was recorded, for the NC's
   *  reason line — 'QC inspection' (default), or 'production entry' when the
   *  pieces were inspected at the machine and logged on the production form. */
  sourceLabel?: string;
}

export interface AutoCreateNcResult {
  ncId: string;
  ncCode: string;
}

/** The next code in the company's `NC-#####` series (ADR-183). The number rule
 *  is pure and unit-tested in lib/nc-code.ts; this only feeds it the codes the
 *  company already holds. Rows written before the series — the long
 *  `NC-AUTO-<jc>-Op<n>-<stamp>` names and anything typed by hand — do not match
 *  the strict shape and so cannot move it. */
async function nextNcCode(tx: DbTransaction, companyId: string): Promise<string> {
  // Two inspections or production entries on DIFFERENT ops committing at once
  // would both read the same maximum; the loser then hits
  // nc_register_company_code_uniq and the operator's whole entry is thrown
  // away. One transaction-scoped lock per company serialises the pick; it is
  // released at commit, when the winner's row is visible to the next reader.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`nc_code:${companyId}`}))`);
  const rows = await tx
    .select({ code: ncRegister.code })
    .from(ncRegister)
    .where(eq(ncRegister.companyId, companyId));
  return nextNcCodeFrom(rows.map((r) => r.code));
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
    .select({
      itemId: jobCards.itemId,
      recoveryKind: jobCards.recoveryKind,
      parentNcId: jobCards.parentNcId,
    })
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

  // Take the next number, then step past anything already holding it. Two
  // inspections committing at once is the only way that happens, and
  // nc_register_company_code_uniq is the real backstop — this just avoids
  // making the index do the shouting in the ordinary case.
  let code = await nextNcCode(tx, ctx.companyId);
  for (let attempt = 0; attempt < 5; attempt++) {
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
    code = nextNcCodeFrom([code]);
  }

  // Where the reject was entered. A dedicated QC op and a production entry
  // inspected at the machine are both quality decisions, but the register
  // should not claim an inspection that has no QC op behind it (ADR-183).
  const source = ctx.sourceLabel ?? 'QC inspection';
  const reason =
    ctx.remarks && ctx.remarks.length > 0
      ? `Auto-created from ${source}: ${ctx.remarks}`
      : // display rule — see opSrNo in @innovic/shared
        `Auto-created from ${source} on ${ctx.jcCode} Op #${opSrNo(ctx.opSeq)}`;

  // G8 (gap report 2026-09-16): an Incoming-QC reject on a GRN that itself
  // came back against an NC's return-to-vendor challan (goods_receipt_notes.nc_id)
  // is a FOLLOW-ON of that NC — the same pieces, second trip. Link the new row
  // to it so the register can show "Continues NC <code>".
  //
  // Same idea for the in-house trip (QC-NC audit 2026-09-21, gap 7): a reject
  // on a rework/repair CHILD's QC op is a follow-on of the NC that child is
  // reworking (job_cards.parent_nc_id) — the same pieces, second attempt — so
  // the chain reads NC-1 → P-RW1 → NC-2 → P-RW1-RW1 without a gap. Null on
  // an ordinary job card.
  //
  // Order: the GRN header's nc_id wins when the GRN IS a return-to-vendor
  // replacement; otherwise (no GRN line, or an ordinary GRN line — e.g. a
  // rework child routed through an outsource op) fall back to the child's own
  // parent NC. Without the fallback a reject on such a child got no link.
  let parentNcId: string | null = null;
  if (ctx.grnLineId) {
    const parentRows = await tx
      .select({ ncId: goodsReceiptNotes.ncId })
      .from(goodsReceiptNoteLines)
      .innerJoin(
        goodsReceiptNotes,
        eq(goodsReceiptNotes.id, goodsReceiptNoteLines.goodsReceiptNoteId),
      )
      .where(
        and(
          eq(goodsReceiptNoteLines.id, ctx.grnLineId),
          eq(goodsReceiptNotes.companyId, ctx.companyId),
        ),
      )
      .limit(1);
    parentNcId = parentRows[0]?.ncId ?? null;
  }
  if (!parentNcId && jc.recoveryKind && jc.parentNcId) {
    parentNcId = jc.parentNcId;
  }

  const inserted = await tx
    .insert(ncRegister)
    .values({
      companyId: ctx.companyId,
      code,
      parentNcId,
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
      // ADR-164/0095: the ACTUAL machine that produced the rejected pieces,
      // resolved by the caller from the producing op's op_log. Null when no
      // in-house machine applies (e.g. vendor material at Incoming QC).
      machineCodeText: ctx.machineCodeText ?? null,
      // The operator who produced the rejected pieces (design §3). Distinct from
      // reportedByText (the QC inspector who raised the NC).
      operatorText: ctx.operatorText ?? null,
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
