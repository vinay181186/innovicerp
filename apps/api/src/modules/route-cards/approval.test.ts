// ADR-253 — every NEW Route Card waits for approval. Integration test on the
// house harness (TEST database, never production — see global-setup).
//
// Covers: create → pending, no RM backfill while pending; approve → approved +
// RM backfilled to a blank waiting plan; reject needs a reason (400); reject →
// rejected, an edit sends it back to pending with the rejection cleared; two
// approvals at once → exactly one wins, the loser's 409 names the approver;
// no Approve tick → 403; the creator may approve their own card; with Document
// Edit Approval ON an approved card's edit is staged but a pending card's edit
// saves directly; a Job Card / plan auto-save for an item with no card makes a
// pending card, and leaves a pending card alone.

import { and, eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rejectRouteCardInputSchema, type CreateRouteCardOpInput } from '@innovic/shared';
import { db } from '../../db/client';
import {
  activityLog,
  approvalConfig,
  documentEditRequests,
  items,
  machines,
  plans,
  routeCardOps,
  routeCards,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AppError, AuthorizationError, ConflictError } from '../../lib/errors';
import { asAccess } from '../../lib/test-access';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { getApprovalInbox } from '../approvals/service';
import { approveRouteCard, rejectRouteCard } from './approval';
import { routeCardRoutes } from './routes';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TRCA-';

let admin: AuthContext;
let adminName: string;
let machineId: string;
let cfgExisted = false;
let origDocEditApproval = false;
let itemSeq = 0;

const approver = (): AuthContext => asAccess(admin, { departments: { planning: 'L5' } }, 'manager');
/** Planning L1: view only on Route Card Master (no Edit right). */
const viewerOnly = (): AuthContext =>
  asAccess(admin, { departments: { planning: 'L1' } }, 'viewer');
/** Planning L3: entry + edit on Route Card Master, no Approve. */
const editorOnly = (): AuthContext =>
  asAccess(admin, { departments: { planning: 'L3' } }, 'operator');

const ops = (name = 'od turn'): CreateRouteCardOpInput[] => [
  { machineId, operation: name, opType: 'process', cycleTimeMin: 1, qcRequired: false },
];

async function newItem(): Promise<string> {
  itemSeq += 1;
  const rows = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}I${itemSeq}`,
      name: `RC approval test ${itemSeq}`,
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  return rows[0]!.id;
}

async function newCard(
  user: AuthContext,
  extra: { rawMaterialGradeText?: string; rawMaterialSizeText?: string } = {},
) {
  const itemId = await newItem();
  const card = await service.createRouteCard(
    { code: `${TEST_PREFIX}RC${itemSeq}`, itemId, ops: ops(), ...extra },
    user,
  );
  return { itemId, card };
}

async function setDocEditApproval(on: boolean): Promise<void> {
  await db
    .update(approvalConfig)
    .set({ docEditApproval: on })
    .where(eq(approvalConfig.companyId, admin.companyId!));
}

async function buildApp(user: AuthContext): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(routeCardRoutes);
  return app;
}

async function cleanup(): Promise<void> {
  await db
    .delete(documentEditRequests)
    .where(like(documentEditRequests.docCode, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
  await db.delete(plans).where(like(plans.code, `${TEST_PREFIX}%`));
  // Cards made by the auto-save get an IN-RC number: find them by item.
  const testItems = await db
    .select({ id: items.id })
    .from(items)
    .where(like(items.code, `${TEST_PREFIX}%`));
  for (const i of testItems) {
    const cards = await db
      .select({ id: routeCards.id, code: routeCards.code })
      .from(routeCards)
      .where(eq(routeCards.itemId, i.id));
    for (const c of cards) {
      await db.delete(activityLog).where(eq(activityLog.refId, c.code));
      await db.delete(routeCards).where(eq(routeCards.id, c.id));
    }
  }
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(machines).where(like(machines.code, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  adminName = u.fullName?.trim() || u.email.split('@')[0]!;
  await cleanup();

  const m = await db
    .insert(machines)
    .values({
      companyId: u.companyId,
      code: `${TEST_PREFIX}MACH`,
      name: 'RC approval test machine',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: machines.id });
  machineId = m[0]!.id;

  const cfg = await db
    .select()
    .from(approvalConfig)
    .where(and(eq(approvalConfig.companyId, u.companyId)))
    .limit(1);
  if (cfg[0]) {
    cfgExisted = true;
    origDocEditApproval = cfg[0].docEditApproval;
  } else {
    await db.insert(approvalConfig).values({
      companyId: u.companyId,
      docEditApproval: false,
      poApproval: false,
      prApproval: false,
      invoiceApproval: false,
      createdBy: u.id,
      updatedBy: u.id,
    });
  }
  await setDocEditApproval(false);
}, 180_000);

afterAll(async () => {
  if (cfgExisted) await setDocEditApproval(origDocEditApproval);
  else await db.delete(approvalConfig).where(eq(approvalConfig.companyId, admin.companyId!));
  await cleanup();
}, 180_000);

describe('Route Card approval (ADR-253)', () => {
  it('a new card is Pending Approval and feeds no plan until approved; approval backfills the RM', async () => {
    const itemId = await newItem();
    const plan = await db
      .insert(plans)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}PLN${itemSeq}`,
        planDate: '2026-10-24',
        planStatus: 'planned',
        planType: 'manufacture',
        itemId,
        orderQty: 5,
        planQty: 5,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: plans.id });

    const card = await service.createRouteCard(
      {
        code: `${TEST_PREFIX}RC-BF`,
        itemId,
        ops: ops(),
        rawMaterialGradeText: 'EN24',
        rawMaterialSizeText: 'DIA 32',
      },
      approver(),
    );
    expect(card.approvalStatus).toBe('pending');
    expect(card.approvedBy).toBeNull();

    const before = await db
      .select({ g: plans.rawMaterialGradeText, s: plans.rawMaterialSizeText })
      .from(plans)
      .where(eq(plans.id, plan[0]!.id));
    expect(before[0]).toEqual({ g: null, s: null });

    // The creator approves their own card — allowed.
    const approved = await approveRouteCard(card.id, {}, approver());
    expect(approved.approvalStatus).toBe('approved');
    expect(approved.approvedBy).toBe(admin.id);
    expect(approved.approvedByName).toBe(adminName);
    expect(approved.approvedAt).not.toBeNull();

    const after = await db
      .select({ g: plans.rawMaterialGradeText, s: plans.rawMaterialSizeText })
      .from(plans)
      .where(eq(plans.id, plan[0]!.id));
    expect(after[0]).toEqual({ g: 'EN24', s: 'DIA 32' });
  });

  it('reject without a reason is a 400; with a reason the card is Rejected', async () => {
    expect(rejectRouteCardInputSchema.safeParse({}).success).toBe(false);
    expect(rejectRouteCardInputSchema.safeParse({ reason: '   ' }).success).toBe(false);

    const { card } = await newCard(approver());
    const app = await buildApp(approver());
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/route-cards/${card.id}/reject`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
    const still = await service.getRouteCard(card.id, admin);
    expect(still.approvalStatus).toBe('pending');

    const rejected = await rejectRouteCard(card.id, { reason: 'Wrong machine' }, approver());
    expect(rejected.approvalStatus).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Wrong machine');
    expect(rejected.rejectedByName).toBe(adminName);
  });

  it('saving a rejected card sends it back to pending and clears the rejection', async () => {
    const { itemId, card } = await newCard(approver());
    const rejected = await rejectRouteCard(card.id, { reason: 'Fix op' }, approver());
    const saved = await service.updateRouteCard(
      card.id,
      {
        code: card.code,
        itemId,
        ops: ops('od turn fixed'),
        expectedUpdatedAt: rejected.updatedAt,
      },
      editorOnly(),
    );
    expect(saved.approvalStatus).toBe('pending');
    expect(saved.rejectedBy).toBeNull();
    expect(saved.rejectedAt).toBeNull();
    expect(saved.rejectionReason).toBeNull();
    // Pending again, so it can now be approved.
    await expect(approveRouteCard(saved.id, {}, approver())).resolves.toMatchObject({
      approvalStatus: 'approved',
    });
  });

  it('two approvals at once: exactly one wins, the other gets 409 naming the approver', async () => {
    const { card } = await newCard(approver());
    const results = await Promise.allSettled([
      approveRouteCard(card.id, {}, approver()),
      approveRouteCard(card.id, {}, approver()),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.reason).toBeInstanceOf(ConflictError);
    expect(String(bad[0]!.reason.message)).toContain(`already approved by ${adminName}`);

    // Approve after a reject names the rejecter.
    const other = await newCard(approver());
    await rejectRouteCard(other.card.id, { reason: 'No' }, approver());
    await expect(approveRouteCard(other.card.id, {}, approver())).rejects.toThrow(
      `was rejected by ${adminName}`,
    );
  });

  it('the Approvals inbox lists a pending card for an approver, not for an editor', async () => {
    const { card } = await newCard(approver());
    const mine = await getApprovalInbox(approver());
    expect(mine.rc.map((r) => r.id)).toContain(card.id);
    expect(mine.counts.rc).toBe(mine.rc.length);
    const row = mine.rc.find((r) => r.id === card.id)!;
    expect(row.docCode).toBe(card.code);
    expect(row.navPage).toBe(`/route-cards/${card.id}`);
    const editor = await getApprovalInbox(editorOnly());
    expect(editor.rc).toEqual([]);
    await approveRouteCard(card.id, {}, approver());
    const after = await getApprovalInbox(approver());
    expect(after.rc.map((r) => r.id)).not.toContain(card.id);
  });

  it('no Approve tick on Route Card Master → 403 on approve and reject', async () => {
    const { card } = await newCard(approver());
    await expect(approveRouteCard(card.id, {}, editorOnly())).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(rejectRouteCard(card.id, { reason: 'x' }, editorOnly())).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    const still = await service.getRouteCard(card.id, admin);
    expect(still.approvalStatus).toBe('pending');
  });

  it('Document Edit Approval ON: an approved card edit is staged, a pending card edit saves directly', async () => {
    const a = await newCard(approver());
    const approvedCard = await approveRouteCard(a.card.id, {}, approver());
    const p = await newCard(approver());
    await setDocEditApproval(true);
    try {
      const staged = await service.updateRouteCardOrStage(
        approvedCard.id,
        {
          code: approvedCard.code,
          itemId: a.itemId,
          ops: ops('approved card change'),
          expectedUpdatedAt: approvedCard.updatedAt,
        },
        approver(),
      );
      expect('staged' in staged && staged.staged).toBe(true);

      const direct = await service.updateRouteCardOrStage(
        p.card.id,
        {
          code: p.card.code,
          itemId: p.itemId,
          ops: ops('pending card change'),
          expectedUpdatedAt: p.card.updatedAt,
        },
        approver(),
      );
      expect('staged' in direct).toBe(false);
      const detail = direct as Awaited<ReturnType<typeof service.getRouteCard>>;
      expect(detail.approvalStatus).toBe('pending');
      expect(detail.ops[0]!.operation).toBe('pending card change');
    } finally {
      await setDocEditApproval(false);
    }
  });

  it('auto-save for an item with no card makes a PENDING card; a pending card is then left alone', async () => {
    const itemId = await newItem();
    const blankRm = {
      rawMaterialGradeId: null,
      rawMaterialGradeText: null,
      rawMaterialSizeId: null,
      rawMaterialSizeText: null,
      rawMaterialItemId: null,
      rmQtyPerPiece: null,
    };
    const first = await withUserContext(admin, (tx) =>
      service.saveRouteCardForItem(
        tx,
        admin.companyId!,
        itemId,
        ops('from jc'),
        admin,
        `${TEST_PREFIX}JC1`,
        blankRm,
      ),
    );
    expect(first?.created).toBe(true);
    const made = await db
      .select({ status: routeCards.approvalStatus })
      .from(routeCards)
      .where(eq(routeCards.id, first!.routeCardId));
    expect(made[0]!.status).toBe('pending');

    // A second Job Card with a different routing: the save succeeds, the
    // pending card is untouched, and the screen is told why.
    const second = await withUserContext(admin, (tx) =>
      service.saveRouteCardForItem(
        tx,
        admin.companyId!,
        itemId,
        ops('another routing'),
        admin,
        `${TEST_PREFIX}JC2`,
        blankRm,
      ),
    );
    expect(second?.created).toBe(false);
    expect(second?.notSentReason).toContain('waiting for approval');
    const opRows = await db
      .select({ operation: routeCardOps.operation })
      .from(routeCardOps)
      .where(eq(routeCardOps.routeCardId, first!.routeCardId));
    expect(opRows.map((o) => o.operation)).toEqual(['from jc']);

    // The SAME routing again: nothing was held back, so nothing is said —
    // exactly as on an approved card with an identical routing.
    const same = await withUserContext(admin, (tx) =>
      service.saveRouteCardForItem(
        tx,
        admin.companyId!,
        itemId,
        ops('from jc'),
        admin,
        `${TEST_PREFIX}JC3`,
        blankRm,
      ),
    );
    expect(same).toBeNull();

    // Same routing + a raw material the (blank) card does not hold: a user
    // WITH the Edit right is told it was not copied; one WITHOUT it is told
    // nothing (the approved path would not have filled it for them either).
    const withRm = { ...blankRm, rawMaterialGradeText: 'EN8', rawMaterialSizeText: 'DIA 20' };
    const rmEditor = await withUserContext(admin, (tx) =>
      service.saveRouteCardForItem(
        tx,
        admin.companyId!,
        itemId,
        ops('from jc'),
        editorOnly(),
        `${TEST_PREFIX}JC4`,
        withRm,
      ),
    );
    expect(rmEditor?.notSentReason).toContain('waiting for approval');
    const rmViewer = await withUserContext(admin, (tx) =>
      service.saveRouteCardForItem(
        tx,
        admin.companyId!,
        itemId,
        ops('from jc'),
        viewerOnly(),
        `${TEST_PREFIX}JC5`,
        withRm,
      ),
    );
    expect(rmViewer).toBeNull();
    const stillBlank = await db
      .select({ g: routeCards.rawMaterialGradeText })
      .from(routeCards)
      .where(eq(routeCards.id, first!.routeCardId));
    expect(stillBlank[0]!.g).toBeNull();
  });

  it('approve / reject with a stale expectedUpdatedAt → 409 edit conflict; current one works', async () => {
    const { itemId, card } = await newCard(approver());
    // Someone edits the card after the approver opened it.
    const edited = await service.updateRouteCard(
      card.id,
      { code: card.code, itemId, ops: ops('changed meanwhile'), expectedUpdatedAt: card.updatedAt },
      editorOnly(),
    );
    const stale = await approveRouteCard(card.id, { expectedUpdatedAt: card.updatedAt }, approver())
      .then(() => null)
      .catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(AppError);
    expect((stale as AppError).statusCode).toBe(409);
    const staleReject = await rejectRouteCard(
      card.id,
      { reason: 'x', expectedUpdatedAt: card.updatedAt },
      approver(),
    )
      .then(() => null)
      .catch((e: unknown) => e);
    expect((staleReject as AppError).statusCode).toBe(409);
    const still = await service.getRouteCard(card.id, admin);
    expect(still.approvalStatus).toBe('pending');

    await expect(
      approveRouteCard(card.id, { expectedUpdatedAt: edited.updatedAt }, approver()),
    ).resolves.toMatchObject({ approvalStatus: 'approved' });
  });

  it('reject logs the REJECT activity with its reason against the card (creator notification source)', async () => {
    const { card } = await newCard(approver());
    await rejectRouteCard(card.id, { reason: 'Wrong fixture' }, approver());
    const rows = await db
      .select({
        action: activityLog.action,
        reason: activityLog.reason,
        entity: activityLog.entity,
      })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, card.id), eq(activityLog.action, 'REJECT')));
    expect(rows).toEqual([{ action: 'REJECT', reason: 'Wrong fixture', entity: 'RouteCard' }]);
  });
});
