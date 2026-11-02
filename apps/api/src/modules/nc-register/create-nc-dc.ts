// Return-to-vendor DC for one or SEVERAL NCs (owner 2026-11-01, migration 0237).
//
// One DC carries every picked NC of ONE Sales Order going to ONE vendor, one
// line per NC. Each line keeps its own origin PO line (different JW POs / job
// cards inside the one SO are allowed). A DC is never trimmed to fewer NCs
// later — cancel the whole DC instead. The single-NC save from the NC detail
// panel is the same code path with one id (createNcDc below).
//
// Header nc_id = the FIRST NC (input order): it keeps marking the challan as a
// return DC for every "not an RTV challan" filter. Per-NC facts live on the
// line (delivery_challan_lines.nc_id) and on the NC (delivery_challan_id).

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ActivityAction, NC_STATUS_MOVES, roundQty, statusesThatMayMoveTo } from '@innovic/shared';
import {
  deliveryChallanLines,
  deliveryChallans,
  goodsReceiptNoteLines,
  items,
  jcOps,
  jobCards,
  ncRegister,
  purchaseOrderLines,
  purchaseOrders,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { assertActiveParty } from '../../lib/active-party';
import { AuthorizationError, ConflictError, ValidationError } from '../../lib/errors';
import { lockPoLinesForSend } from '../../lib/po-line-sent';
import { assertRowUpdated } from '../../lib/row-lock';
import { emitActivityLog } from '../activity-log/service';
import { recalcPoHeaderStatus, recalcPoLineReceivedQty } from '../goods-receipt-notes/cascades';
import {
  type LockedNc,
  commonSourceVendorId,
  lockNcsForDc,
  nextNcDcCode,
  readPoLineReceived,
} from './nc-dc-guards';
import type {
  CreateNcDcBatchInput,
  CreateNcDcBatchResult,
  CreateNcDcInput,
  CreateNcDcResult,
} from './schema';
import { readNc } from './service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

type OriginPo = { id: string; code: string; status: string };

/** Everything one DC line needs, resolved per NC before anything is written. */
interface NcLinePlan {
  nc: LockedNc;
  qty: number;
  poLineId: string | null;
  originPo: OriginPo | null;
  sourceSoLineId: string | null;
  item: { code: string; name: string; uom: (typeof items.$inferSelect)['uom'] } | undefined;
}

/**
 * Issue ONE challan that sends the pieces of every picked NC back to the
 * vendor. One transaction: DC header + one line per NC, each NC's rtv ledger,
 * and — per origin PO line — the §12.2 PO received-qty adjustment, so the PO
 * no longer counts pieces that have left the shop.
 *
 * Each line points at the ORIGIN order's PO line (the one the pieces were
 * received on — the op's outsource PO line, else the bought-material GRN line's
 * PO line), because that is the line §12.2 recomputes. The PO-line
 * cumulative-sent guard is not applied (a return is not a new send).
 */
export async function createNcDcBatch(
  input: CreateNcDcBatchInput,
  user: AuthContext,
): Promise<CreateNcDcBatchResult> {
  // ADR-211: OSP Outward DC entry alone raises the return challan; disposing
  // stays with QC.
  await requireFormAccess(user, 'ospdc_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const { ncs: picked, soCode } = await lockNcsForDc(tx, input.ncIds, companyId);
    const sourceVendorId = await commonSourceVendorId(tx, companyId, picked);
    // input.vendorId still wins when supplied; vendorCodeText stays what the
    // caller displayed.
    const effectiveVendorId = input.vendorId ?? sourceVendorId;
    // A10 inactive-master rule — 409 "Vendor X is disabled".
    if (effectiveVendorId) {
      await assertActiveParty(tx, 'vendor', effectiveVendorId, companyId);
    }

    // Per NC: card's SO line, item master uom, origin PO line.
    const plans: NcLinePlan[] = [];
    for (const nc of picked) {
      const jcRows = nc.jobCardId
        ? await tx
            .select({ sourceSoLineId: jobCards.sourceSoLineId })
            .from(jobCards)
            .where(and(eq(jobCards.id, nc.jobCardId), eq(jobCards.companyId, companyId)))
            .limit(1)
        : [];
      const itemRows = await tx
        .select({ code: items.code, name: items.name, uom: items.uom })
        .from(items)
        .where(and(eq(items.id, nc.itemId), eq(items.companyId, companyId)))
        .limit(1);
      const originRows = nc.jcOpId
        ? await tx
            .select({ opType: jcOps.opType, outsourcePoLineId: jcOps.outsourcePoLineId })
            .from(jcOps)
            .where(and(eq(jcOps.id, nc.jcOpId), eq(jcOps.companyId, companyId)))
            .limit(1)
        : [];
      const origin = originRows[0];
      let poLineId =
        origin && (origin.opType === 'outsource' || origin.outsourcePoLineId)
          ? (origin.outsourcePoLineId ?? null)
          : null;
      // ADR-189 — a bought-material NC has no op; its PO line is the one the
      // rejected GRN line was received against.
      if (!poLineId && !nc.jobCardId && nc.grnLineId) {
        const gl = await tx
          .select({ poLineId: goodsReceiptNoteLines.purchaseOrderLineId })
          .from(goodsReceiptNoteLines)
          .where(eq(goodsReceiptNoteLines.id, nc.grnLineId))
          .limit(1);
        poLineId = gl[0]?.poLineId ?? null;
      }
      plans.push({
        nc,
        qty: roundQty(Number(nc.rejectedQty)),
        poLineId,
        originPo: null,
        sourceSoLineId: jcRows[0]?.sourceSoLineId ?? null,
        item: itemRows[0],
      });
    }

    // ADR-235 — lock every PO line first, ONCE, sorted (the PO cancel locks
    // header → lines and flips the status before letting go), then read each
    // order's status: a PO cancelled, or with a cancel pending, while we waited
    // is refused.
    const poLineIds = [
      ...new Set(plans.map((p) => p.poLineId).filter((x): x is string => !!x)),
    ].sort();
    await lockPoLinesForSend(tx, poLineIds, companyId);
    const poByLine = new Map<string, OriginPo>();
    if (poLineIds.length > 0) {
      const poRows = await tx
        .select({
          lineId: purchaseOrderLines.id,
          id: purchaseOrders.id,
          code: purchaseOrders.code,
          status: purchaseOrders.status,
        })
        .from(purchaseOrderLines)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
        .where(
          and(
            inArray(purchaseOrderLines.id, poLineIds),
            eq(purchaseOrders.companyId, companyId),
            isNull(purchaseOrders.deletedAt),
          ),
        );
      for (const r of poRows) poByLine.set(r.lineId, { id: r.id, code: r.code, status: r.status });
    }
    for (const p of plans) {
      if (!p.poLineId) continue;
      p.originPo = poByLine.get(p.poLineId) ?? null;
      // The PO line is known, so the order behind it must be findable; no row
      // means it is in Trash. Writing the legacy "no order" shape would leave
      // the line recalc adjusting an order the challan does not name.
      if (!p.originPo) {
        throw new ConflictError(
          `The job work order behind ${p.nc.code} is in Trash, so nothing can be sent against it. ` +
            `Restore that order first, then raise the return challan.`,
        );
      }
      // A CANCELLED order is refused; a closed / short-closed one is allowed
      // (the pieces were received on it and are going back).
      if (p.originPo.status === 'cancelled') {
        throw new ConflictError(
          `Job Work PO ${p.originPo.code} is Cancelled, so nothing can be sent against it. ` +
            `NC ${p.nc.code} cannot be returned to the vendor on this order.`,
        );
      }
    }

    // Header PO: the shared origin order when EVERY line has the same one; when
    // they differ (or some lines have none) no single FK, and po_code_text
    // (NOT NULL) lists the distinct order codes; with no order at all the
    // legacy shape — the first NC's code.
    const firstPlan = plans[0]!;
    const poById = new Map<string, OriginPo>();
    for (const p of plans) if (p.originPo) poById.set(p.originPo.id, p.originPo);
    const distinctPos = [...poById.values()];
    const allSamePo = distinctPos.length === 1 && plans.every((p) => p.originPo);
    const headerPoId = allSamePo ? distinctPos[0]!.id : null;
    const poCodeText =
      distinctPos.length === 0 ? firstPlan.nc.code : distinctPos.map((po) => po.code).join(', ');
    const shared = <T>(pick: (p: NcLinePlan) => T | null): T | null => {
      const v = pick(firstPlan);
      return plans.every((p) => pick(p) === v) ? v : null;
    };

    const code = await nextNcDcCode(tx, companyId);
    const reason = `Return to vendor — ${firstPlan.nc.dispositionRemarks ?? 'rework'}`;

    const insertedDc = await tx
      .insert(deliveryChallans)
      .values({
        companyId,
        code,
        dcDate: input.dcDate,
        purchaseOrderId: headerPoId,
        poCodeText,
        vendorId: effectiveVendorId ?? null,
        vendorCodeText: input.vendorCodeText,
        // Every NC is on ONE SO (lockNcsForDc). The header SO line is the first
        // NC's, so the SO it belongs to (list SO No., SO-cancel blocker) is
        // always named even when the lines sit on different SO lines.
        salesOrderLineId: firstPlan.sourceSoLineId,
        soRefText: soCode ?? firstPlan.nc.soCodeText,
        transport: input.transport ?? null,
        vehicleNo: input.vehicleNo ?? null,
        status: 'issued',
        // ADR-197 (0178) — who issued the challan, and when.
        issuedBy: user.id,
        issuedAt: new Date(),
        // The FIRST NC: marks the challan as a return DC (0237).
        ncId: firstPlan.nc.id,
        jobCardId: shared((p) => p.nc.jobCardId),
        reason,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: deliveryChallans.id, code: deliveryChallans.code });
    const dc = insertedDc[0];
    if (!dc) throw new ValidationError('Could not create the return-to-vendor DC. Try again.');

    await tx.insert(deliveryChallanLines).values(
      plans.map((p, i) => ({
        companyId,
        deliveryChallanId: dc.id,
        lineNo: i + 1,
        itemId: p.nc.itemId,
        itemCodeText: p.item?.code ?? p.nc.itemCodeText,
        itemNameText: p.item?.name ?? p.nc.itemNameText,
        qty: p.qty.toFixed(3),
        uom: p.item?.uom ?? ('NOS' as const),
        materialText: null,
        // The NC code is always the line remark so the print names the
        // rejection it serves; a typed note is appended, not substituted.
        dcRemarks: input.remarks ? `${p.nc.code} — ${input.remarks}` : p.nc.code,
        purchaseOrderLineId: p.poLineId,
        ncId: p.nc.id,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );

    for (const p of plans) {
      // §20.2 — conditional on the status AND on no challan yet.
      const sentRows = await tx
        .update(ncRegister)
        .set({
          rtvSentQty: p.qty.toFixed(3),
          deliveryChallanId: dc.id,
          status: 'sent_to_vendor',
          updatedBy: user.id,
        })
        .where(
          and(
            eq(ncRegister.id, p.nc.id),
            isNull(ncRegister.deliveryChallanId),
            inArray(ncRegister.status, statusesThatMayMoveTo(NC_STATUS_MOVES, 'sent_to_vendor')),
          ),
        )
        .returning({ id: ncRegister.id });
      assertRowUpdated(sentRows, `NC ${p.nc.code}`);

      // The pieces are at the vendor again, so an origin op that read
      // 'received' goes back to 'sent' (OSP chain gap G5). Only that one
      // transition; onNcChallanReceived flips it back.
      if (p.nc.jcOpId) {
        await tx
          .update(jcOps)
          .set({ outsourceStatus: 'sent', updatedBy: user.id })
          .where(
            and(
              eq(jcOps.id, p.nc.jcOpId),
              eq(jcOps.companyId, companyId),
              eq(jcOps.outsourceStatus, 'received'),
            ),
          );
      }
    }

    // §12.2 — once per PO line, AFTER every NC carries this challan: the
    // return-to-vendor term inside recalcPoLineReceivedQty reads each NC's
    // delivery_challan_id, so recomputing now applies the subtraction for all
    // of them at once. The audit row records the before/after.
    for (const poLineId of poLineIds) {
      const onLine = plans.filter((p) => p.poLineId === poLineId);
      const lineQty = roundQty(onLine.reduce((s, p) => s + p.qty, 0));
      const ncCodes = onLine.map((p) => p.nc.code).join(', ');
      const before = await readPoLineReceived(tx, poLineId);
      await recalcPoLineReceivedQty(tx, poLineId, user.id);
      const after = await readPoLineReceived(tx, poLineId);
      if (before && after) {
        await emitActivityLog(
          tx,
          {
            action: 'PO_RECEIVED_ADJUST',
            entity: 'PurchaseOrderLine',
            detail:
              `PO Ln ${before.lineNo} Received ${before.receivedQty} → ${after.receivedQty} ` +
              `(${lineQty} returned to vendor on ${dc.code} for ${ncCodes})`,
            refId: onLine[0]!.nc.code,
          },
          companyId,
          user,
        );
      }
    }
    // The lines' RECEIVED dropped, so each origin order's arrival ladder is
    // recomputed (qc_pending / closed → partial while pieces sit at the vendor).
    for (const po of distinctPos) {
      await recalcPoHeaderStatus(tx, po.id, user.id);
    }

    for (const p of plans) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Send,
          entity: 'NonConformance',
          entityId: p.nc.id,
          refId: p.nc.code,
          qty: p.qty,
          detail: `${p.nc.code} — ${dc.code} issued to ${input.vendorCodeText}, ${p.qty} pcs`,
        },
        companyId,
        user,
      );
    }
    // One row per document touched: the challan's own SEND.
    const totalQty = roundQty(plans.reduce((s, p) => s + p.qty, 0));
    const allCodes = plans.map((p) => p.nc.code).join(', ');
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Send,
        entity: 'DeliveryChallan',
        entityId: dc.id,
        refId: dc.code,
        lineRef: plans.length === 1 ? 'Line 1' : `Lines 1-${plans.length}`,
        qty: totalQty,
        detail: `${dc.code} — return to vendor ${input.vendorCodeText} for ${allCodes}, ${totalQty} pcs`,
      },
      companyId,
      user,
    );

    const ncs = [];
    for (const p of plans) ncs.push(await readNc(tx, p.nc.id, companyId));
    return { ncs, deliveryChallanId: dc.id, deliveryChallanCode: dc.code };
  });
}

/** The NC detail panel's single-NC save (POST /nc-register/:id/create-dc):
 *  the batch with one id, answered in the old one-NC shape. */
export async function createNcDc(
  id: string,
  input: CreateNcDcInput,
  user: AuthContext,
): Promise<CreateNcDcResult> {
  const result = await createNcDcBatch({ ...input, ncIds: [id] }, user);
  return {
    nc: result.ncs[0]!,
    deliveryChallanId: result.deliveryChallanId,
    deliveryChallanCode: result.deliveryChallanCode,
  };
}
