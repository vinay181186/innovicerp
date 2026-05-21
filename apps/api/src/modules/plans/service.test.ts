// Plans service tests (PL-3). Fixture: 1 item under prefix TPL3-. Each test
// uses unique plan codes so they don't trample each other. Cleanup is
// per-prefix in afterAll + relies on global-setup for killed-run cruft.

import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, items, planOps, plans, users } from '../../db/schema';
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

async function teardown(): Promise<void> {
  await db.delete(plans).where(like(plans.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
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
