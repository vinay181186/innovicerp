// ADR-324 line undo (P1) — on TEST:
//   · a plan steps back, no cascade: cancelling its Direct Purchase PR puts it
//     back to Planned (dp_pr_id cleared); cancelling the Job Card its Execute
//     made puts it back to Planned (jc_id cleared);
//   · the Undo list of a JWSO line lists the Party GRN steps newest first, and
//     the run endpoint refuses a step that is not the first, and refuses a
//     caller without the Undo chain right (canUndoChain — never a role).
// The right is granted to the seed admin for the run case through
// user_access.undo_chain (the column the access terminal adds) and restored.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, like, notLike, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  cancelRequests,
  clients,
  items,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  partyGrn,
  partyGrnLines,
  partyMaterials,
  partyStockLedger,
  plans,
  purchaseRequests,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError } from '../../lib/errors';
import { requestCancel } from '../cancel-requests/service';
import { createPartyGrn } from '../party-grn/service';
import { qcPartyGrn } from '../party-grn/qc';
import { getJwLineUndoList, runJwLineUndoStep } from './service';

const P = `TLUS${Date.now().toString(36).slice(-5).toUpperCase()}-`;
const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const reason = 'ADR-324 test';

let admin: AuthContext;
let itemId: string;
let clientId: string;
let jwId: string;
let jwLineId: string;
let pmId: string;
let hadUndoChain: boolean | null = null;

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  const companyId = u.companyId;
  itemId = (
    await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(eq(items.companyId, companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
      )
      .orderBy(asc(items.createdAt))
      .limit(1)
  )[0]!.id;
  clientId = (
    await db
      .insert(clients)
      .values({
        companyId,
        code: `${P}CLI`,
        name: 'Undo list client',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;
  jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId,
        code: `${P}JW`,
        jwDate: '2026-11-26',
        clientId,
        customerName: 'Undo list client',
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;
  pmId = (
    await db
      .insert(partyMaterials)
      .values({
        companyId,
        code: `${P}PM`,
        name: 'Undo list material',
        uom: 'NOS',
        clientId,
        itemId,
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;
  jwLineId = (
    await db
      .insert(jobWorkOrderLines)
      .values({
        companyId,
        jobWorkOrderId: jwId,
        lineNo: 1,
        itemId,
        partyMaterialId: pmId,
        partName: `${P}PART`,
        uom: 'NOS',
        orderQty: 50,
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;
  const prev = (await db.execute(sql`
    SELECT undo_chain AS v FROM public.user_access WHERE user_id = ${u.id}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ v: boolean | null }>;
  hadUndoChain = prev[0]?.v ?? null;
});

afterAll(async () => {
  if (hadUndoChain !== null) {
    await db.execute(sql`
      UPDATE public.user_access SET undo_chain = ${hadUndoChain}
       WHERE user_id = ${admin.id}::uuid AND deleted_at IS NULL
    `);
  }
  const grnIds = (
    await db.select({ id: partyGrn.id }).from(partyGrn).where(eq(partyGrn.jobWorkOrderId, jwId))
  ).map((g) => g.id);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('innovic.ledger_maintenance', 'on', true)`);
    await tx.delete(partyStockLedger).where(eq(partyStockLedger.partyMaterialId, pmId));
  });
  if (grnIds.length > 0) {
    const lineIds = (
      await db
        .select({ id: partyGrnLines.id })
        .from(partyGrnLines)
        .where(inArray(partyGrnLines.partyGrnId, grnIds))
    ).map((l) => l.id);
    await db.delete(cancelRequests).where(inArray(cancelRequests.docId, [...lineIds, ...grnIds]));
    await db.delete(partyGrnLines).where(inArray(partyGrnLines.partyGrnId, grnIds));
    await db.delete(partyGrn).where(inArray(partyGrn.id, grnIds));
  }
  await db.delete(cancelRequests).where(like(cancelRequests.docCode, `${P}%`));
  await db.delete(plans).where(like(plans.code, `${P}%`));
  await db.delete(jobCards).where(like(jobCards.code, `${P}%`));
  await db.delete(purchaseRequests).where(like(purchaseRequests.code, `${P}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${P}%`));
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, jwId));
  await db.delete(partyMaterials).where(eq(partyMaterials.id, pmId));
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
  await db.delete(clients).where(eq(clients.id, clientId));
});

const planRow = async (id: string) =>
  (
    (await db.execute(sql`
      SELECT plan_status::text AS status, dp_pr_id AS "dpPrId", jc_id AS "jcId"
        FROM public.plans WHERE id = ${id}::uuid
    `)) as unknown as Array<{ status: string; dpPrId: string | null; jcId: string | null }>
  )[0]!;

describe('ADR-324 — a plan steps back when its PR / Job Card is cancelled', () => {
  it('PR cancelled → its Direct Purchase plan is Planned again', async () => {
    const c = admin.companyId!;
    const pr = (
      (await db.execute(sql`
        INSERT INTO public.purchase_requests (company_id, code, pr_date, qty, created_by, updated_by)
        VALUES (${c}::uuid, ${`${P}PR`}, '2026-11-26', 5, ${admin.id}::uuid, ${admin.id}::uuid)
        RETURNING id
      `)) as unknown as Array<{ id: string }>
    )[0]!;
    const plan = (
      (await db.execute(sql`
        INSERT INTO public.plans (company_id, code, plan_date, plan_type, plan_status, order_qty,
                                  plan_qty, item_id, dp_pr_id, created_by, updated_by)
        VALUES (${c}::uuid, ${`${P}PLN-DP`}, '2026-11-26', 'direct_purchase', 'pr_created', 5, 5,
                ${itemId}::uuid, ${pr.id}::uuid, ${admin.id}::uuid, ${admin.id}::uuid)
        RETURNING id
      `)) as unknown as Array<{ id: string }>
    )[0]!;
    await requestCancel('purchase_request', pr.id, { reason, approveNow: true }, admin);
    const p = await planRow(plan.id);
    expect(p.status).toBe('planned');
    expect(p.dpPrId).toBeNull();
  });

  it('Execute Job Card cancelled → its plan is Planned again (no plan blocker)', async () => {
    const c = admin.companyId!;
    const jc = (
      await db
        .insert(jobCards)
        .values({
          companyId: c,
          code: `${P}JC`,
          jcDate: '2026-11-26',
          itemId,
          orderQty: 5,
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning()
    )[0]!;
    const plan = (
      (await db.execute(sql`
        INSERT INTO public.plans (company_id, code, plan_date, plan_type, plan_status, order_qty,
                                  plan_qty, item_id, jc_id, created_by, updated_by)
        VALUES (${c}::uuid, ${`${P}PLN-JC`}, '2026-11-26', 'manufacture', 'jc_created', 5, 5,
                ${itemId}::uuid, ${jc.id}::uuid, ${admin.id}::uuid, ${admin.id}::uuid)
        RETURNING id
      `)) as unknown as Array<{ id: string }>
    )[0]!;
    const res = await requestCancel('job_card', jc.id, { reason, approveNow: true }, admin);
    expect(res.cancelled).toBe(true);
    const p = await planRow(plan.id);
    expect(p.status).toBe('planned');
    expect(p.jcId).toBeNull();
  });
});

describe('ADR-324 — the Undo list of a JWSO line', () => {
  it('refuses a caller without the Undo chain right', async () => {
    const nobody: AuthContext = { ...admin, id: randomUUID(), role: 'manager' };
    await expect(
      runJwLineUndoStep(jwId, jwLineId, { stepKey: 'x', reason }, nobody),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('lists Reverse QC before the GRN cancel, and refuses the second step first', async () => {
    await db.execute(sql`
      UPDATE public.user_access SET undo_chain = true
       WHERE user_id = ${admin.id}::uuid AND deleted_at IS NULL
    `);
    const grn = await createPartyGrn(
      {
        grnDate: '2026-11-26',
        jobWorkOrderId: jwId,
        dcNo: `DC-${randomUUID()}`,
        lines: [{ jwLineId, receivedQty: 5 }],
      },
      admin,
    );
    const lineId = (
      await db
        .select({ id: partyGrnLines.id })
        .from(partyGrnLines)
        .where(eq(partyGrnLines.partyGrnId, grn.id))
    )[0]!.id;
    await qcPartyGrn(grn.id, { lines: [{ lineId, acceptedQty: 5, rejectedQty: 0 }] }, admin);

    const list = await getJwLineUndoList(jwId, jwLineId, admin);
    expect(list.canUndo).toBe(true);
    expect(list.steps.map((s) => s.key)).toEqual([
      `cancel:party_grn_line_qc:${lineId}`,
      `cancel:party_grn:${grn.id}`,
    ]);
    await expect(
      runJwLineUndoStep(jwId, jwLineId, { stepKey: list.steps[1]!.key, reason }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      runJwLineUndoStep(jwId, jwLineId, { stepKey: list.steps[1]!.key, reason }, admin),
    ).rejects.toThrow(/Do .* first/);

    const done = await runJwLineUndoStep(
      jwId,
      jwLineId,
      { stepKey: list.steps[0]!.key, reason },
      admin,
    );
    expect(done.outcome).toBe('done');
    const after = await getJwLineUndoList(jwId, jwLineId, admin);
    expect(after.steps.map((s) => s.key)).toEqual([`cancel:party_grn:${grn.id}`]);
  });
});
