// JW Return Challan service (ADR-079).
//
// Returns machined goods to the customer against a Job Work Order line. Guard:
// cannot return more than has actually been PRODUCED (terminal QC-accepted qty
// on the line's Job Card, read from v_jc_op_status) minus what was already
// returned — mirrors the customer-dispatch readiness gate. Bumps
// job_work_order_lines.returned_qty and flips the JWSO to 'dispatched' once
// every line is fully returned.

import { and, desc, eq, isNull, like, sql } from 'drizzle-orm';
import type {
  CreateJwReturnChallanInput,
  JwReturnChallan,
  ListJwReturnChallansResponse,
} from '@innovic/shared';
import {
  clients,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  jwReturnChallans,
  storeTransactions,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

// ADR-106 — move finished goods out of own stock when they go back to the
// customer, and back in if the challan is cancelled.
//
// A JWSO Job Card credits stock at final QC exactly like an SO one
// (qc-stock-cascade.ts): the machined parts really are in the store between QC
// and dispatch. What was missing is this leg — the return challan wrote nothing,
// so the credit never came out and own stock climbed by the full qty of every
// job-work order, permanently.
//
// Deliberately mirrors moveDispatchStock in customer-dispatches/service.ts,
// including the on-hand floor: never ship out more finished goods than the
// ledger says are physically there (the SO-517 class of bug).
async function moveReturnStock(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  dir: 'out' | 'in',
  code: string,
  date: string,
  itemId: string | null,
  qty: number,
  // Assembly lines move stock for each COMPONENT, never for the phantom
  // parent. Keeps one ledger row per child (distinct source_ref) and names the
  // child in the insufficient-stock error.
  component?: { code: string },
): Promise<void> {
  if (!itemId || qty <= 0) return;
  await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itemId}::uuid FOR UPDATE`);
  const bal = (await tx.execute(sql`
    SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
    FROM public.v_item_stock
    WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
  `)) as unknown as Array<{ on_hand: number }>;
  const before = Number(bal[0]?.on_hand ?? 0);
  if (dir === 'out' && qty > before) {
    throw new ConflictError(
      `Insufficient stock to return${component ? ` ${component.code}` : ''}: ` +
        `on-hand ${before}, requested ${qty}. ` +
        `Complete machining + final QC so the parts are booked in before returning them.`,
    );
  }
  const after = dir === 'out' ? before - qty : before + qty;
  await tx.insert(storeTransactions).values({
    companyId,
    txnDate: date,
    itemId,
    txnType: dir,
    qty,
    sourceType: 'jw_return',
    sourceRef: `${code}${component ? ` / ${component.code}` : ''}${dir === 'in' ? ' (cancel)' : ''}`,
    stockBefore: before,
    stockAfter: after,
    remarks:
      dir === 'out'
        ? `JW return to customer · ${qty} pcs`
        : `JW return cancel reversal · ${qty} pcs`,
    createdBy: userId,
  });
}

function dateLike(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

async function nextReturnCode(tx: DbTransaction, companyId: string): Promise<string> {
  const prefix = 'IN-JWRC-';
  const rows = await tx
    .select({ code: jwReturnChallans.code })
    .from(jwReturnChallans)
    .where(and(eq(jwReturnChallans.companyId, companyId), like(jwReturnChallans.code, `${prefix}%`)));
  let max = 0;
  for (const r of rows) {
    const m = r.code.slice(prefix.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

/**
 * Produced = terminal QC-accepted qty summed over the JW line's Job Cards.
 *
 * ASSEMBLY lines (source_bom_master_id set, migration 0086) roll up
 * differently, for the same reason customer dispatch does (ADR-109): the BOM
 * cascade hangs every child JC off the PARENT line, so summing them adds
 * unrelated components together — 5 of C1 plus 4 of C2 is not 9 of anything,
 * it is 4 assemblies with one C1 stranded. The parent is a phantom nobody ever
 * machines. So:
 *
 *   produced = MIN over components of FLOOR(componentProduced / qtyPerSet)
 *
 * No purchase branch is needed here: a BOM containing bought parts is refused
 * on a job-work order outright (assertBomUsableForJobWork).
 */
async function producedForLine(tx: DbTransaction, lineId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT
      CASE
        WHEN l.source_bom_master_id IS NOT NULL THEN COALESCE(bom.produced, 0)
        ELSE COALESCE(own.produced, 0)
      END AS produced
    FROM public.job_work_order_lines l
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(x.eff), 0) AS produced FROM (
        SELECT DISTINCT ON (jc.id)
          CASE
            WHEN vs.op_type = 'qc' OR vs.qc_required THEN vs.qc_accepted_qty
            WHEN vs.op_type = 'outsource' THEN COALESCE((
              SELECT SUM(grl.qc_accepted_qty) FROM public.goods_receipt_note_lines grl
              WHERE grl.purchase_order_line_id = jo.outsource_po_line_id AND grl.deleted_at IS NULL), 0)
            ELSE vs.completed_qty
          END AS eff
        FROM public.job_cards jc
        JOIN public.v_jc_op_status vs ON vs.job_card_id = jc.id
        LEFT JOIN public.jc_ops jo ON jo.job_card_id = jc.id AND jo.op_seq = vs.op_seq AND jo.deleted_at IS NULL
        WHERE jc.source_jw_line_id = l.id AND jc.deleted_at IS NULL
        ORDER BY jc.id, vs.op_seq DESC
      ) x
    ) own ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(MIN(FLOOR(comp.eff / bml.qty_per_set)), 0) AS produced
      FROM public.bom_master_lines bml
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(y.eff), 0) AS eff FROM (
          SELECT DISTINCT ON (jc.id)
            CASE
              WHEN vs.op_type = 'qc' OR vs.qc_required THEN vs.qc_accepted_qty
              WHEN vs.op_type = 'outsource' THEN COALESCE((
                SELECT SUM(grl.qc_accepted_qty) FROM public.goods_receipt_note_lines grl
                WHERE grl.purchase_order_line_id = jo2.outsource_po_line_id AND grl.deleted_at IS NULL), 0)
              ELSE vs.completed_qty
            END AS eff
          FROM public.job_cards jc
          JOIN public.v_jc_op_status vs ON vs.job_card_id = jc.id
          LEFT JOIN public.jc_ops jo2 ON jo2.job_card_id = jc.id AND jo2.op_seq = vs.op_seq AND jo2.deleted_at IS NULL
          WHERE jc.source_jw_line_id = l.id
            AND jc.item_id = bml.child_item_id
            AND jc.deleted_at IS NULL
          ORDER BY jc.id, vs.op_seq DESC
        ) y
      ) comp ON TRUE
      WHERE bml.bom_master_id = l.source_bom_master_id
        AND bml.company_id = l.company_id
        AND bml.deleted_at IS NULL
        AND bml.qty_per_set > 0
    ) bom ON TRUE
    WHERE l.id = ${lineId}::uuid
  `)) as unknown as Array<{ produced: number | string }>;
  return Number(rows[0]?.produced ?? 0);
}

interface JwBomComponent {
  childItemId: string;
  childItemCode: string;
  qtyPerSet: number;
}

/**
 * Components of a JW line's BOM, or [] when the line is an ordinary machining
 * line. Returning the finished assembly consumes its COMPONENTS — the parent
 * is a phantom that never had stock to debit.
 */
async function bomComponentsForLine(
  tx: DbTransaction,
  lineId: string,
): Promise<JwBomComponent[]> {
  const rows = (await tx.execute(sql`
    SELECT bml.child_item_id, i.code AS child_code, bml.qty_per_set
    FROM public.job_work_order_lines l
    JOIN public.bom_master_lines bml
      ON bml.bom_master_id = l.source_bom_master_id
      AND bml.company_id = l.company_id
      AND bml.deleted_at IS NULL
    JOIN public.items i ON i.id = bml.child_item_id AND i.deleted_at IS NULL
    WHERE l.id = ${lineId}::uuid
    ORDER BY bml.line_no
  `)) as unknown as Array<{
    child_item_id: string;
    child_code: string | null;
    qty_per_set: string | number;
  }>;
  return rows.map((r) => ({
    childItemId: r.child_item_id,
    childItemCode: r.child_code ?? r.child_item_id.slice(0, 8),
    qtyPerSet: Number(r.qty_per_set) || 0,
  }));
}

/**
 * What a return challan ACTUALLY moved out, replayed from the ledger. Cancel
 * reverses these exact rows rather than re-exploding the BOM, so a BOM edited
 * between return and cancel cannot leave the ledger unbalanced.
 */
async function returnedComponents(
  tx: DbTransaction,
  companyId: string,
  code: string,
): Promise<Array<{ itemId: string; itemCode: string; qty: number }>> {
  const rows = (await tx.execute(sql`
    SELECT st.item_id, st.qty, i.code AS item_code
    FROM public.store_transactions st
    LEFT JOIN public.items i ON i.id = st.item_id
    WHERE st.company_id = ${companyId}::uuid
      AND st.source_type = 'jw_return'
      AND st.txn_type = 'out'
      AND st.source_ref LIKE ${`${code} / `} || '%'
  `)) as unknown as Array<{ item_id: string | null; qty: number; item_code: string | null }>;
  return rows
    .filter((r): r is { item_id: string; qty: number; item_code: string | null } => Boolean(r.item_id))
    .map((r) => ({
      itemId: r.item_id,
      itemCode: r.item_code ?? r.item_id.slice(0, 8),
      qty: Number(r.qty) || 0,
    }));
}

function rowToReturn(row: typeof jwReturnChallans.$inferSelect): JwReturnChallan {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    status: row.status,
    returnDate: dateLike(row.returnDate),
    jobWorkOrderId: row.jobWorkOrderId,
    jobWorkOrderLineId: row.jobWorkOrderLineId,
    jwCodeText: row.jwCodeText,
    jobCardId: row.jobCardId,
    clientId: row.clientId,
    qty: row.qty,
    transport: row.transport,
    vehicleNo: row.vehicleNo,
    remarks: row.remarks,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export async function createJwReturnChallan(
  input: CreateJwReturnChallanInput,
  user: AuthContext,
): Promise<JwReturnChallan> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    // 1) Resolve JW line + its order → lock line for the returned_qty update
    await tx.execute(
      sql`SELECT 1 FROM public.job_work_order_lines WHERE id = ${input.jobWorkOrderLineId}::uuid FOR UPDATE`,
    );
    const lineRows = await tx
      .select({
        id: jobWorkOrderLines.id,
        orderQty: jobWorkOrderLines.orderQty,
        returnedQty: jobWorkOrderLines.returnedQty,
        jwId: jobWorkOrderLines.jobWorkOrderId,
        itemId: jobWorkOrderLines.itemId,
      })
      .from(jobWorkOrderLines)
      .where(
        and(
          eq(jobWorkOrderLines.id, input.jobWorkOrderLineId),
          eq(jobWorkOrderLines.companyId, companyId),
          isNull(jobWorkOrderLines.deletedAt),
        ),
      )
      .limit(1);
    const line = lineRows[0];
    if (!line) throw new NotFoundError(`Job Work Order line ${input.jobWorkOrderLineId} not found`);

    const jwRows = await tx
      .select({ id: jobWorkOrders.id, code: jobWorkOrders.code, clientId: jobWorkOrders.clientId })
      .from(jobWorkOrders)
      .where(and(eq(jobWorkOrders.id, line.jwId), isNull(jobWorkOrders.deletedAt)))
      .limit(1);
    const jw = jwRows[0];
    if (!jw) throw new NotFoundError(`Job Work Order ${line.jwId} not found`);

    // 2) GUARD — cannot return more than produced (terminal QC-accepted) − already returned
    const produced = await producedForLine(tx, line.id);
    const returnable = produced - line.returnedQty;
    if (input.qty > returnable) {
      throw new ValidationError(
        `Cannot return ${input.qty} — only ${Math.max(0, returnable)} produced & available ` +
          `(machined-accepted ${produced}, already returned ${line.returnedQty}). ` +
          `Complete machining + QC before returning this quantity.`,
      );
    }
    if (input.qty > line.orderQty - line.returnedQty) {
      throw new ConflictError(
        `Return would exceed the ordered qty (${line.orderQty}); already returned ${line.returnedQty}.`,
      );
    }

    // 3) Optional JC
    let jobCardId: string | null = null;
    if (input.jobCardId) {
      const jcRows = await tx
        .select({ id: jobCards.id })
        .from(jobCards)
        .where(
          and(
            eq(jobCards.id, input.jobCardId),
            eq(jobCards.companyId, companyId),
            isNull(jobCards.deletedAt),
          ),
        )
        .limit(1);
      if (!jcRows[0]) throw new NotFoundError(`Job Card ${input.jobCardId} not found`);
      jobCardId = jcRows[0].id;
    }

    // 4) Insert return challan
    const code = input.code ?? (await nextReturnCode(tx, companyId));
    const inserted = await tx
      .insert(jwReturnChallans)
      .values({
        companyId,
        code,
        returnDate: input.returnDate,
        jobWorkOrderId: jw.id,
        jobWorkOrderLineId: line.id,
        jwCodeText: jw.code,
        jobCardId,
        clientId: jw.clientId ?? null,
        qty: input.qty,
        transport: input.transport ?? null,
        vehicleNo: input.vehicleNo ?? null,
        remarks: input.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Failed to insert JW return challan');

    // 4b) ADR-106 — take the goods out of own stock. They were booked in by the
    // Job Card's final QC (qc_accept); shipping them back is what removes them.
    // An ASSEMBLY line (0086) explodes: each component leaves at qty x
    // qtyPerSet. The parent is never debited — nothing ever credited it.
    const components = await bomComponentsForLine(tx, line.id);
    if (components.length > 0) {
      for (const c of components) {
        await moveReturnStock(
          tx,
          companyId,
          userId,
          'out',
          code,
          input.returnDate,
          c.childItemId,
          Math.round(input.qty * c.qtyPerSet),
          { code: c.childItemCode },
        );
      }
    } else {
      await moveReturnStock(
        tx,
        companyId,
        userId,
        'out',
        code,
        input.returnDate,
        line.itemId,
        input.qty,
      );
    }

    // 5) Bump line returned_qty
    const newReturned = line.returnedQty + input.qty;
    await tx
      .update(jobWorkOrderLines)
      .set({ returnedQty: newReturned, updatedAt: new Date(), updatedBy: userId })
      .where(eq(jobWorkOrderLines.id, line.id));

    // 6) Flip JWSO → dispatched once EVERY line is fully returned
    const siblings = await tx
      .select({
        id: jobWorkOrderLines.id,
        orderQty: jobWorkOrderLines.orderQty,
        returnedQty: jobWorkOrderLines.returnedQty,
      })
      .from(jobWorkOrderLines)
      .where(
        and(eq(jobWorkOrderLines.jobWorkOrderId, jw.id), isNull(jobWorkOrderLines.deletedAt)),
      );
    const allReturned = siblings.every((s) => {
      const eff = s.id === line.id ? newReturned : s.returnedQty;
      return eff >= s.orderQty;
    });
    if (allReturned) {
      await tx
        .update(jobWorkOrders)
        .set({ status: 'dispatched', updatedAt: new Date(), updatedBy: userId })
        .where(and(eq(jobWorkOrders.id, jw.id), isNull(jobWorkOrders.deletedAt)));
    }

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'JwReturnChallan',
        detail: `${code} — returned ${input.qty} to customer (${jw.code})`,
        refId: row.id,
      },
      companyId,
      user,
    );

    return rowToReturn(row);
  });
}

export async function cancelJwReturnChallan(
  id: string,
  user: AuthContext,
): Promise<JwReturnChallan> {
  // Reverses a JW Return Challan (mirrors delivery-challans.cancelDeliveryChallan).
  // Creating a return bumped job_work_order_lines.returned_qty and may have
  // flipped the JWSO to 'dispatched' once every line was fully returned — this
  // unwinds both.
  requireWriteRole(user);
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    const retRows = await tx
      .select()
      .from(jwReturnChallans)
      .where(
        and(
          eq(jwReturnChallans.id, id),
          eq(jwReturnChallans.companyId, companyId),
          isNull(jwReturnChallans.deletedAt),
        ),
      )
      .limit(1);
    const ret = retRows[0];
    if (!ret) throw new NotFoundError(`JW return challan ${id} not found`);
    if (ret.status === 'cancelled') {
      throw new ConflictError(`JW return challan ${ret.code} is already cancelled`);
    }

    // Lock the JW line before unwinding its returned_qty
    await tx.execute(
      sql`SELECT 1 FROM public.job_work_order_lines WHERE id = ${ret.jobWorkOrderLineId}::uuid FOR UPDATE`,
    );
    const lineRows = await tx
      .select({
        id: jobWorkOrderLines.id,
        returnedQty: jobWorkOrderLines.returnedQty,
        jwId: jobWorkOrderLines.jobWorkOrderId,
        itemId: jobWorkOrderLines.itemId,
      })
      .from(jobWorkOrderLines)
      .where(
        and(
          eq(jobWorkOrderLines.id, ret.jobWorkOrderLineId),
          eq(jobWorkOrderLines.companyId, companyId),
          isNull(jobWorkOrderLines.deletedAt),
        ),
      )
      .limit(1);
    const line = lineRows[0];
    if (!line) throw new NotFoundError(`Job Work Order line ${ret.jobWorkOrderLineId} not found`);

    // 0) ADR-106 — the goods never left, so put them back in own stock. Written
    // as a compensating 'in' row rather than deleting the 'out', so the ledger
    // keeps the full history (same as a cancelled customer dispatch). For an
    // assembly line that is one row per component, replayed from the ledger so
    // a BOM edited in the meantime cannot unbalance it.
    const moved = await returnedComponents(tx, companyId, ret.code);
    if (moved.length > 0) {
      for (const m of moved) {
        await moveReturnStock(
          tx,
          companyId,
          userId,
          'in',
          ret.code,
          dateLike(ret.returnDate),
          m.itemId,
          m.qty,
          { code: m.itemCode },
        );
      }
    } else {
      await moveReturnStock(
        tx,
        companyId,
        userId,
        'in',
        ret.code,
        dateLike(ret.returnDate),
        line.itemId,
        ret.qty,
      );
    }

    // 1) Mark the return cancelled
    const updated = await tx
      .update(jwReturnChallans)
      .set({ status: 'cancelled', updatedAt: new Date(), updatedBy: userId })
      .where(eq(jwReturnChallans.id, ret.id))
      .returning();
    const row = updated[0];
    if (!row) throw new ConflictError(`Failed to cancel JW return challan ${ret.code}`);

    // 2) DECREMENT the line's returned_qty by the return's qty (clamp at 0)
    const newReturned = Math.max(0, line.returnedQty - ret.qty);
    await tx
      .update(jobWorkOrderLines)
      .set({ returnedQty: newReturned, updatedAt: new Date(), updatedBy: userId })
      .where(eq(jobWorkOrderLines.id, line.id));

    // 3) Revert the JWSO header 'dispatched' → 'open' if it is no longer the
    // case that EVERY line is fully returned (reverse of the create flip).
    const jwRows = await tx
      .select({ id: jobWorkOrders.id, status: jobWorkOrders.status, code: jobWorkOrders.code })
      .from(jobWorkOrders)
      .where(and(eq(jobWorkOrders.id, line.jwId), isNull(jobWorkOrders.deletedAt)))
      .limit(1);
    const jw = jwRows[0];
    if (jw && jw.status === 'dispatched') {
      const siblings = await tx
        .select({
          id: jobWorkOrderLines.id,
          orderQty: jobWorkOrderLines.orderQty,
          returnedQty: jobWorkOrderLines.returnedQty,
        })
        .from(jobWorkOrderLines)
        .where(
          and(eq(jobWorkOrderLines.jobWorkOrderId, jw.id), isNull(jobWorkOrderLines.deletedAt)),
        );
      const allReturned = siblings.every((s) => {
        const eff = s.id === line.id ? newReturned : s.returnedQty;
        return eff >= s.orderQty;
      });
      if (!allReturned) {
        await tx
          .update(jobWorkOrders)
          .set({ status: 'open', updatedAt: new Date(), updatedBy: userId })
          .where(and(eq(jobWorkOrders.id, jw.id), isNull(jobWorkOrders.deletedAt)));
      }
    }

    await emitActivityLog(
      tx,
      {
        action: 'JW_RETURN_CANCEL',
        entity: 'JwReturnChallan',
        detail: `${ret.code} — cancelled, reversed ${ret.qty} on ${ret.jwCodeText ?? jw?.code ?? ''}`,
        refId: ret.id,
      },
      companyId,
      user,
    );

    return rowToReturn(row);
  });
}

export async function listJwReturnChallans(
  user: AuthContext,
): Promise<ListJwReturnChallansResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        ret: jwReturnChallans,
        clientName: clients.name,
        partName: jobWorkOrderLines.partName,
      })
      .from(jwReturnChallans)
      .leftJoin(clients, eq(clients.id, jwReturnChallans.clientId))
      .leftJoin(jobWorkOrderLines, eq(jobWorkOrderLines.id, jwReturnChallans.jobWorkOrderLineId))
      .where(and(eq(jwReturnChallans.companyId, companyId), isNull(jwReturnChallans.deletedAt)))
      .orderBy(desc(jwReturnChallans.returnDate), desc(jwReturnChallans.code))
      .limit(500);
    return {
      items: rows.map((r) => ({
        ...rowToReturn(r.ret),
        clientName: r.clientName ?? null,
        partName: r.partName ?? null,
      })),
      total: rows.length,
    };
  });
}
