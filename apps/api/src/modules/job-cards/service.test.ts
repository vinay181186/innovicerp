// JC list service tests. Uses the existing migrated data on dev Supabase
// (T-029d): 2 surviving JCs (IN-JC-00002, IN-JC-00003), both with their
// source_so_line_id backfilled to SO-436 lines. Read-only — no test
// fixtures inserted; we just assert the service exposes the data correctly.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  machines,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
});

describe('job-cards service', () => {
  it('listJobCards returns headers + computed status + source link for migrated JCs', async () => {
    const result = await service.listJobCards({ limit: 50, offset: 0 }, admin);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    const jc02 = result.items.find((j) => j.code === 'IN-JC-00002');
    const jc03 = result.items.find((j) => j.code === 'IN-JC-00003');
    expect(jc02).toBeDefined();
    expect(jc03).toBeDefined();

    // v_jc_status enrichment present
    expect(typeof jc02!.computedStatus).toBe('string');
    expect(jc02!.totalOps).toBeGreaterThanOrEqual(0);
    expect(jc02!.doneOps).toBeGreaterThanOrEqual(0);

    // SO source link backfilled in T-029d (legacy soRefId -> SO-436 lines)
    expect(jc02!.sourceLink).not.toBeNull();
    expect(jc02!.sourceLink?.type).toBe('so');
    if (jc02!.sourceLink?.type === 'so') {
      expect(jc02!.sourceLink.code).toBe('SO-436');
      expect(jc02!.sourceLink.lineNo).toBe(6);
      expect(jc02!.sourceLink.partName).toBe('JOINT');
    }

    expect(jc03!.sourceLink?.type).toBe('so');
    if (jc03!.sourceLink?.type === 'so') {
      expect(jc03!.sourceLink.code).toBe('SO-436');
      expect(jc03!.sourceLink.lineNo).toBe(4);
      expect(jc03!.sourceLink.partName).toBe('SPACER');
    }

    // Item info joined
    expect(jc02!.itemCode).not.toBe('');
    expect(jc02!.itemName).not.toBe('');
  });

  it('listJobCards filters by status — scoped to migrated IN-JC-0000* JCs', async () => {
    // Use the migrated JCs (IN-JC-00002, IN-JC-00003) as a stable
    // population — other test files create + tear down JCs which would
    // race against an unscoped query.
    const all = await service.listJobCards({ search: 'IN-JC-0000', limit: 200, offset: 0 }, admin);
    expect(all.items.length).toBeGreaterThanOrEqual(2);
    const jc02 = all.items.find((j) => j.code === 'IN-JC-00002');
    expect(jc02).toBeDefined();
    const status = jc02!.computedStatus;
    const filtered = await service.listJobCards(
      { search: 'IN-JC-0000', status, limit: 200, offset: 0 },
      admin,
    );
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every((j) => j.computedStatus === status)).toBe(true);
  });

  it('listJobCards search matches against jc code, item code, and SO source code', async () => {
    const bySoCode = await service.listJobCards({ search: 'SO-436', limit: 50, offset: 0 }, admin);
    // Both surviving JCs are linked to SO-436
    expect(bySoCode.items.length).toBeGreaterThanOrEqual(2);
    expect(
      bySoCode.items.every((j) => j.sourceLink?.type === 'so' && j.sourceLink.code === 'SO-436'),
    ).toBe(true);

    const byJcCode = await service.listJobCards(
      { search: 'IN-JC-00002', limit: 50, offset: 0 },
      admin,
    );
    expect(byJcCode.items.length).toBe(1);
    expect(byJcCode.items[0]?.code).toBe('IN-JC-00002');
  });

  it('listJobCards date range filter inclusive', async () => {
    const all = await service.listJobCards({ limit: 200, offset: 0 }, admin);
    if (all.items.length === 0) return;
    const firstDate = all.items[0]!.jcDate;
    const filtered = await service.listJobCards(
      { fromDate: firstDate, toDate: firstDate, limit: 200, offset: 0 },
      admin,
    );
    expect(filtered.items.every((j) => j.jcDate === firstDate)).toBe(true);
  });

  it('getJobCard returns the single row by id', async () => {
    const list = await service.listJobCards({ limit: 1, offset: 0 }, admin);
    if (list.items.length === 0) return; // nothing seeded
    const target = list.items[0]!;
    const fetched = await service.getJobCard(target.id, admin);
    expect(fetched.id).toBe(target.id);
    expect(fetched.code).toBe(target.code);
    expect(fetched.computedStatus).toBe(target.computedStatus);
  });

  it('getJobCard throws NotFoundError for unknown id', async () => {
    await expect(
      service.getJobCard('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.listJobCards({ limit: 10, offset: 0 }, noCompanyUser),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('job-cards service — writes (ADR-051)', () => {
  const createdIds: string[] = [];
  let itemCode: string | null = null;
  let machineCode: string | null = null;
  // Manual JC creation is now JW-only (governance), so the write tests need a
  // Job Work line to attach to. Created + torn down here (prefix TJC-).
  let jwOrderId: string | null = null;
  let jwLineId: string | null = null;

  beforeAll(async () => {
    const it = (
      await db
        .select({ id: items.id, code: items.code })
        .from(items)
        .where(and(eq(items.companyId, admin.companyId!), isNull(items.deletedAt)))
        .limit(1)
    )[0];
    itemCode = it?.code ?? null;
    const m = (
      await db
        .select({ code: machines.code })
        .from(machines)
        .where(and(eq(machines.companyId, admin.companyId!), isNull(machines.deletedAt)))
        .limit(1)
    )[0];
    machineCode = m?.code ?? null;

    if (it) {
      const jw = (
        await db
          .insert(jobWorkOrders)
          .values({
            companyId: admin.companyId!,
            code: 'TJC-JW-001',
            jwDate: '2026-06-13',
            customerName: 'JC write-test JW',
            status: 'open',
            createdBy: admin.id,
            updatedBy: admin.id,
          })
          .returning()
      )[0]!;
      jwOrderId = jw.id;
      const line = (
        await db
          .insert(jobWorkOrderLines)
          .values({
            companyId: admin.companyId!,
            jobWorkOrderId: jw.id,
            lineNo: 1,
            itemId: it.id,
            partName: 'JC write-test JW line',
            uom: 'NOS',
            orderQty: 100,
            status: 'open',
            createdBy: admin.id,
            updatedBy: admin.id,
          })
          .returning()
      )[0]!;
      jwLineId = line.id;
    }
  });

  afterAll(async () => {
    // Hard-cleanup the test JCs (none have op_log) so we don't leave
    // soft-deleted rows polluting the IN-JC series on the dev DB.
    if (createdIds.length > 0) {
      await db.delete(jcOps).where(inArray(jcOps.jobCardId, createdIds));
      await db.delete(jobCards).where(inArray(jobCards.id, createdIds));
    }
    if (jwOrderId) {
      await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, jwOrderId));
      await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwOrderId));
    }
  });

  it('createJobCard creates a JC with IN-JC series code + ops', async () => {
    if (!itemCode || !machineCode || !jwLineId) return; // no master data on this DB
    const jc = await service.createJobCard(
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 5,
        priority: 'normal',
        sourceJwLineId: jwLineId,
        ops: [
          {
            operation: 'CNC Turning',
            opType: 'process',
            machineCode,
            cycleTimeMin: 1.5,
            qcRequired: false,
            outsourceCost: 0,
          },
          { operation: 'Final Inspection', opType: 'qc', cycleTimeMin: 0, qcRequired: true, outsourceCost: 0 },
        ],
        qcDocs: [],
      },
      admin,
    );
    createdIds.push(jc.id);
    expect(jc.code).toMatch(/^IN-JC-\d{2}-\d{5}$/);
    expect(jc.itemCode).toBe(itemCode);
    expect(jc.orderQty).toBe(5);
    expect(jc.totalOps).toBe(2);
  });

  it('updateJobCard changes header + replaces ops (renumbered)', async () => {
    if (!itemCode || !machineCode || !jwLineId) return;
    const jc = await service.createJobCard(
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 5,
        priority: 'normal',
        sourceJwLineId: jwLineId,
        ops: [
          { operation: 'Op A', opType: 'process', machineCode, cycleTimeMin: 1, qcRequired: false, outsourceCost: 0 },
          { operation: 'Op B', opType: 'process', machineCode, cycleTimeMin: 2, qcRequired: false, outsourceCost: 0 },
        ],
        qcDocs: [],
      },
      admin,
    );
    createdIds.push(jc.id);
    const updated = await service.updateJobCard(
      jc.id,
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 9,
        priority: 'high',
        ops: [
          { operation: 'Op A only', opType: 'process', machineCode, cycleTimeMin: 3, qcRequired: false, outsourceCost: 0 },
        ],
        qcDocs: [],
      },
      admin,
    );
    expect(updated.orderQty).toBe(9);
    expect(updated.priority).toBe('high');
    expect(updated.totalOps).toBe(1);
  });

  it('createJobCard rejects a direct (non-JW) Job Card (governance)', async () => {
    await expect(
      service.createJobCard(
        {
          jcDate: '2026-06-13',
          itemCode: itemCode ?? 'X',
          orderQty: 1,
          priority: 'normal',
          // no sourceJwLineId → direct JC, must be rejected
          ops: [],
          qcDocs: [],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('createJobCard rejects an unknown item (with a valid JW source)', async () => {
    if (!jwLineId) return;
    await expect(
      service.createJobCard(
        {
          jcDate: '2026-06-13',
          itemCode: 'NOPE-NOT-AN-ITEM-ZZZ',
          orderQty: 1,
          priority: 'normal',
          sourceJwLineId: jwLineId,
          ops: [],
          qcDocs: [],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('createJobCard is write-role gated (viewer rejected)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.createJobCard(
        {
          jcDate: '2026-06-13',
          itemCode: itemCode ?? 'X',
          orderQty: 1,
          priority: 'normal',
          ops: [],
          qcDocs: [],
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('deleteJobCard soft-deletes (admin) then the JC 404s', async () => {
    if (!itemCode || !jwLineId) return;
    const jc = await service.createJobCard(
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 2,
        priority: 'normal',
        sourceJwLineId: jwLineId,
        ops: [],
        qcDocs: [],
      },
      admin,
    );
    createdIds.push(jc.id);
    await service.deleteJobCard(jc.id, admin);
    await expect(service.getJobCard(jc.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});
