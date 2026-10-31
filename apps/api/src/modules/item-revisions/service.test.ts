// Item + Drawing Rev register (0232) — the race and refusal rules:
//   • two first-namers of ABC/1 at the same moment share ONE row;
//   • a second Route Card for the same Item + Rev → 409;
//   • a different file for an ABC/1 that has one → 400;
//   • Replace drawing with a stale updatedAt → 409 (§20.4);
//   • D1: Rev change on a line whose Job Cards are ALL closed → 400;
//   • 0234: clearing the Rev on a line with a Job Card → 400;
//   • 0234: open PROs move by plan linkage and take the new Rev's APPROVED
//     Route Card (else keep their card).
// Runs on TEST only (test/global-setup.ts refuses PRODUCTION).

import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  itemRevisionChanges,
  itemRevisionDrawings,
  itemRevisions,
  items,
  jobCards,
  plans,
  productionOrders,
  routeCardOps,
  routeCardRevisions,
  routeCards,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AppError, ConflictError, ValidationError } from '../../lib/errors';
import { replaceItemRevisionDrawing, resolveItemRevision } from '../../lib/item-revision';
import * as rc from '../route-cards/service';
import { getItemRevisionFixList } from './fix-list';
import { applyLineRevChange, resolveLineRevision } from './line-rev';
import * as svc from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TIR-';

let admin: AuthContext;
let companyId: string;
let itemId: string;

async function cleanup(): Promise<void> {
  const its = await db
    .select({ id: items.id })
    .from(items)
    .where(like(items.code, `${P}%`));
  const ids = its.map((r) => r.id);
  if (ids.length === 0) return;
  const revs = await db
    .select({ id: itemRevisions.id })
    .from(itemRevisions)
    .where(inArray(itemRevisions.itemId, ids));
  const revIds = revs.map((r) => r.id);
  await db.delete(productionOrders).where(like(productionOrders.code, `${P}%`));
  await db.delete(plans).where(like(plans.code, `${P}%`));
  await db.delete(jobCards).where(like(jobCards.code, `${P}%`));
  const sos = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${P}%`));
  if (revIds.length > 0) {
    await db
      .delete(itemRevisionChanges)
      .where(inArray(itemRevisionChanges.toItemRevisionId, revIds));
  }
  if (sos.length > 0) {
    await db.delete(salesOrderLines).where(
      inArray(
        salesOrderLines.salesOrderId,
        sos.map((s) => s.id),
      ),
    );
    await db.delete(salesOrders).where(
      inArray(
        salesOrders.id,
        sos.map((s) => s.id),
      ),
    );
  }
  const cards = await db
    .select({ id: routeCards.id })
    .from(routeCards)
    .where(inArray(routeCards.itemId, ids));
  if (cards.length > 0) {
    const cardIds = cards.map((c) => c.id);
    await db.delete(activityLog).where(inArray(activityLog.entityId, cardIds));
    await db.delete(routeCardOps).where(inArray(routeCardOps.routeCardId, cardIds));
    await db.delete(routeCardRevisions).where(inArray(routeCardRevisions.routeCardId, cardIds));
    await db.delete(routeCards).where(inArray(routeCards.id, cardIds));
  }
  if (revIds.length > 0) {
    await db.delete(activityLog).where(inArray(activityLog.entityId, revIds));
    await db
      .delete(itemRevisionDrawings)
      .where(inArray(itemRevisionDrawings.itemRevisionId, revIds));
    await db.delete(itemRevisions).where(inArray(itemRevisions.id, revIds));
  }
  await db.delete(items).where(inArray(items.id, ids));
}

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await cleanup();
  const [it] = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}SHAFT`,
      name: 'Drawing Rev test shaft',
      uom: 'NOS',
      itemType: 'component',
      procurementType: 'make',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  itemId = it!.id;
});

afterAll(cleanup);

const resolve = (rev: string, file?: string | null) =>
  withUserContext(admin, (tx) =>
    resolveItemRevision(tx, admin, companyId, {
      itemId,
      rev,
      drawingFilePath: file,
      sourceType: 'so_line',
      sourceRef: `${P}test`,
    }),
  );

describe('Item + Drawing Rev register', () => {
  it('two concurrent first-namers of ABC/1 share ONE row', async () => {
    const [a, b] = await Promise.all([resolve('1', `${P}d1.pdf`), resolve('1', `${P}d1.pdf`)]);
    expect(a!.id).toBe(b!.id);
    const rows = await db
      .select({ id: itemRevisions.id })
      .from(itemRevisions)
      .where(and(eq(itemRevisions.itemId, itemId), eq(itemRevisions.rev, '1')));
    expect(rows).toHaveLength(1);
  });

  it('a different file for ABC/1 that already has one → 400', async () => {
    await expect(resolve('1', `${P}other.pdf`)).rejects.toBeInstanceOf(ValidationError);
  });

  it('a Route Card for a MAKE item needs a Drawing Rev; a second card for ABC/2 → 409', async () => {
    const ops = [
      { operation: 'Turning', opType: 'process' as const, machineCodeText: 'CNC', cycleTimeMin: 5 },
    ];
    await expect(rc.createRouteCard({ itemId, ops } as never, admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const first = await rc.createRouteCard({ itemId, drawingRev: '2', ops } as never, admin);
    expect(first.drawingRev).toBe('2');
    await expect(
      rc.createRouteCard({ itemId, drawingRev: '2', ops } as never, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('Replace drawing with a stale updatedAt → 409', async () => {
    const r = await resolve('1');
    const stale = new Date(Date.now() - 86_400_000).toISOString();
    const err = await withUserContext(admin, (tx) =>
      replaceItemRevisionDrawing(tx, admin, companyId, r!.id, {
        drawingFilePath: `${P}d1-new.pdf`,
        reason: 'wrong file uploaded',
        expectedUpdatedAt: stale,
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
  });

  it('D1: Rev change on a line whose Job Cards are all closed → 400', async () => {
    const r1 = await resolve('1');
    const r3 = await resolve('3');
    const [so] = await db
      .insert(salesOrders)
      .values({
        companyId,
        code: `${P}SO1`,
        soDate: '2026-10-31',
        type: 'component_manufacturing',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: salesOrders.id });
    const [line] = await db
      .insert(salesOrderLines)
      .values({
        companyId,
        salesOrderId: so!.id,
        lineNo: 1,
        itemId,
        partName: 'shaft',
        revision: '1',
        uom: 'NOS',
        orderQty: 5,
        itemRevisionId: r1!.id,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: salesOrderLines.id });
    await db.insert(jobCards).values({
      companyId,
      code: `${P}JC1`,
      jcDate: '2026-10-31',
      itemId,
      orderQty: 5,
      sourceSoLineId: line!.id,
      closedAt: new Date(),
      createdBy: admin.id,
      updatedBy: admin.id,
    } as never);
    await expect(
      withUserContext(admin, (tx) =>
        applyLineRevChange(tx, admin, companyId, {
          kind: 'so',
          orderId: so!.id,
          docCode: `${P}SO1`,
          lineId: line!.id,
          lineNo: 1,
          itemId,
          fromId: r1!.id,
          toId: r3!.id,
        }),
      ),
    ).rejects.toThrow(/All Job Cards are closed/);

    // One OPEN Job Card beside the closed one → it moves, the closed one stays.
    await db.insert(jobCards).values({
      companyId,
      code: `${P}JC2`,
      jcDate: '2026-10-31',
      itemId,
      orderQty: 5,
      sourceSoLineId: line!.id,
      itemRevisionId: r1!.id,
      createdBy: admin.id,
      updatedBy: admin.id,
    } as never);
    const res = await withUserContext(admin, (tx) =>
      applyLineRevChange(tx, admin, companyId, {
        kind: 'so',
        orderId: so!.id,
        docCode: `${P}SO1`,
        lineId: line!.id,
        lineNo: 1,
        itemId,
        fromId: r1!.id,
        toId: r3!.id,
      }),
    );
    expect(res.movedDocs).toEqual([`${P}JC2`]);
    expect(res.keptDocs).toEqual([`${P}JC1`]);
    const jcs = await db
      .select({ code: jobCards.code, rev: jobCards.itemRevisionId })
      .from(jobCards)
      .where(like(jobCards.code, `${P}%`));
    expect(jcs.find((j) => j.code === `${P}JC2`)?.rev).toBe(r3!.id);
    expect(jcs.find((j) => j.code === `${P}JC1`)?.rev ?? null).toBeNull();
  });

  it('0234: clearing the Drawing Rev on a line that has a Job Card → 400', async () => {
    const r1 = await resolve('1');
    const line = (
      await db
        .select({ id: salesOrderLines.id, soId: salesOrderLines.salesOrderId })
        .from(salesOrderLines)
        .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
        .where(eq(salesOrders.code, `${P}SO1`))
    )[0]!;
    await expect(
      withUserContext(admin, (tx) =>
        resolveLineRevision(tx, admin, companyId, {
          kind: 'so',
          orderId: line.soId,
          docCode: `${P}SO1`,
          lineNo: 1,
          itemId,
          rev: null,
          sentFile: undefined,
          sentDrawingNo: undefined,
          stored: {
            id: line.id,
            lineNo: 1,
            itemId,
            revision: '1',
            itemRevisionId: r1!.id,
            drawingFilePath: null,
          },
        }),
      ),
    ).rejects.toThrow(/Drawing Rev cannot be cleared once a Job Card exists/);
  });

  it('0234: open PRO moves by plan linkage and takes the APPROVED Route Card of the new Rev', async () => {
    const r2 = await resolve('2');
    const r3 = await resolve('3');
    const ops = [
      { operation: 'Turning', opType: 'process' as const, machineCodeText: 'CNC', cycleTimeMin: 5 },
    ];
    const card3 = await rc.createRouteCard({ itemId, drawingRev: '3', ops } as never, admin);
    const cards = await db
      .select({ id: routeCards.id, code: routeCards.code, rev: routeCards.itemRevisionId })
      .from(routeCards)
      .where(eq(routeCards.itemId, itemId));
    const rc2 = cards.find((c) => c.rev === r2!.id)!;
    const rc3 = cards.find((c) => c.code === card3.code)!;
    await db
      .update(routeCards)
      .set({ approvalStatus: 'approved' })
      .where(eq(routeCards.id, rc2.id));
    await db.update(routeCards).set({ approvalStatus: 'pending' }).where(eq(routeCards.id, rc3.id));
    const so = (
      await db
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.code, `${P}SO1`))
    )[0]!;
    const line = (
      await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id))
    )[0]!;
    const jc2 = (
      await db
        .select()
        .from(jobCards)
        .where(eq(jobCards.code, `${P}JC2`))
    )[0]!;
    // The plan is ALREADY on ABC/2 — its PRO (on ABC/3) must still move.
    const [plan] = await db
      .insert(plans)
      .values({
        companyId,
        code: `${P}PLN1`,
        planDate: '2026-10-31',
        planType: 'manufacture',
        soLineId: line.id,
        itemId,
        orderQty: 5,
        planQty: 5,
        itemRevisionId: r2!.id,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: plans.id });
    await db.insert(productionOrders).values({
      companyId,
      code: `${P}PRO1`,
      planId: plan!.id,
      planCodeText: `${P}PLN1`,
      itemId,
      itemCodeText: `${P}SHAFT`,
      routeCardId: rc3.id,
      routeCardCodeText: rc3.code,
      jobCardId: jc2.id,
      jcCodeText: jc2.code,
      orderQty: 5,
      targetDate: '2026-11-30',
      itemRevisionId: r3!.id,
      createdBy: admin.id,
      updatedBy: admin.id,
    } as never);
    const move = (fromId: string, toId: string) =>
      withUserContext(admin, (tx) =>
        applyLineRevChange(tx, admin, companyId, {
          kind: 'so',
          orderId: so.id,
          docCode: `${P}SO1`,
          lineId: line.id,
          lineNo: 1,
          itemId,
          fromId,
          toId,
        }),
      );
    const pro = async () =>
      (
        await db
          .select()
          .from(productionOrders)
          .where(eq(productionOrders.code, `${P}PRO1`))
      )[0]!;

    const a = await move(r3!.id, r2!.id);
    expect(a.movedDocs).toContain(`${P}PRO1`);
    expect(a.movedDocs).not.toContain(`${P}PLN1`);
    let p = await pro();
    expect(p.itemRevisionId).toBe(r2!.id);
    expect(p.routeCardId).toBe(rc2.id);
    expect(p.routeCardCodeText).toBe(rc2.code);

    // Back to ABC/3, whose card is only Pending → the PRO keeps ABC/2's card.
    const b = await move(r2!.id, r3!.id);
    expect(b.movedDocs).toEqual(expect.arrayContaining([`${P}PLN1`, `${P}PRO1`, `${P}JC2`]));
    p = await pro();
    expect(p.itemRevisionId).toBe(r3!.id);
    expect(p.routeCardId).toBe(rc2.id);
  });

  it('reads: list / lookup / detail / changes / fix-list', async () => {
    const list = await svc.listItemRevisions({ itemId, limit: 50, offset: 0 }, admin);
    expect(list.items.map((r) => r.label)).toEqual([`${P}SHAFT/1`, `${P}SHAFT/2`, `${P}SHAFT/3`]);
    const two = list.items.find((r) => r.drawingRev === '2')!;
    expect(two.routeCardCode).toBeTruthy();
    const look = await svc.lookupItemRevision({ itemId, rev: '9' }, admin);
    expect(look).toEqual({ revision: null, revRequired: true });
    const three = list.items.find((r) => r.drawingRev === '3')!;
    const detail = await svc.getItemRevision(three.id, admin);
    expect(detail.linkedDocs.map((d) => d.docType)).toContain('job_card');
    const so = (
      await db
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(eq(salesOrders.code, `${P}SO1`))
    )[0]!;
    const changes = await svc.listItemRevisionChanges({ salesOrderId: so.id }, admin);
    expect(changes[0]?.toLabel).toBe(`${P}SHAFT/3`);
    const fix = await getItemRevisionFixList(admin);
    expect(
      Array.isArray(fix.routeCards) && Array.isArray(fix.lines) && Array.isArray(fix.stock),
    ).toBe(true);
  });
});
