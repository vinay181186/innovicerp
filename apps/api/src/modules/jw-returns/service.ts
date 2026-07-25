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
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
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

/** Produced = terminal QC-accepted qty summed over the JW line's Job Cards. */
async function producedForLine(tx: DbTransaction, lineId: string): Promise<number> {
  const rows = (await tx.execute(sql`
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
      WHERE jc.source_jw_line_id = ${lineId}::uuid AND jc.deleted_at IS NULL
      ORDER BY jc.id, vs.op_seq DESC
    ) x
  `)) as unknown as Array<{ produced: number | string }>;
  return Number(rows[0]?.produced ?? 0);
}

function rowToReturn(row: typeof jwReturnChallans.$inferSelect): JwReturnChallan {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
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
