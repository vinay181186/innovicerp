// ADR-253 — every NEW Route Card waits for approval. Integration test on the
// house harness (TEST database, never production — see global-setup).
//
// Covers: create → pending, no RM backfill while pending; approve → approved +
// RM backfilled to a blank waiting plan; reject needs a reason (400); reject →
// rejected, an edit sends it back to pending with the rejection cleared; two
// approvals at once → exactly one wins, the loser's 409 names the approver;
// no Approve tick → 403; the creator may approve their own card; with Document
// Edit Approval ON an approved card's edit is staged but a draft card's edit
// saves directly; a Job Card / plan auto-save for an item with no card makes a
// pending card, and leaves a pending card alone. ADR-277 (Draft, Submit, the
// lock on a pending card) has its own describe at the end.

import { and, eq, like, ne, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CreateRouteCardOpInput,
  rejectRouteCardInputSchema,
  ROUTE_CARD_LOCKED_MESSAGE,
} from '@innovic/shared';
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
import { NOTE_RULES, ruleCond } from '../dashboard/personal/note-rules';
import { getDefaultRouteOpsForItem } from '../plans/service';
import { restoreFromTrash } from '../trash/service';
import { approveRouteCard, rejectRouteCard, submitRouteCard } from './approval';
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

/** Planning L2: entry on Route Card Master, no Edit and no Approve. */
const entryOnly = (): AuthContext =>
  asAccess(admin, { departments: { planning: 'L2' } }, 'operator');

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
      procurementType: 'buy', // not a Drawing Rev test — a MAKE card needs one (0232)
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  return rows[0]!.id;
}

async function newCard(
  user: AuthContext,
  extra: {
    rawMaterialGradeText?: string;
    rawMaterialSizeText?: string;
    submitForApproval?: boolean;
  } = {},
) {
  const itemId = await newItem();
  const card = await service.createRouteCard(
    { code: `${TEST_PREFIX}RC${itemSeq}`, itemId, ops: ops(), ...extra },
    user,
  );
  return { itemId, card };
}

const newDraft = (user: AuthContext) => newCard(user, { submitForApproval: false });

/** Would the approvers' bell fire on this card's activity row? The real rule
 *  condition run on the real row; the zero id is "not the actor". */
async function bellFires(cardId: string, action: 'CREATE' | 'EDIT' | 'RESTORE'): Promise<boolean> {
  const rule = NOTE_RULES.find((r) => r.entity === 'RouteCard' && r.action === action)!;
  const nobody = '00000000-0000-0000-0000-000000000000';
  const rows = await db.execute(sql`
    SELECT 1 FROM public.activity_log a
    WHERE a.entity_id = ${cardId}::uuid AND ${ruleCond(rule, admin.companyId!, nobody)}`);
  return rows.length > 0;
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
      `was returned to creator by ${adminName}`,
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

  it('Document Edit Approval ON: an approved card edit is staged, a draft card edit saves directly', async () => {
    const a = await newCard(approver());
    const approvedCard = await approveRouteCard(a.card.id, {}, approver());
    const p = await newDraft(approver());
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
          ops: ops('draft card change'),
          submitForApproval: false,
          expectedUpdatedAt: p.card.updatedAt,
        },
        approver(),
      );
      expect('staged' in direct).toBe(false);
      const detail = direct as Awaited<ReturnType<typeof service.getRouteCard>>;
      expect(detail.approvalStatus).toBe('draft');
      expect(detail.ops[0]!.operation).toBe('draft card change');
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
        null,
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
        null,
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
        null,
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
        null,
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
        null,
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
    // The approver's token predates the submit that made the card pending.
    const { card } = await newDraft(approver());
    const edited = await submitRouteCard(
      card.id,
      { expectedUpdatedAt: card.updatedAt },
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

describe('Route Card Draft, Submit and the lock while pending (ADR-277)', () => {
  it('Save → Draft: not on the approver list, no bell. Save & Submit → Pending, bell.', async () => {
    const draft = await newDraft(approver());
    expect(draft.card.approvalStatus).toBe('draft');
    const inbox = await getApprovalInbox(approver());
    expect(inbox.rc.map((r) => r.id)).not.toContain(draft.card.id);
    expect(await bellFires(draft.card.id, 'CREATE')).toBe(false);

    const sent = await newCard(approver(), { submitForApproval: true });
    expect(sent.card.approvalStatus).toBe('pending');
    expect(await bellFires(sent.card.id, 'CREATE')).toBe(true);
    // A CREATE row with no `changes` (every card before this change) keeps its bell.
    const legacy = await newCard(approver());
    expect(legacy.card.approvalStatus).toBe('pending');
    await db
      .update(activityLog)
      .set({ changes: null })
      .where(eq(activityLog.entityId, legacy.card.id));
    expect(await bellFires(legacy.card.id, 'CREATE')).toBe(true);
  });

  it('a Draft save keeps Rev 0 and overwrites its snapshot, also on the save that submits it', async () => {
    const { itemId, card } = await newDraft(approver());
    const saved = await service.updateRouteCard(
      card.id,
      {
        code: card.code,
        itemId,
        ops: ops('second try'),
        submitForApproval: false,
        expectedUpdatedAt: card.updatedAt,
      },
      approver(),
    );
    expect(saved.approvalStatus).toBe('draft');
    expect(saved.currentRevision).toBe(0);
    expect(saved.revisions).toHaveLength(1);
    expect(saved.revisions[0]!.revisionNo).toBe(0);
    expect(saved.revisions[0]!.opsSnapshot[0]!.operation).toBe('second try');

    // The save is logged with its op change, and no Rev change.
    const logged = await db
      .select({ opRef: activityLog.opRef, changes: activityLog.changes })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, card.id), eq(activityLog.action, 'EDIT')));
    expect(logged.some((r) => r.opRef !== null)).toBe(true);
    expect(JSON.stringify(logged)).not.toContain('currentRevision');
    expect(await bellFires(card.id, 'EDIT')).toBe(false);

    const submitted = await service.updateRouteCard(
      card.id,
      { code: card.code, itemId, ops: ops('third try'), expectedUpdatedAt: saved.updatedAt },
      approver(),
    );
    expect(submitted.approvalStatus).toBe('pending');
    expect(submitted.currentRevision).toBe(0);
    expect(submitted.revisions).toHaveLength(1);
    expect(submitted.revisions[0]!.opsSnapshot[0]!.operation).toBe('third try');
    expect(await bellFires(card.id, 'EDIT')).toBe(true);
  });

  it('Load default ops skips a Draft; Submit re-checks its masters', async () => {
    const { card } = await newDraft(approver());
    const none = await getDefaultRouteOpsForItem(card.itemId, approver());
    expect(none.routeCardCode).toBeNull();

    await db.update(machines).set({ deletedAt: new Date() }).where(eq(machines.id, machineId));
    try {
      await expect(submitRouteCard(card.id, {}, approver())).rejects.toThrow(
        'no longer in its master',
      );
    } finally {
      await db.update(machines).set({ deletedAt: null }).where(eq(machines.id, machineId));
    }
    await submitRouteCard(card.id, {}, approver());
    const sent = await getDefaultRouteOpsForItem(card.itemId, approver());
    expect(sent.routeCardCode).toBe(card.code);
  });

  it('Submit for Approval: Draft → Pending with the bell; approving a Draft is refused', async () => {
    const { card } = await newDraft(approver());
    await expect(approveRouteCard(card.id, {}, approver())).rejects.toThrow(
      'it has not been submitted for approval yet',
    );
    await expect(rejectRouteCard(card.id, { reason: 'x' }, approver())).rejects.toThrow(
      'it has not been submitted for approval yet',
    );
    const stale = '2020-01-01T00:00:00.000Z';
    const refused = await submitRouteCard(card.id, { expectedUpdatedAt: stale }, approver())
      .then(() => null)
      .catch((e: unknown) => e);
    expect((refused as AppError).statusCode).toBe(409);

    const sent = await submitRouteCard(card.id, { expectedUpdatedAt: card.updatedAt }, approver());
    expect(sent.approvalStatus).toBe('pending');
    expect(await bellFires(card.id, 'EDIT')).toBe(true);
    await expect(submitRouteCard(card.id, {}, approver())).rejects.toThrow(
      'is already waiting for approval',
    );
    await approveRouteCard(card.id, {}, approver());
    await expect(submitRouteCard(card.id, {}, approver())).rejects.toThrow('already approved by');
  });

  it('two Submits at once: exactly one wins', async () => {
    const { card } = await newDraft(approver());
    const results = await Promise.allSettled([
      submitRouteCard(card.id, {}, approver()),
      submitRouteCard(card.id, {}, approver()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(bad).toHaveLength(1);
    expect(bad[0]!.reason).toBeInstanceOf(ConflictError);
  });

  it('a Pending card is locked for everybody, even from a form opened before it was sent', async () => {
    const { itemId, card } = await newDraft(approver());
    const openedBefore = {
      code: card.code,
      itemId,
      ops: ops('too late'),
      expectedUpdatedAt: card.updatedAt,
    };
    await submitRouteCard(card.id, {}, approver());

    for (const user of [admin, approver(), editorOnly(), entryOnly()]) {
      await expect(service.updateRouteCard(card.id, openedBefore, user)).rejects.toThrow(
        ROUTE_CARD_LOCKED_MESSAGE,
      );
      await expect(service.updateRouteCardOrStage(card.id, openedBefore, user)).rejects.toThrow(
        ROUTE_CARD_LOCKED_MESSAGE,
      );
    }
    await expect(service.softDeleteRouteCard(card.id, admin)).rejects.toThrow(
      ROUTE_CARD_LOCKED_MESSAGE,
    );
    const still = await service.getRouteCard(card.id, admin);
    expect(still.ops[0]!.operation).toBe('od turn');
    expect(still.deletedAt).toBeNull();
  });

  it('Rejected: Save keeps the reason and the status; Submit clears them', async () => {
    const { itemId, card } = await newCard(approver());
    const rejected = await rejectRouteCard(card.id, { reason: 'Fix op' }, approver());
    const saved = await service.updateRouteCard(
      card.id,
      {
        code: card.code,
        itemId,
        ops: ops('fixed'),
        submitForApproval: false,
        expectedUpdatedAt: rejected.updatedAt,
      },
      approver(),
    );
    expect(saved.approvalStatus).toBe('rejected');
    expect(saved.rejectionReason).toBe('Fix op');
    expect(saved.rejectedBy).not.toBeNull();
    expect(saved.currentRevision).toBe(1); // a Rejected card keeps today's bump

    const sent = await submitRouteCard(card.id, { expectedUpdatedAt: saved.updatedAt }, approver());
    expect(sent.approvalStatus).toBe('pending');
    expect(sent.rejectionReason).toBeNull();
    expect(sent.rejectedBy).toBeNull();
    expect(sent.rejectedAt).toBeNull();
  });

  it("Entry-only: own Draft and Rejected yes; another person's Draft and an approved card no", async () => {
    const { itemId, card } = await newDraft(entryOnly());
    const saved = await service.updateRouteCard(
      card.id,
      {
        code: card.code,
        itemId,
        ops: ops('mine'),
        submitForApproval: false,
        expectedUpdatedAt: card.updatedAt,
      },
      entryOnly(),
    );
    expect(saved.ops[0]!.operation).toBe('mine');

    const others = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, admin.companyId!), ne(users.id, admin.id)))
      .limit(1);
    if (!others[0]) throw new Error('Needs a second user in the company');
    const theirs = await newDraft(approver());
    await db
      .update(routeCards)
      .set({ createdBy: others[0].id })
      .where(eq(routeCards.id, theirs.card.id));
    const save = { code: theirs.card.code, itemId: theirs.itemId, ops: ops('not mine') };
    await expect(service.updateRouteCard(theirs.card.id, save, entryOnly())).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(submitRouteCard(theirs.card.id, {}, entryOnly())).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    // The Edit right is not tied to the creator.
    await expect(submitRouteCard(theirs.card.id, {}, editorOnly())).resolves.toMatchObject({
      approvalStatus: 'pending',
    });

    await submitRouteCard(card.id, {}, entryOnly());
    await rejectRouteCard(card.id, { reason: 'x' }, approver());
    await expect(submitRouteCard(card.id, {}, entryOnly())).resolves.toMatchObject({
      approvalStatus: 'pending',
    });
    await approveRouteCard(card.id, {}, approver());
    await expect(
      service.updateRouteCard(
        card.id,
        { code: card.code, itemId, ops: ops('after approval') },
        entryOnly(),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("an approved card ignores the flag and keeps today's revision bump", async () => {
    const { itemId, card } = await newCard(approver());
    const approved = await approveRouteCard(card.id, {}, approver());
    for (const submitForApproval of [false, true]) {
      const cur = await service.getRouteCard(card.id, admin);
      const saved = await service.updateRouteCard(
        card.id,
        {
          code: card.code,
          itemId,
          ops: ops(`edit ${submitForApproval}`),
          submitForApproval,
          expectedUpdatedAt: cur.updatedAt,
        },
        approver(),
      );
      expect(saved.approvalStatus).toBe('approved');
      expect(saved.approvedBy).toBe(approved.approvedBy);
      expect(saved.currentRevision).toBe(cur.currentRevision + 1);
    }
  });

  it('Trash: a Draft comes back a Draft with no bell; any other card comes back Pending', async () => {
    const { card } = await newDraft(approver());
    await service.softDeleteRouteCard(card.id, admin);
    await restoreFromTrash({ type: 'Route Card', id: card.id }, admin);
    const back = await service.getRouteCard(card.id, admin);
    expect(back.approvalStatus).toBe('draft');
    expect(await bellFires(card.id, 'RESTORE')).toBe(false);

    const other = await newCard(approver());
    await approveRouteCard(other.card.id, {}, approver());
    await service.softDeleteRouteCard(other.card.id, admin);
    await restoreFromTrash({ type: 'Route Card', id: other.card.id }, admin);
    const otherBack = await service.getRouteCard(other.card.id, admin);
    expect(otherBack.approvalStatus).toBe('pending');
    expect(await bellFires(other.card.id, 'RESTORE')).toBe(true);
  });

  it('a Job Card auto-save names the Draft and leaves it alone', async () => {
    const { itemId, card } = await newDraft(approver());
    const blankRm = {
      rawMaterialGradeId: null,
      rawMaterialGradeText: null,
      rawMaterialSizeId: null,
      rawMaterialSizeText: null,
      rawMaterialItemId: null,
      rmQtyPerPiece: null,
    };
    const res = await withUserContext(admin, (tx) =>
      service.saveRouteCardForItem(
        tx,
        admin.companyId!,
        itemId,
        ops('from jc'),
        admin,
        `${TEST_PREFIX}JC9`,
        blankRm,
        null,
      ),
    );
    expect(res?.notSentReason).toBe(
      `Route Card ${card.code} is a Draft — this routing was not copied to it.`,
    );
    const still = await service.getRouteCard(card.id, admin);
    expect(still.ops[0]!.operation).toBe('od turn');
  });
});
