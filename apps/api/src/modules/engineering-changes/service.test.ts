// ADR-291 Step 4 — Engineering Change (ECR) on TEST, the owner's PDF case:
//   a 20-piece Job Card on ABC/1 with 10 finished, 6 in progress, 4 not
//   started → submit holds its ops; 3 sign-offs approve; implement moves the 4
//   to a NEW PRO + Job Card on ABC/2 and the old card keeps 16 on ABC/1.
// Plus: the raiser cannot sign; one person gives only one of the three
// sign-offs; an untouched order moves whole (old PRO short closed); two sign-offs for the same role at once → one
// wins; two moves of the same not-started pieces at once → one wins and the
// order never drops below what was started (§20.3); a plain line Rev change
// with an open Job Card is refused; reject lifts the holds.
// Runs on TEST only (prefix TECR-).

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  itemRevisions,
  items,
  plans,
  routeCardOps,
  routeCards,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, ValidationError } from '../../lib/errors';
import { assertJcOpWorkable, placeOpHolds, readOpHolds } from '../../lib/jc-op-hold';
import { applyLineRevChange } from '../item-revisions/line-rev';
import { startOp, stopOp, submitOpLog } from '../op-entry/service';
import { reduceProductionOrderQty } from '../production-orders/reduce-qty';
import * as proService from '../production-orders/service';
import { implementEcr } from './implement';
import { createEcr, getEcr } from './service';
import { decideEcr, setEcrDispositions, submitEcr } from './workflow';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TECR-';

let admin: AuthContext;
let companyId: string;
let otherUserId: string;
/** Two more signers — SOP: one person gives only one of the three sign-offs. */
let signerB: AuthContext;
let signerC: AuthContext;

interface Part {
  itemId: string;
  rev1: string;
  rev2: string;
  soId: string;
  lineId: string;
  planId: string;
  poId: string;
  jcId: string;
}

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE ids uuid[];
    BEGIN
      SELECT array_agg(id) INTO ids FROM public.items WHERE code LIKE 'TECR-%';
      IF ids IS NULL THEN RETURN; END IF;
      UPDATE public.jc_ops SET hold_kind = NULL, hold_reason = NULL, held_at = NULL,
             held_by = NULL, hold_ecr_id = NULL
       WHERE job_card_id IN (SELECT id FROM public.job_cards WHERE item_id = ANY(ids));
      DELETE FROM public.rev_substitution_uses WHERE substitution_id IN (
        SELECT id FROM public.rev_substitutions WHERE item_id = ANY(ids));
      DELETE FROM public.rev_substitutions WHERE item_id = ANY(ids);
      DELETE FROM public.engineering_change_approvals
       WHERE ecr_id IN (SELECT id FROM public.engineering_changes WHERE item_id = ANY(ids));
      DELETE FROM public.engineering_change_impacts
       WHERE ecr_id IN (SELECT id FROM public.engineering_changes WHERE item_id = ANY(ids));
      DELETE FROM public.activity_log
       WHERE entity_id IN (SELECT id FROM public.engineering_changes WHERE item_id = ANY(ids));
      DELETE FROM public.engineering_changes WHERE item_id = ANY(ids);
      DELETE FROM public.op_log WHERE jc_op_id IN (
        SELECT o.id FROM public.jc_ops o JOIN public.job_cards j ON j.id = o.job_card_id
         WHERE j.item_id = ANY(ids));
      DELETE FROM public.activity_log WHERE entity_id IN (
        SELECT id FROM public.job_cards WHERE item_id = ANY(ids)
        UNION SELECT id FROM public.production_orders WHERE item_id = ANY(ids)
        UNION SELECT id FROM public.plans WHERE item_id = ANY(ids)
        UNION SELECT id FROM public.sales_orders WHERE code LIKE 'TECR-%');
      UPDATE public.job_cards SET production_order_id = NULL WHERE item_id = ANY(ids);
      DELETE FROM public.production_orders WHERE item_id = ANY(ids);
      DELETE FROM public.plans WHERE item_id = ANY(ids);
      DELETE FROM public.jc_ops WHERE job_card_id IN (SELECT id FROM public.job_cards WHERE item_id = ANY(ids));
      DELETE FROM public.job_cards WHERE item_id = ANY(ids);
      DELETE FROM public.item_revision_changes WHERE from_item_revision_id IN (
        SELECT id FROM public.item_revisions WHERE item_id = ANY(ids));
      DELETE FROM public.sales_order_lines WHERE item_id = ANY(ids);
      DELETE FROM public.sales_orders WHERE code LIKE 'TECR-%';
      DELETE FROM public.route_card_ops WHERE route_card_id IN (
        SELECT id FROM public.route_cards WHERE item_id = ANY(ids));
      DELETE FROM public.route_cards WHERE item_id = ANY(ids);
      DELETE FROM public.item_revision_drawings WHERE item_revision_id IN (
        SELECT id FROM public.item_revisions WHERE item_id = ANY(ids));
      DELETE FROM public.item_revisions WHERE item_id = ANY(ids);
      DELETE FROM public.activity_log WHERE ref_id LIKE 'TECR-%';
      DELETE FROM public.items WHERE id = ANY(ids);
    END $$`);
}

async function card(item: string, rev: string, key: string): Promise<void> {
  const [rc] = await db
    .insert(routeCards)
    .values({
      companyId,
      code: `${P}RC-${key}`,
      itemId: item,
      itemRevisionId: rev,
      approvalStatus: 'approved',
      rawMaterialGradeText: 'EN8',
      rawMaterialSizeText: 'DIA 40',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: routeCards.id });
  for (const [seq, op] of [
    // Stored op_seq 1, 2 (shown as Op 10, 20) — v_jc_op_status's first op is op_seq 1.
    [1, 'Turning'],
    [2, 'Milling'],
  ] as const) {
    await db.insert(routeCardOps).values({
      companyId,
      routeCardId: rc!.id,
      opSeq: seq,
      operation: op,
      opType: 'process',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
  }
}

/** Item + Revs 1 (verified) / 2 (verified), cards for both, an SO line on
 *  Rev 1, a plan and a PRO for `qty` on Rev 1. */
async function makePart(key: string, qty: number): Promise<Part> {
  const [it] = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}${key}`,
      name: `ECR test ${key}`,
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      procurementType: 'make',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  const rev = async (r: string) =>
    (
      await db
        .insert(itemRevisions)
        .values({
          companyId,
          itemId: it!.id,
          rev: r,
          sourceType: 'legacy',
          sourceRef: `${P}test`,
          releaseStatus: 'verified',
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning({ id: itemRevisions.id })
    )[0]!.id;
  const rev1 = await rev('1');
  const rev2 = await rev('2');
  await card(it!.id, rev1, `${key}-1`);
  await card(it!.id, rev2, `${key}-2`);
  const [so] = await db
    .insert(salesOrders)
    .values({
      companyId,
      code: `${P}SO-${key}`,
      soDate: '2026-11-14',
      type: 'component_manufacturing',
      createdBy: admin.id,
      updatedBy: admin.id,
    } as never)
    .returning({ id: salesOrders.id });
  const [line] = await db
    .insert(salesOrderLines)
    .values({
      companyId,
      salesOrderId: so!.id,
      lineNo: 1,
      itemId: it!.id,
      partName: 'part',
      revision: '1',
      uom: 'NOS',
      orderQty: qty,
      itemRevisionId: rev1,
      createdBy: admin.id,
      updatedBy: admin.id,
    } as never)
    .returning({ id: salesOrderLines.id });
  const [pl] = await db
    .insert(plans)
    .values({
      companyId,
      code: `${P}PLN-${key}`,
      planDate: '2026-11-14',
      planStatus: 'planned',
      planType: 'manufacture',
      opsSource: 'route_card',
      soLineId: line!.id,
      itemId: it!.id,
      itemRevisionId: rev1,
      itemCodeText: `${P}${key}`,
      orderQty: qty,
      planQty: qty,
      rawMaterialGradeText: 'EN8',
      rawMaterialSizeText: 'DIA 40',
      createdBy: admin.id,
      updatedBy: admin.id,
    } as never)
    .returning({ id: plans.id });
  const rc1 = (
    await db
      .select({ id: routeCards.id })
      .from(routeCards)
      .where(eq(routeCards.code, `${P}RC-${key}-1`))
  )[0]!.id;
  const po = await proService.createProductionOrder(
    {
      planId: pl!.id,
      routeCardId: rc1,
      targetDate: '2026-11-30',
      orderQty: qty,
      rawMaterialAvailable: true,
    },
    admin,
  );
  return {
    itemId: it!.id,
    rev1,
    rev2,
    soId: so!.id,
    lineId: line!.id,
    planId: pl!.id,
    poId: po.id,
    jcId: po.jobCardId,
  };
}

/** Log work: op 1 completes `first`, every later op `rest` (QC ops accept). */
async function logWork(jcId: string, first: number, rest: number): Promise<void> {
  const ops = (await db.execute(sql`
    SELECT id, op_type::text AS "opType" FROM public.jc_ops
     WHERE job_card_id = ${jcId}::uuid AND deleted_at IS NULL ORDER BY op_seq`)) as unknown as Array<{
    id: string;
    opType: string;
  }>;
  let n = 0;
  for (const [i, op] of ops.entries()) {
    const qty = i === 0 ? first : rest;
    n += 1;
    await db.execute(sql`
      INSERT INTO public.op_log (company_id, jc_op_id, log_no, log_type, log_date, shift, qty,
                                 created_by)
      VALUES (${companyId}::uuid, ${op.id}::uuid, ${`${P}L-${jcId.slice(0, 8)}-${n}`},
              ${op.opType === 'qc' ? 'qc' : 'complete'}::op_log_type, '2026-11-14', 'day', ${qty},
              ${admin.id}::uuid)`);
  }
}

const heldOps = async (jcId: string): Promise<number> =>
  Number(
    (
      (await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM public.jc_ops
         WHERE job_card_id = ${jcId}::uuid AND hold_kind IS NOT NULL`)) as unknown as Array<{
        n: number;
      }>
    )[0]!.n,
  );

/** Hand the ECR to another raiser so the admin may sign it. */
const reassignRaiser = (ecrId: string) =>
  db.execute(sql`
    UPDATE public.engineering_changes SET created_by = ${otherUserId}::uuid,
           submitted_by = ${otherUserId}::uuid WHERE id = ${ecrId}::uuid`);

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u?.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  const other = (await db.execute(sql`
    SELECT id, email, is_active AS "isActive" FROM public.users
     WHERE company_id = ${companyId}::uuid AND id <> ${u.id}::uuid
     ORDER BY created_at LIMIT 3`)) as unknown as Array<{
    id: string;
    email: string;
    isActive: boolean;
  }>;
  if (other.length < 3) throw new Error('TEST needs 3 other users');
  otherUserId = other[0]!.id;
  // Admin-tier contexts for two real TEST users (the sign-off right is not
  // what these tests prove).
  const asAdmin = (o: { id: string; email: string; isActive: boolean }): AuthContext => ({
    id: o.id,
    email: o.email,
    companyId,
    role: 'admin',
    isActive: o.isActive,
  });
  signerB = asAdmin(other[1]!);
  signerC = asAdmin(other[2]!);
  await cleanup();
});

afterAll(cleanup);

describe('ADR-291 Engineering Change', () => {
  it('PDF case: 20 = 10 done + 6 WIP + 4 not started → hold, 3 sign-offs, implement moves 4 to Rev 2', async () => {
    const p = await makePart('PDF', 20);
    await logWork(p.jcId, 16, 10);

    // F — a plain Rev change on the line is refused while the Job Card is open.
    await expect(
      withUserContext(admin, (tx) =>
        applyLineRevChange(tx, admin, companyId, {
          kind: 'so',
          orderId: p.soId,
          docCode: `${P}SO-PDF`,
          lineId: p.lineId,
          lineNo: 1,
          itemId: p.itemId,
          fromId: p.rev1,
          toId: p.rev2,
          reason: 'Customer sent Rev 2',
        }),
      ),
    ).rejects.toThrow(
      `Ln 1: ${P}PDF/1 has work in progress — raise an Engineering Change (ECR) to move it to ${P}PDF/2.`,
    );

    const draft = await createEcr(
      {
        itemId: p.itemId,
        fromItemRevisionId: p.rev1,
        toItemRevisionId: p.rev2,
        replacementItemId: null,
        classification: 'interchangeable',
        description: 'Customer Rev 2: hole moved 2 mm',
        customerApproval: 'not_required',
        customerApprovalRef: null,
      },
      admin,
    );
    expect(draft.code).toMatch(/^IN-ECR-\d{5}$/);
    const sub = await submitEcr(
      draft.id,
      { expectedUpdatedAt: draft.updatedAt, holdAffectedWork: true },
      admin,
    );
    expect(sub.status).toBe('submitted');
    const jcImpact = sub.impacts.find((m) => m.docType === 'job_card')!;
    expect(jcImpact).toMatchObject({ qtyDone: 10, qtyWip: 6, qtyNotStarted: 4 });
    expect(jcImpact.disposition).toBe('decide_later');
    expect(sub.impacts.some((m) => m.docType === 'so_line')).toBe(true);
    // Op 1 has 4 left, op 2 has 6 to do → both held (QC op not complete either).
    expect(await heldOps(p.jcId)).toBeGreaterThanOrEqual(2);
    // The hold names the ECR once: "… is on hold (ECR IN-ECR-00001) — release …".
    const [heldOp] = (await db.execute(sql`
      SELECT id FROM public.jc_ops WHERE job_card_id = ${p.jcId}::uuid AND hold_kind IS NOT NULL
       ORDER BY op_seq LIMIT 1`)) as unknown as Array<{ id: string }>;
    const holdErr = await withUserContext(admin, (tx) =>
      assertJcOpWorkable(tx, companyId, heldOp!.id),
    ).catch((e: Error) => e);
    expect((holdErr as Error).message).toContain(
      `is on hold (ECR ${draft.code}) — release the hold first.`,
    );
    const holdInfo = await withUserContext(admin, (tx) => readOpHolds(tx, companyId, [heldOp!.id]));
    expect(holdInfo.get(heldOp!.id)?.holdReason).toBe(`ECR ${draft.code}`);

    // Self-approval refused.
    await expect(
      decideEcr(sub.id, { role: 'design', decision: 'approved' }, admin),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await reassignRaiser(sub.id);

    const set = await setEcrDispositions(
      sub.id,
      {
        expectedUpdatedAt: (await getEcr(sub.id, admin)).updatedAt,
        impacts: [{ id: jcImpact.id, disposition: 'move_new', moveQty: 5, note: null }],
      },
      admin,
    ).catch((e: unknown) => e);
    expect(set).toBeInstanceOf(ValidationError); // 5 > 4 not started
    await setEcrDispositions(
      sub.id,
      {
        expectedUpdatedAt: (await getEcr(sub.id, admin)).updatedAt,
        impacts: [{ id: jcImpact.id, disposition: 'move_new', moveQty: 4, note: null }],
      },
      admin,
    );

    // Two sign-offs for the same role at once → exactly one wins.
    const both = await Promise.allSettled([
      decideEcr(sub.id, { role: 'qc', decision: 'approved' }, admin),
      decideEcr(sub.id, { role: 'qc', decision: 'approved' }, admin),
    ]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    expect(String(lost.reason.message)).toMatch(/^Quality already decided by /);

    // One person, one sign-off: the Quality signer cannot also sign Engineering.
    const twice = await decideEcr(sub.id, { role: 'design', decision: 'approved' }, admin).catch(
      (e: unknown) => e,
    );
    expect(twice).toBeInstanceOf(ConflictError);
    expect((twice as Error).message).toBe(`${admin.email} already signed this ECR as Quality`);

    await decideEcr(sub.id, { role: 'design', decision: 'approved' }, signerB);
    // signerB has signed Engineering — Operations must be a third person.
    await expect(
      decideEcr(sub.id, { role: 'production', decision: 'approved' }, signerB),
    ).rejects.toThrow(/already signed this ECR as /);
    const ok = await decideEcr(sub.id, { role: 'production', decision: 'approved' }, signerC);
    expect(ok.status).toBe('approved');

    const done = await implementEcr(sub.id, { expectedUpdatedAt: ok.updatedAt }, admin);
    // move_new: this ECR's holds on the old card are lifted (the 16 left carry
    // on at Rev 1), so no hold is left and the ECR closes.
    expect(done.status).toBe('closed');
    expect(await heldOps(p.jcId)).toBe(0);
    const moved = done.impacts.find((m) => m.docType === 'job_card')!;
    expect(moved.newJobCardId).toBeTruthy();

    const rows = (await db.execute(sql`
      SELECT jc.id, jc.order_qty AS "jcQty", jc.item_revision_id AS rev, po.order_qty AS "poQty"
        FROM public.job_cards jc JOIN public.production_orders po ON po.id = jc.production_order_id
       WHERE jc.id IN (${p.jcId}::uuid, ${moved.newJobCardId}::uuid)`)) as unknown as Array<{
      id: string;
      jcQty: number;
      rev: string;
      poQty: number;
    }>;
    const oldJc = rows.find((r) => r.id === p.jcId)!;
    const newJc = rows.find((r) => r.id === moved.newJobCardId)!;
    expect(oldJc).toMatchObject({ jcQty: 16, poQty: 16, rev: p.rev1 });
    expect(newJc).toMatchObject({ jcQty: 4, poQty: 4, rev: p.rev2 });
    const line = (
      await db
        .select({ rev: salesOrderLines.itemRevisionId, text: salesOrderLines.revision })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, p.lineId))
    )[0]!;
    expect(line).toEqual({ rev: p.rev2, text: '2' });

    // A second implement is refused (conditional approved → implemented).
    await expect(implementEcr(sub.id, {}, admin)).rejects.toBeInstanceOf(ConflictError);
  }, 240_000);

  it('nothing started: moving the WHOLE order short closes the old PRO and opens one on Rev 2', async () => {
    const p = await makePart('WHOLE', 5);
    const d = await createEcr(
      {
        itemId: p.itemId,
        fromItemRevisionId: p.rev1,
        toItemRevisionId: p.rev2,
        replacementItemId: null,
        classification: 'interchangeable',
        description: 'Customer Rev 2 before any work',
        customerApproval: 'not_required',
        customerApprovalRef: null,
      },
      admin,
    );
    const s = await submitEcr(
      d.id,
      { expectedUpdatedAt: d.updatedAt, holdAffectedWork: true },
      admin,
    );
    expect(await heldOps(p.jcId)).toBeGreaterThan(0);
    await reassignRaiser(s.id);
    const jcImpact = s.impacts.find((m) => m.docType === 'job_card')!;
    expect(jcImpact.qtyNotStarted).toBe(5);
    await setEcrDispositions(
      s.id,
      {
        expectedUpdatedAt: (await getEcr(s.id, admin)).updatedAt,
        impacts: [{ id: jcImpact.id, disposition: 'move_new', moveQty: 5, note: null }],
      },
      admin,
    );
    await decideEcr(s.id, { role: 'design', decision: 'approved' }, admin);
    await decideEcr(s.id, { role: 'qc', decision: 'approved' }, signerB);
    const ok = await decideEcr(s.id, { role: 'production', decision: 'approved' }, signerC);
    const done = await implementEcr(s.id, { expectedUpdatedAt: ok.updatedAt }, admin);
    // The stopped card's holds are lifted, so the ECR closes at once.
    expect(done.status).toBe('closed');
    expect(await heldOps(p.jcId)).toBe(0);
    const moved = done.impacts.find((m) => m.docType === 'job_card')!;
    const rows = (await db.execute(sql`
      SELECT po.id, po.status::text AS status, po.order_qty AS "poQty", jc.item_revision_id AS rev,
             jc.closed_at IS NOT NULL AS "jcClosed", po.short_close_reason AS reason
        FROM public.production_orders po JOIN public.job_cards jc ON jc.id = po.job_card_id
       WHERE po.plan_id = ${p.planId}::uuid AND po.deleted_at IS NULL`)) as unknown as Array<{
      id: string;
      status: string;
      poQty: number;
      rev: string;
      jcClosed: boolean;
      reason: string | null;
    }>;
    expect(rows).toHaveLength(2);
    const oldPo = rows.find((r) => r.id === p.poId)!;
    const newPo = rows.find((r) => r.id !== p.poId)!;
    expect(oldPo).toMatchObject({ status: 'short_closed', poQty: 5, rev: p.rev1, jcClosed: true });
    expect(oldPo.reason).toMatch(/^ECR IN-ECR-\d{5}: all 5 moved to /);
    expect(newPo).toMatchObject({ status: 'open', poQty: 5, rev: p.rev2, jcClosed: false });
    expect(moved.newJobCardId).toBeTruthy();
  }, 240_000);

  it('decide_later keeps its holds on implement → ECR stays Implemented', async () => {
    const p = await makePart('LATER', 6);
    await logWork(p.jcId, 2, 0);
    const d = await createEcr(
      {
        itemId: p.itemId,
        fromItemRevisionId: p.rev1,
        toItemRevisionId: p.rev2,
        replacementItemId: null,
        classification: 'interchangeable',
        description: 'Customer Rev 2, card decided later',
        customerApproval: 'not_required',
        customerApprovalRef: null,
      },
      admin,
    );
    const s = await submitEcr(
      d.id,
      { expectedUpdatedAt: d.updatedAt, holdAffectedWork: true },
      admin,
    );
    const held = await heldOps(p.jcId);
    expect(held).toBeGreaterThan(0);
    await reassignRaiser(s.id);
    await decideEcr(s.id, { role: 'design', decision: 'approved' }, admin);
    await decideEcr(s.id, { role: 'qc', decision: 'approved' }, signerB);
    const ok = await decideEcr(s.id, { role: 'production', decision: 'approved' }, signerC);
    const done = await implementEcr(s.id, { expectedUpdatedAt: ok.updatedAt }, admin);
    expect(done.status).toBe('implemented');
    expect(await heldOps(p.jcId)).toBe(held);
  }, 240_000);

  it('hold on a running op: Stop records pieces of a session started BEFORE the hold; new work refused', async () => {
    const p = await makePart('STOP', 6);
    const [op1] = (await db.execute(sql`
      SELECT id FROM public.jc_ops WHERE job_card_id = ${p.jcId}::uuid AND deleted_at IS NULL
       ORDER BY op_seq LIMIT 1`)) as unknown as Array<{ id: string }>;
    // A session that began an hour ago (inserted as Start would, no machine).
    const session = async (startedAt: string) =>
      (
        (await db.execute(sql`
          INSERT INTO public.running_ops (company_id, jc_op_id, operator_name, start_date, start_time,
                                          shift, status, created_at, created_by, updated_by)
          VALUES (${companyId}::uuid, ${op1!.id}::uuid, 'ECR test', '2026-11-14', '08:00', 'day',
                  'running', ${startedAt}::timestamptz, ${admin.id}::uuid, ${admin.id}::uuid)
          RETURNING id`)) as unknown as Array<{ id: string }>
      )[0]!.id;
    const before = await session(new Date(Date.now() - 3_600_000).toISOString());
    await withUserContext(admin, (tx) =>
      placeOpHolds(tx, {
        companyId,
        jcOpIds: [op1!.id],
        kind: 'manual',
        ecrId: null,
        reason: `${P}hold while running`,
        userId: admin.id,
      }),
    );
    const stop = (id: string, qty: number) =>
      stopOp(
        id,
        {
          qty,
          rejectQty: 0,
          logDate: '2026-11-14',
          logTime: '09:00',
          shift: 'day',
          operatorName: 'ECR test',
        },
        admin,
      );
    // The pieces made before the hold are recorded.
    await stop(before, 2);
    const [logged] = (await db.execute(sql`
      SELECT COALESCE(SUM(qty), 0)::int AS n FROM public.op_log
       WHERE jc_op_id = ${op1!.id}::uuid AND log_type = 'complete'`)) as unknown as Array<{
      n: number;
    }>;
    expect(logged!.n).toBe(2);
    // A session started after the hold cannot record.
    const after = await session(new Date(Date.now() + 60_000).toISOString());
    await expect(stop(after, 1)).rejects.toThrow(/is on hold/);
    await db.execute(
      sql`UPDATE public.running_ops SET status = 'stopped' WHERE id = ${after}::uuid`,
    );
    // A fresh Op Entry and a new Start stay refused.
    await expect(
      submitOpLog(
        {
          jcOpId: op1!.id,
          qty: 1,
          rejectQty: 0,
          logDate: '2026-11-14',
          shift: 'day',
          operatorName: 'ECR test',
        } as never,
        admin,
      ),
    ).rejects.toThrow(/is on hold/);
    await expect(
      startOp(
        {
          jcOpId: op1!.id,
          startDate: '2026-11-14',
          startTime: '10:00',
          shift: 'day',
          operatorName: 'ECR test',
        },
        admin,
      ),
    ).rejects.toThrow(/is on hold/);
  }, 180_000);

  it('two moves of the same not-started pieces at once → one wins; never below started (§20.3)', async () => {
    const p = await makePart('RACE', 10);
    await logWork(p.jcId, 6, 0); // 6 started on op 1, 4 not started
    const move = () =>
      withUserContext(admin, (tx) =>
        reduceProductionOrderQty(tx, {
          companyId,
          productionOrderId: p.poId,
          qty: 3,
          reason: `${P}race`,
          user: admin,
        }),
      );
    const res = await Promise.allSettled([move(), move()]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [po] = (await db.execute(sql`
      SELECT order_qty AS q FROM public.production_orders WHERE id = ${p.poId}::uuid`)) as unknown as Array<{
      q: number;
    }>;
    expect(po!.q).toBe(7);
    expect(po!.q).toBeGreaterThanOrEqual(6);
  }, 180_000);

  it('reject lifts the holds; the raiser decides nothing', async () => {
    const p = await makePart('REJ', 8);
    await logWork(p.jcId, 3, 0);
    const d = await createEcr(
      {
        itemId: p.itemId,
        fromItemRevisionId: p.rev1,
        toItemRevisionId: p.rev2,
        replacementItemId: null,
        classification: 'interchangeable',
        description: 'Customer Rev 2 under review',
        customerApproval: 'pending',
        customerApprovalRef: null,
      },
      admin,
    );
    const s = await submitEcr(
      d.id,
      { expectedUpdatedAt: d.updatedAt, holdAffectedWork: true },
      admin,
    );
    expect(await heldOps(p.jcId)).toBeGreaterThan(0);
    await reassignRaiser(s.id);
    await expect(
      decideEcr(s.id, { role: 'production', decision: 'rejected', note: 'no' }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
    const r = await decideEcr(
      s.id,
      { role: 'production', decision: 'rejected', note: 'Customer withdrew Rev 2' },
      admin,
    );
    expect(r.status).toBe('rejected');
    expect(await heldOps(p.jcId)).toBe(0);
  }, 180_000);
});
