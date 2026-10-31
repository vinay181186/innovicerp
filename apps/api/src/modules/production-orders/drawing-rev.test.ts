// Drawing Rev register (owner 2026-10-31) — the readers and writers in this
// agent's folders that used to assume ONE Route Card per item:
//   • Create Production Order: the card must be the one for the plan's Item + Rev;
//   • the Job Card list joins ONE card per JC even when the item has two;
//   • a BOM MAKE child line needs a Drawing Rev.
//
// Like every api integration test this writes to the database DATABASE_URL
// points at — TEST only, never production (house rules).

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  bomMasterLines,
  bomMasterRevisions,
  bomMasters,
  itemRevisionDrawings,
  itemRevisions,
  items,
  jcOps,
  jobCards,
  plans,
  productionOrders,
  routeCardOps,
  routeCards,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import * as bomService from '../bom-master/service';
import * as jcService from '../job-cards/service';
import * as planService from '../plans/service';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TDRV-';

let admin: AuthContext;
let companyId: string;
const itemId: Record<string, string> = {};
const revId: Record<string, string> = {};
const cardId: Record<string, string> = {};
const planId: Record<string, string> = {};

async function cleanup(): Promise<void> {
  const its = await db
    .select({ id: items.id })
    .from(items)
    .where(like(items.code, `${P}%`));
  const ids = its.map((i) => i.id);
  const pos = await db
    .select({ id: productionOrders.id, jcId: productionOrders.jobCardId })
    .from(productionOrders)
    .where(like(productionOrders.planCodeText, `${P}%`));
  const jcIds = pos.map((p) => p.jcId).filter((x): x is string => Boolean(x));
  if (jcIds.length > 0) {
    await db.update(jobCards).set({ productionOrderId: null }).where(inArray(jobCards.id, jcIds));
    await db
      .update(plans)
      .set({ jcId: null })
      .where(like(plans.code, `${P}%`));
  }
  if (pos.length > 0) {
    await db.delete(productionOrders).where(
      inArray(
        productionOrders.id,
        pos.map((p) => p.id),
      ),
    );
  }
  if (jcIds.length > 0) {
    await db.delete(jcOps).where(inArray(jcOps.jobCardId, jcIds));
    await db.delete(jobCards).where(inArray(jobCards.id, jcIds));
  }
  await db.delete(plans).where(like(plans.code, `${P}%`));
  const boms = await db
    .select({ id: bomMasters.id })
    .from(bomMasters)
    .where(like(bomMasters.bomName, `${P}%`));
  if (boms.length > 0) {
    const bomIds = boms.map((b) => b.id);
    await db.delete(bomMasterLines).where(inArray(bomMasterLines.bomMasterId, bomIds));
    await db.delete(bomMasterRevisions).where(inArray(bomMasterRevisions.bomMasterId, bomIds));
    await db.delete(bomMasters).where(inArray(bomMasters.id, bomIds));
  }
  const cards = await db
    .select({ id: routeCards.id })
    .from(routeCards)
    .where(like(routeCards.code, `${P}%`));
  if (cards.length > 0) {
    await db.delete(routeCardOps).where(
      inArray(
        routeCardOps.routeCardId,
        cards.map((c) => c.id),
      ),
    );
    await db.delete(routeCards).where(like(routeCards.code, `${P}%`));
  }
  if (ids.length > 0) {
    const revs = await db
      .select({ id: itemRevisions.id })
      .from(itemRevisions)
      .where(inArray(itemRevisions.itemId, ids));
    if (revs.length > 0) {
      await db.delete(itemRevisionDrawings).where(
        inArray(
          itemRevisionDrawings.itemRevisionId,
          revs.map((r) => r.id),
        ),
      );
      await db.delete(itemRevisions).where(inArray(itemRevisions.itemId, ids));
    }
  }
  await db.delete(items).where(like(items.code, `${P}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${P}%`));
}

async function makeItem(key: string): Promise<void> {
  const it = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}${key}`,
      name: `Drawing Rev test ${key}`,
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      procurementType: 'make',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  itemId[key] = it[0]!.id;
}

async function makeRev(key: string, item: string, rev: string): Promise<void> {
  const r = await db
    .insert(itemRevisions)
    .values({
      companyId,
      itemId: itemId[item]!,
      rev,
      sourceType: 'legacy',
      sourceRef: `${P}test`,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: itemRevisions.id });
  revId[key] = r[0]!.id;
}

async function makeCard(key: string, item: string, rev: string | null): Promise<void> {
  const rc = await db
    .insert(routeCards)
    .values({
      companyId,
      code: `${P}RC-${key}`,
      itemId: itemId[item]!,
      itemRevisionId: rev ? revId[rev]! : null,
      approvalStatus: 'approved',
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
}

async function makePlan(key: string, item: string, rev: string | null): Promise<void> {
  const pl = await db
    .insert(plans)
    .values({
      companyId,
      code: `${P}PLN-${key}`,
      planDate: '2026-10-31',
      planStatus: 'planned',
      planType: 'manufacture',
      opsSource: 'route_card',
      itemId: itemId[item]!,
      itemRevisionId: rev ? revId[rev]! : null,
      itemCodeText: `${P}${item}`,
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

function raise(plan: string, card: string) {
  return service.createProductionOrder(
    {
      planId: planId[plan]!,
      routeCardId: cardId[card]!,
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

  // Item A: an old card with NO Drawing Rev + a card for A/1. Revs 1 and 2.
  await makeItem('A');
  await makeRev('A1', 'A', '1');
  await makeRev('A2', 'A', '2');
  await makeCard('NOREV', 'A', null);
  await makeCard('A1', 'A', 'A1');
  await makePlan('A1', 'A', 'A1');
  await makePlan('A2', 'A', 'A2');
  // Item B: only a card for B/1; the plan is for B/2.
  await makeItem('B');
  await makeRev('B1', 'B', '1');
  await makeRev('B2', 'B', '2');
  await makeCard('B1', 'B', 'B1');
  await makePlan('B2', 'B', 'B2');
  // BOM parent.
  await makeItem('PARENT');
});

afterAll(cleanup);

describe('Create Production Order — the card must be the plan Item + Rev card', () => {
  it('plan A/1 with the old no-Rev card → 400 naming the right card', async () => {
    const attempt = raise('A1', 'NOREV');
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toThrow(
      `Route Card ${P}RC-NOREV is not for ${P}A/1 — pick ${P}RC-A1.`,
    );
  });

  it('plan A/2 with no A/2 card while an old no-Rev card exists → "has no Drawing Rev"', async () => {
    const attempt = raise('A2', 'A1');
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toThrow(
      `${P}RC-NOREV has no Drawing Rev — set it on the Route Card first.`,
    );
  });

  it('plan B/2 with only a B/1 card → "No Route Card for B/2"', async () => {
    const attempt = raise('B2', 'B1');
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toThrow(`No Route Card for ${P}B/2 — create it first.`);
    const pos = await db
      .select({ id: productionOrders.id })
      .from(productionOrders)
      .where(eq(productionOrders.planId, planId['B2']!));
    expect(pos).toHaveLength(0);
  });

  it('plan A/1 with the A/1 card → order and Job Card both store A/1', async () => {
    const po = await raise('A1', 'A1');
    expect(po.itemRevisionId).toBe(revId['A1']);
    expect(po.drawingRev).toBe('1');
    const jc = await db
      .select({ itemRevisionId: jobCards.itemRevisionId })
      .from(jobCards)
      .where(eq(jobCards.id, po.jobCardId!));
    expect(jc[0]?.itemRevisionId).toBe(revId['A1']);
  });
});

describe('Plan reads — own Rev + STRICT route-card status', () => {
  it('plan A/2 (only an old no-Rev card) reads route_card_pending; A/1 states its Rev', async () => {
    const a2 = await planService.getPlan(planId['A2']!, admin);
    expect(a2.derivedStatus).toBe('route_card_pending');
    expect(a2.itemRevisionId).toBe(revId['A2']);
    expect(a2.drawingRev).toBe('2');
    expect(a2.itemRevision).toBe('2');
    const b2 = await planService.getPlan(planId['B2']!, admin);
    expect(b2.derivedStatus).toBe('route_card_pending');
  });
});

describe('Job Card list — one row per card when the item has two Route Cards', () => {
  it('the A/1 card appears once, showing the A/1 Route Card and Rev', async () => {
    const res = await jcService.listJobCards({ limit: 50, offset: 0, search: `${P}A` }, admin);
    const mine = res.items.filter((r) => r.itemId === itemId['A']);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.routeCardCode).toBe(`${P}RC-A1`);
    expect(mine[0]!.drawingRev).toBe('1');
    expect(mine[0]!.itemRevision).toBe('1');
    // The edit model (drawing resolution SQL) still reads for this card.
    const model = await jcService.getJobCardEditModel(mine[0]!.id, admin);
    expect(model.code).toBe(mine[0]!.code);
  });
});

describe('BOM Master — a MAKE child line needs a Drawing Rev', () => {
  it('no Rev → 400 "Ln 1: Drawing Rev is required for <code>"', async () => {
    const attempt = bomService.createBomMaster(
      {
        bomName: `${P}BOM no rev`,
        parentItemId: itemId['PARENT']!,
        lines: [{ childItemId: itemId['A']!, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toThrow(`Ln 1: Drawing Rev is required for ${P}A`);
  });

  it('with a Rev → the line stores the child Item + Rev (made on first use)', async () => {
    const detail = await bomService.createBomMaster(
      {
        bomName: `${P}BOM rev 3`,
        parentItemId: itemId['PARENT']!,
        lines: [
          { childItemId: itemId['A']!, childDrawingRev: '3', qtyPerSet: 1, bomType: 'manufacture' },
        ],
      },
      admin,
    );
    expect(detail.lines[0]!.childDrawingRev).toBe('3');
    expect(detail.lines[0]!.childItemRevisionId).toBeTruthy();
  });
});
