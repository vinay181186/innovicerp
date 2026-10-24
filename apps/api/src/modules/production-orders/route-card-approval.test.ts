// ADR-253 — only an APPROVED Route Card may drive work. Covers the readers in
// this agent's folders: Production Order create, the plan's derived status,
// raw material read off a card, and Trash restore of a card.
//
// NOTE: like every api integration test this writes to the database
// DATABASE_URL points at — never run it against production (house rules).
// Written, not run.

import { listPlansQuerySchema } from '@innovic/shared';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  items,
  jobCards,
  plans,
  productionOrders,
  routeCardOps,
  routeCards,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { readRouteCardRawMaterial } from '../plans/rm-backfill';
import * as planService from '../plans/service';
import * as trashService from '../trash/service';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TRCA-';

let admin: AuthContext;
let companyId: string;
const itemId: Record<string, string> = {};
const cardId: Record<string, string> = {};
const planId: Record<string, string> = {};
const createdPoIds: string[] = [];

type Approval = 'pending' | 'approved' | 'rejected';

async function cleanup(): Promise<void> {
  if (createdPoIds.length > 0) {
    const pos = await db
      .select({ id: productionOrders.id, jcId: productionOrders.jobCardId })
      .from(productionOrders)
      .where(inArray(productionOrders.id, createdPoIds));
    const jcIds = pos.map((p) => p.jcId).filter((x): x is string => Boolean(x));
    if (jcIds.length > 0) {
      await db.update(jobCards).set({ productionOrderId: null }).where(inArray(jobCards.id, jcIds));
    }
    await db.delete(productionOrders).where(inArray(productionOrders.id, createdPoIds));
    await db.delete(plans).where(like(plans.code, `${P}%`));
    if (jcIds.length > 0) await db.delete(jobCards).where(inArray(jobCards.id, jcIds));
    createdPoIds.length = 0;
  }
  await db.delete(plans).where(like(plans.code, `${P}%`));
  await db.delete(routeCards).where(like(routeCards.code, `${P}%`));
  await db.delete(items).where(like(items.code, `${P}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${P}%`));
}

/** One item + its Route Card (one process op, RM on it) + a route-card plan
 *  ready for a Production Order. */
async function makeFixture(key: string, approval: Approval): Promise<void> {
  const it = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}${key}`,
      name: `RC approval test ${key}`,
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  itemId[key] = it[0]!.id;

  const rc = await db
    .insert(routeCards)
    .values({
      companyId,
      code: `${P}RC-${key}`,
      itemId: itemId[key]!,
      approvalStatus: approval,
      rawMaterialGradeText: 'EN8',
      rawMaterialSizeText: 'DIA 40',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: routeCards.id });
  cardId[key] = rc[0]!.id;
  await db.insert(routeCardOps).values({
    companyId,
    routeCardId: cardId[key]!,
    opSeq: 10,
    operation: 'Turning',
    opType: 'process',
    createdBy: admin.id,
    updatedBy: admin.id,
  });

  const pl = await db
    .insert(plans)
    .values({
      companyId,
      code: `${P}PLN-${key}`,
      planDate: '2026-10-24',
      planStatus: 'planned',
      planType: 'manufacture',
      opsSource: 'route_card',
      itemId: itemId[key]!,
      itemCodeText: `${P}${key}`,
      orderQty: 5,
      planQty: 5,
      rawMaterialGradeText: 'EN8',
      rawMaterialSizeText: 'DIA 40',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: plans.id });
  planId[key] = pl[0]!.id;
}

function raise(key: string) {
  return service.createProductionOrder(
    {
      planId: planId[key]!,
      routeCardId: cardId[key]!,
      targetDate: '2026-11-30',
      orderQty: 2,
      rawMaterialAvailable: true,
    },
    admin,
  );
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await cleanup();
  await makeFixture('PEND', 'pending');
  await makeFixture('REJ', 'rejected');
  await makeFixture('OK', 'approved');
});

afterAll(cleanup);

describe('ADR-253 — Production Order create needs an approved Route Card', () => {
  it('a Pending Approval card → 409 "waiting for approval", nothing written', async () => {
    const attempt = raise('PEND');
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow(/is waiting for approval/);
    const pos = await db
      .select({ id: productionOrders.id })
      .from(productionOrders)
      .where(eq(productionOrders.planId, planId['PEND']!));
    expect(pos).toHaveLength(0);
  });

  it('a Rejected card → 409 "was rejected"', async () => {
    const attempt = raise('REJ');
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow(/was rejected/);
  });

  it('an Approved card → the order is created', async () => {
    const po = await raise('OK');
    createdPoIds.push(po.id);
    expect(po.id).toBeTruthy();
  });
});

describe('ADR-253 — plan derived status', () => {
  it('a plan whose item card is pending shows route_card_approval_pending', async () => {
    const list = await planService.listPlans(
      listPlansQuerySchema.parse({ search: `${P}PLN-PEND` }),
      admin,
    );
    const row = list.items.find((r) => r.id === planId['PEND']);
    expect(row?.derivedStatus).toBe('route_card_approval_pending');

    // The status filter cuts on the same SQL, so the row is found by it too.
    const filtered = await planService.listPlans(
      listPlansQuerySchema.parse({
        search: `${P}PLN-PEND`,
        status: 'route_card_approval_pending',
      }),
      admin,
    );
    expect(filtered.items.map((r) => r.id)).toContain(planId['PEND']);

    const detail = await planService.getPlan(planId['PEND']!, admin);
    expect(detail.derivedStatus).toBe('route_card_approval_pending');
  });

  it('a rejected card also reads route_card_approval_pending', async () => {
    const rej = await planService.getPlan(planId['REJ']!, admin);
    expect(rej.derivedStatus).toBe('route_card_approval_pending');
  });
});

describe('ADR-253 — raw material is read only off an approved card', () => {
  it('readRouteCardRawMaterial ignores a pending card and reads an approved one', async () => {
    await withUserContext(admin, async (tx) => {
      const pending = await readRouteCardRawMaterial(tx, companyId, itemId['PEND']!);
      expect(pending).toBeNull();
      const ok = await readRouteCardRawMaterial(tx, companyId, itemId['OK']!);
      expect(ok?.routeCardCode).toBe(`${P}RC-OK`);
      expect(ok?.rawMaterialGradeText).toBe('EN8');
    });
  });
});

describe('ADR-253 — Trash restore sends a Route Card back for approval', () => {
  it('a restored approved card comes back Pending Approval with the stamps cleared', async () => {
    // A separate item + approved card, so the earlier cases are untouched.
    await makeFixture('TR', 'approved');
    await db
      .update(routeCards)
      .set({ approvedBy: admin.id, approvedAt: new Date() })
      .where(eq(routeCards.id, cardId['TR']!));
    await db
      .update(routeCards)
      .set({ deletedAt: new Date(), deletedBy: admin.id })
      .where(eq(routeCards.id, cardId['TR']!));

    await trashService.restoreFromTrash({ type: 'Route Card', id: cardId['TR']! }, admin);

    const rows = await db.select().from(routeCards).where(eq(routeCards.id, cardId['TR']!));
    const card = rows[0]!;
    expect(card.deletedAt).toBeNull();
    expect(card.approvalStatus).toBe('pending');
    expect(card.approvedBy).toBeNull();
    expect(card.approvedAt).toBeNull();
    expect(card.rejectedBy).toBeNull();
    expect(card.rejectedAt).toBeNull();

    // And it no longer drives work until approved again.
    await expect(raise('TR')).rejects.toThrow(/is waiting for approval/);
  });
});
