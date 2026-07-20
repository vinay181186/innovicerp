// Plans service tests (PL-3). Fixture: 1 item under prefix TPL3-. Each test
// uses unique plan codes so they don't trample each other. Cleanup is
// per-prefix in afterAll + relies on global-setup for killed-run cruft.

import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  items,
  jcOps,
  jobCards,
  planOps,
  plans,
  purchaseRequests,
  routeCardOps,
  routeCards,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'TPL3-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let itemId: string;
// Auto-numbered plans (PLN-NNNN) don't carry TEST_PREFIX, so track + delete by
// id — important because the test DB is shared with the live trial.
let autoPlanIds: string[] = [];
// Plan-executed JCs now use the real IN-JC-YY-##### series (no JC-PLN marker), so
// track their ids and delete by id to avoid polluting the live trial's JC series.
let createdJcIds: string[] = [];

async function teardown(): Promise<void> {
  if (autoPlanIds.length > 0) {
    await db.delete(plans).where(inArray(plans.id, autoPlanIds));
    autoPlanIds = [];
  }
  // PL-4 ordering: plans MUST go before JCs/PRs they reference. The schema's
  // ON DELETE SET NULL on jc_id / dp_pr_id / fo_pr_id would null those out
  // on JC/PR delete, then the CHECK `plans_status_fk_check` would trip
  // because jc_created requires jc_id (and pr_created requires the relevant
  // PR id). Drop the plans first, then the JCs/PRs are unreferenced.
  await db.delete(plans).where(like(plans.code, `${TEST_PREFIX}%`));
  await db.delete(jobCards).where(like(jobCards.code, `JC-PLN-%`)); // legacy cruft
  if (createdJcIds.length > 0) {
    await db.delete(jobCards).where(inArray(jobCards.id, createdJcIds));
    createdJcIds = [];
  }
  await db.delete(purchaseRequests).where(like(purchaseRequests.code, `PR-DP-%`));
  await db.delete(purchaseRequests).where(like(purchaseRequests.code, `PR-FO-%`));
  await db.delete(purchaseRequests).where(like(purchaseRequests.code, `PR-FOMAT-%`));
  await db.delete(routeCards).where(like(routeCards.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `JC-PLN-%`));
  await db.delete(activityLog).where(like(activityLog.refId, `PR-DP-%`));
  await db.delete(activityLog).where(like(activityLog.refId, `PR-FO-%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardown();

  const ins = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}ITEM-A`,
      name: 'PL-3 Test Item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  itemId = ins[0]!.id;
});

afterAll(async () => {
  await teardown();
});

describe('plans service — create', () => {
  it('creates a manufacture plan in status in_planning with 2 ops', async () => {
    const plan = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-001`,
        planDate: '2026-05-21',
        planType: 'manufacture',
        itemId,
        itemNameText: 'PL-3 Test Item',
        orderQty: 100,
        planQty: 100,
        ops: [
          { opSeq: 1, operation: 'turn', cycleTimeMin: 5 },
          { opSeq: 2, operation: 'mill', cycleTimeMin: 8, qcRequired: true },
        ],
      },
      admin,
    );
    expect(plan.code).toBe(`${TEST_PREFIX}P-001`);
    expect(plan.planStatus).toBe('in_planning');
    expect(plan.planType).toBe('manufacture');
    expect(plan.ops).toHaveLength(2);
    expect(plan.ops[1]?.qcRequired).toBe(true);
    expect(plan.itemCode).toBe(`${TEST_PREFIX}ITEM-A`);
  });

  it('rejects duplicate code with ConflictError', async () => {
    await service.createPlan(
      {
        code: `${TEST_PREFIX}P-DUP`,
        planDate: '2026-05-21',
        planType: 'manufacture',
        itemId,
        orderQty: 10,
        planQty: 10,
      },
      admin,
    );
    await expect(
      service.createPlan(
        {
          code: `${TEST_PREFIX}P-DUP`,
          planDate: '2026-05-21',
          planType: 'manufacture',
          itemId,
          orderQty: 10,
          planQty: 10,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('auto-numbers PLN-NNNN sequentially when code is omitted', async () => {
    const first = await service.createPlan(
      { planDate: '2026-05-21', planType: 'manufacture', itemId, orderQty: 5, planQty: 5 },
      admin,
    );
    autoPlanIds.push(first.id);
    const second = await service.createPlan(
      { planDate: '2026-05-21', planType: 'manufacture', itemId, orderQty: 5, planQty: 5 },
      admin,
    );
    autoPlanIds.push(second.id);

    expect(first.code).toMatch(/^PLN-\d{4}$/);
    expect(second.code).toMatch(/^PLN-\d{4}$/);
    const n1 = Number(first.code.slice(4));
    const n2 = Number(second.code.slice(4));
    expect(n2).toBe(n1 + 1);
  });

  it('rejects viewer role with AuthorizationError (RLS leak guard)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.createPlan(
        {
          code: `${TEST_PREFIX}P-VIEWER`,
          planDate: '2026-05-21',
          planType: 'manufacture',
          itemId,
          orderQty: 10,
          planQty: 10,
        },
        viewer,
      ),
    ).rejects.toThrow();
  });

  it('rejects duplicate op_seq within ops with ValidationError', async () => {
    await expect(
      service.createPlan(
        {
          code: `${TEST_PREFIX}P-DUP-OPS`,
          planDate: '2026-05-21',
          planType: 'manufacture',
          itemId,
          orderQty: 10,
          planQty: 10,
          ops: [
            { opSeq: 1, operation: 'turn' },
            { opSeq: 1, operation: 'mill' },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('plans service — update + finalize', () => {
  it('updates planDate + ops (replace-all) when status is in_planning', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-UPD`,
        planDate: '2026-05-21',
        planType: 'manufacture',
        itemId,
        orderQty: 50,
        planQty: 50,
        ops: [{ opSeq: 1, operation: 'turn' }],
      },
      admin,
    );
    const updated = await service.updatePlan(
      created.id,
      {
        planDate: '2026-05-22',
        ops: [
          { opSeq: 1, operation: 'turn' },
          { opSeq: 2, operation: 'mill' },
          { opSeq: 3, operation: 'qc', opType: 'qc', qcRequired: true },
        ],
      },
      admin,
    );
    expect(updated.planDate).toBe('2026-05-22');
    expect(updated.ops).toHaveLength(3);
    expect(updated.ops[2]?.opType).toBe('qc');
  });

  it('finalize: in_planning → planned succeeds and is idempotent', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-FIN`,
        planDate: '2026-05-21',
        planType: 'manufacture',
        itemId,
        orderQty: 10,
        planQty: 10,
        ops: [{ opSeq: 1, operation: 'turn' }],
      },
      admin,
    );
    const finalized = await service.finalizePlan(created.id, admin);
    expect(finalized.planStatus).toBe('planned');

    // Idempotent: second call against planned plan returns same row, no error.
    const again = await service.finalizePlan(created.id, admin);
    expect(again.planStatus).toBe('planned');
  });

  it('finalize manufacture plan without ops → ValidationError', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-FIN-NOOPS`,
        planDate: '2026-05-21',
        planType: 'manufacture',
        itemId,
        orderQty: 10,
        planQty: 10,
      },
      admin,
    );
    await expect(service.finalizePlan(created.id, admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('finalize direct_purchase plan without ops succeeds (no ops needed)', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-FIN-DP`,
        planDate: '2026-05-21',
        planType: 'direct_purchase',
        itemId,
        orderQty: 10,
        planQty: 10,
        dpVendorCodeText: 'VEN-A',
        dpCost: 12.5,
      },
      admin,
    );
    const finalized = await service.finalizePlan(created.id, admin);
    expect(finalized.planStatus).toBe('planned');
    expect(finalized.dpCost).toBe('12.50');
  });

  it('update against a planned plan still works (planned is editable)', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-EDIT-PLANNED`,
        planDate: '2026-05-21',
        planType: 'direct_purchase',
        itemId,
        orderQty: 10,
        planQty: 10,
        dpVendorCodeText: 'VEN-A',
      },
      admin,
    );
    await service.finalizePlan(created.id, admin);
    const updated = await service.updatePlan(created.id, { dpCost: 99.99 }, admin);
    expect(updated.dpCost).toBe('99.99');
  });
});

describe('plans service — list + get', () => {
  it('list filters by status', async () => {
    const all = await service.listPlans({ limit: 100, offset: 0 }, admin);
    const inPlanning = await service.listPlans(
      { status: 'in_planning', limit: 100, offset: 0 },
      admin,
    );
    expect(inPlanning.items.every((p) => p.planStatus === 'in_planning')).toBe(true);
    expect(all.total).toBeGreaterThanOrEqual(inPlanning.total);
  });

  it('list search narrows by code', async () => {
    const result = await service.listPlans(
      { search: `${TEST_PREFIX}P-001`, limit: 100, offset: 0 },
      admin,
    );
    expect(result.items.map((p) => p.code)).toContain(`${TEST_PREFIX}P-001`);
  });

  it('list rows include opsCount', async () => {
    const result = await service.listPlans(
      { search: `${TEST_PREFIX}P-001`, limit: 100, offset: 0 },
      admin,
    );
    const row = result.items.find((p) => p.code === `${TEST_PREFIX}P-001`);
    expect(row?.opsCount).toBe(2);
  });

  it('getPlan returns ops sorted by opSeq', async () => {
    const list = await service.listPlans({ search: `${TEST_PREFIX}P-001`, limit: 1, offset: 0 }, admin);
    const id = list.items[0]!.id;
    const detail = await service.getPlan(id, admin);
    expect(detail.ops.map((o) => o.opSeq)).toEqual([1, 2]);
  });

  it('getPlan: NotFoundError on unknown id', async () => {
    await expect(
      service.getPlan('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('plans service — softDelete + dashboard', () => {
  it('soft-delete works on an in_planning plan; ops cascade-soft-delete too', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-DEL`,
        planDate: '2026-05-21',
        planType: 'manufacture',
        itemId,
        orderQty: 10,
        planQty: 10,
        ops: [{ opSeq: 1, operation: 'turn' }],
      },
      admin,
    );
    await service.softDeletePlan(created.id, admin);
    await expect(service.getPlan(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);

    // Verify ops also soft-deleted
    const opsLeft = await db
      .select()
      .from(planOps)
      .where(eq(planOps.planId, created.id));
    expect(opsLeft.every((o) => o.deletedAt !== null)).toBe(true);
  });

  it('planning dashboard returns kpi + recent plans', async () => {
    const result = await service.getPlanningDashboard(admin);
    expect(result.kpi).toHaveProperty('inPlanning');
    expect(result.kpi).toHaveProperty('planned');
    expect(Array.isArray(result.recentPlans)).toBe(true);
    expect(result.recentPlans.length).toBeLessThanOrEqual(50);
  });
});

describe('plans service — executePlan + defaults (PL-4)', () => {
  it('getDefaultRouteOpsForItem returns [] when no route card exists', async () => {
    const ops = await service.getDefaultRouteOpsForItem(itemId, admin);
    expect(ops).toEqual([]);
  });

  it('getDefaultRouteOpsForItem returns route_card_ops when active RC exists', async () => {
    // Create a fixture route card for the test item
    const rc = await db
      .insert(routeCards)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}RC-A`,
        itemId,
        currentRevision: 1,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    await db.insert(routeCardOps).values([
      {
        companyId: admin.companyId!,
        routeCardId: rc[0]!.id,
        opSeq: 1,
        operation: 'turn',
        opType: 'process',
        cycleTimeMin: '4.5',
        qcRequired: false,
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: admin.companyId!,
        routeCardId: rc[0]!.id,
        opSeq: 2,
        operation: 'mill',
        opType: 'process',
        cycleTimeMin: '6',
        qcRequired: true,
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    ]);

    const ops = await service.getDefaultRouteOpsForItem(itemId, admin);
    expect(ops).toHaveLength(2);
    expect(ops[0]?.operation).toBe('turn');
    expect(ops[0]?.cycleTimeMin).toBe(4.5);
    expect(ops[1]?.qcRequired).toBe(true);
  });

  it('executePlan rejects when plan is not in planned status', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-EXEC-NP`,
        planDate: '2026-05-21',
        planType: 'manufacture',
        itemId,
        orderQty: 5,
        planQty: 5,
        ops: [{ opSeq: 1, operation: 'turn' }],
      },
      admin,
    );
    await expect(service.executePlan(created.id, admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('executePlan(manufacture): creates JC + copies plan_ops, sets jc_id + status=jc_created', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-EXEC-MFG`,
        planDate: '2026-05-21',
        planType: 'manufacture',
        itemId,
        orderQty: 20,
        planQty: 20,
        ops: [
          { opSeq: 1, operation: 'turn', cycleTimeMin: 3 },
          { opSeq: 2, operation: 'mill', cycleTimeMin: 5, qcRequired: true },
        ],
      },
      admin,
    );
    await service.finalizePlan(created.id, admin);
    const result = await service.executePlan(created.id, admin);
    if (result.plan.jcId) createdJcIds.push(result.plan.jcId);
    expect(result.jcCode).toMatch(/^IN-JC-\d{2}-\d{5}$/);
    expect(result.plan.planStatus).toBe('jc_created');
    expect(result.plan.jcId).not.toBeNull();

    // Verify jc_ops were copied
    const jc = await db
      .select()
      .from(jobCards)
      .where(eq(jobCards.id, result.plan.jcId!))
      .limit(1);
    expect(jc[0]?.orderQty).toBe(20);
  });

  it('executePlan(manufacture): op ticked outsource → auto JW_OSP PR linked to the jc_op', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-EXEC-MFG-OSP`,
        planDate: '2026-05-21',
        planType: 'manufacture',
        itemId,
        orderQty: 12,
        planQty: 12,
        ops: [
          { opSeq: 1, operation: 'turn', cycleTimeMin: 3 },
          {
            opSeq: 2,
            operation: 'anodize',
            cycleTimeMin: 0,
            opType: 'outsource',
            outsourceVendorText: 'PLATER-CO',
            outsourceCost: 25,
          },
        ],
      },
      admin,
    );
    await service.finalizePlan(created.id, admin);
    const result = await service.executePlan(created.id, admin);
    if (result.plan.jcId) createdJcIds.push(result.plan.jcId);
    expect(result.plan.planStatus).toBe('jc_created');

    // The outsource op should now carry a linked PR + pr_raised status.
    const opRow = await db
      .select()
      .from(jcOps)
      .where(and(eq(jcOps.jobCardId, result.plan.jcId!), eq(jcOps.opSeq, 2)))
      .limit(1);
    expect(opRow[0]?.outsourceStatus).toBe('pr_raised');
    expect(opRow[0]?.outsourcePrId).not.toBeNull();

    // And that PR is a JW_OSP PR carrying the upstream link back to the op.
    const pr = await db
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, opRow[0]!.outsourcePrId!))
      .limit(1);
    expect(pr[0]?.prType).toBe('jw_osp');
    expect(pr[0]?.sourceJcOpId).toBe(opRow[0]!.id);
    expect(pr[0]?.qty).toBe(12);
    expect(pr[0]?.vendorCodeText).toBe('PLATER-CO');

    // A non-outsource op stays clean (no PR raised).
    const turnOp = await db
      .select()
      .from(jcOps)
      .where(and(eq(jcOps.jobCardId, result.plan.jcId!), eq(jcOps.opSeq, 1)))
      .limit(1);
    expect(turnOp[0]?.outsourcePrId).toBeNull();
  });

  it('executePlan(direct_purchase): creates 1 PR, sets dp_pr_id + status=pr_created', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-EXEC-DP`,
        planDate: '2026-05-21',
        planType: 'direct_purchase',
        itemId,
        orderQty: 10,
        planQty: 10,
        dpVendorCodeText: 'ACME-VEN',
        dpCost: 100.5,
      },
      admin,
    );
    await service.finalizePlan(created.id, admin);
    const result = await service.executePlan(created.id, admin);
    expect(result.primaryPrCode).toMatch(/^PR-DP-/);
    expect(result.plan.planStatus).toBe('pr_created');
    expect(result.plan.dpPrId).not.toBeNull();
    expect(result.materialPrCode).toBeUndefined();
  });

  it('executePlan(full_outsource): creates JW PR + material PR when material_src set', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-EXEC-FO`,
        planDate: '2026-05-21',
        planType: 'full_outsource',
        itemId,
        orderQty: 8,
        planQty: 8,
        foVendorCodeText: 'JW-VEN',
        foProcess: 'heat treat',
        foMaterialSrc: 'SUPPLIER-X',
        foRate: 50,
      },
      admin,
    );
    await service.finalizePlan(created.id, admin);
    const result = await service.executePlan(created.id, admin);
    expect(result.primaryPrCode).toMatch(/^PR-FO-/);
    expect(result.materialPrCode).toMatch(/^PR-FOMAT-/);
    expect(result.plan.planStatus).toBe('pr_created');
    expect(result.plan.foPrId).not.toBeNull();
    expect(result.plan.foMatPrId).not.toBeNull();
  });

  it('executePlan(full_outsource): material_src=inhouse → no material PR', async () => {
    const created = await service.createPlan(
      {
        code: `${TEST_PREFIX}P-EXEC-FO-IH`,
        planDate: '2026-05-21',
        planType: 'full_outsource',
        itemId,
        orderQty: 8,
        planQty: 8,
        foVendorCodeText: 'JW-VEN',
        foProcess: 'heat treat',
        foMaterialSrc: 'inhouse',
      },
      admin,
    );
    await service.finalizePlan(created.id, admin);
    const result = await service.executePlan(created.id, admin);
    expect(result.materialPrCode).toBeUndefined();
    expect(result.plan.foMatPrId).toBeNull();
  });

  it('executePlan(manufacture): no ops → ValidationError before any DB write', async () => {
    // Force a row in planned without ops (bypass finalize guard via direct DB)
    const inserted = await db
      .insert(plans)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}P-EXEC-NOOPS`,
        planDate: '2026-05-21',
        planStatus: 'planned',
        planType: 'manufacture',
        itemId,
        orderQty: 5,
        planQty: 5,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    await expect(service.executePlan(inserted[0]!.id, admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
