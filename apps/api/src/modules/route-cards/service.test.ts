// Route Card service tests (RC-3). Covers the legacy renderRouteCards
// workflows (legacy/InnovicERP_v82_12_3.html L10078) plus the revision
// audit + one-active-RC-per-item guard that our schema enforces in DB.

import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, items, machines, routeCards, users, vendors } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';
import { computeRouteCardDiffNote } from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TRC-';

let admin: AuthContext;
let testItemId1: string;
let testItemId2: string;
let testMachineId: string;
let testVendorId: string;

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
  // Clear any prior test leftovers.
  await db.delete(routeCards).where(like(routeCards.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(machines).where(like(machines.code, `${TEST_PREFIX}%`));
  await db.delete(vendors).where(like(vendors.code, `${TEST_PREFIX}%`));

  const it = await db
    .insert(items)
    .values([
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}A`,
        name: 'RC test A',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}B`,
        name: 'RC test B',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    ])
    .returning();
  testItemId1 = it[0]!.id;
  testItemId2 = it[1]!.id;

  const m = await db
    .insert(machines)
    .values({
      companyId: u.companyId,
      code: `${TEST_PREFIX}MACH`,
      name: 'RC test machine',
      machineType: 'cnc',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testMachineId = m[0]!.id;

  const v = await db
    .insert(vendors)
    .values({
      companyId: u.companyId,
      code: `${TEST_PREFIX}VEND`,
      name: 'RC test vendor',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testVendorId = v[0]!.id;
});

afterAll(async () => {
  // Clean up activity_log rows emitted by service so other tests
  // (e.g. activity-log pagination) don't see them in their result
  // set under parallel test runs. Scoped to TEST_PREFIX so real
  // route-card audit rows from a parallel-running app session are
  // never touched.
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
  await db.delete(routeCards).where(like(routeCards.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(machines).where(like(machines.code, `${TEST_PREFIX}%`));
  await db.delete(vendors).where(like(vendors.code, `${TEST_PREFIX}%`));
});

describe('route-card service — pure helpers', () => {
  it('computeRouteCardDiffNote: added + removed + changed', () => {
    const oldOps = [
      { opSeq: 1, machineCode: 'M1', operation: 'turn', opType: 'process', cycleTimeMin: '1.00' },
      { opSeq: 2, machineCode: 'M2', operation: 'mill', opType: 'process', cycleTimeMin: '2.00' },
    ];
    const newOps = [
      { opSeq: 1, machineCode: 'M1', operation: 'turn', opType: 'process', cycleTimeMin: '5.00' }, // cycle change
      { opSeq: 2, machineCode: 'M3', operation: 'mill', opType: 'process', cycleTimeMin: '2.00' }, // machine change
      { opSeq: 3, machineCode: 'QC', operation: 'DIR', opType: 'qc', cycleTimeMin: '0.50' }, // added
    ];
    const note = computeRouteCardDiffNote(oldOps, newOps);
    expect(note).toContain('Added: 3. DIR');
    expect(note).toContain('Changed: 1. turn');
    expect(note).toContain('cycle 1.00 → 5.00');
    expect(note).toContain('machine M2 → M3');
  });

  it('computeRouteCardDiffNote: no changes returns canonical string', () => {
    const ops = [
      { opSeq: 1, machineCode: 'M1', operation: 'turn', opType: 'process', cycleTimeMin: '1.00' },
    ];
    expect(computeRouteCardDiffNote(ops, ops)).toBe('No op changes');
  });

  it('computeRouteCardDiffNote: op_type and vendor changes captured', () => {
    const o = [
      {
        opSeq: 1,
        machineCode: 'M1',
        operation: 'coat',
        opType: 'process',
        cycleTimeMin: '1.00',
      },
    ];
    const n = [
      {
        opSeq: 1,
        machineCode: null,
        operation: 'coat',
        opType: 'outsource',
        cycleTimeMin: '1.00',
        ospVendorCode: 'V1',
        ospLeadDays: 5,
      },
    ];
    const note = computeRouteCardDiffNote(o, n);
    expect(note).toContain('type process → outsource');
    expect(note).toContain('vendor — → V1');
    expect(note).toContain('lead — → 5d');
  });
});

describe('route-card service — CRUD', () => {
  it('createRouteCard auto-generates IN-RC-NNNNN when code omitted', async () => {
    const detail = await service.createRouteCard(
      {
        itemId: testItemId1,
        ops: [
          {
            machineId: testMachineId,
            operation: 'od turn',
            opType: 'process',
            cycleTimeMin: 1.5,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    expect(detail.code).toMatch(/^IN-RC-\d{5}$/);
    expect(detail.currentRevision).toBe(1);
    expect(detail.ops).toHaveLength(1);
    expect(detail.ops[0]!.opSeq).toBe(1);
    expect(detail.ops[0]!.machineCode).toBe(`${TEST_PREFIX}MACH`);
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]!.notes).toBe('Initial creation');

    // Cleanup so the next nextRouteCardCode doesn't drift + drop
    // the auto-numbered code's audit row (afterAll's TEST_PREFIX
    // scope misses it).
    await db.delete(activityLog).where(eq(activityLog.refId, detail.code));
    await db.delete(routeCards).where(eq(routeCards.id, detail.id));
  });

  it('createRouteCard honours an explicit code + multi-op sequence', async () => {
    const code = `${TEST_PREFIX}EXP1`;
    const detail = await service.createRouteCard(
      {
        code,
        itemId: testItemId1,
        notes: 'machined then inspected',
        ops: [
          {
            machineId: testMachineId,
            operation: 'od turn',
            opType: 'process',
            cycleTimeMin: 1.5,
            program: 'PRG-001',
            toolNo: 'T01',
            qcRequired: false,
          },
          {
            machineCodeText: 'QC',
            operation: 'DIR',
            opType: 'qc',
            cycleTimeMin: 0.25,
            qcRequired: true,
          },
        ],
      },
      admin,
    );
    expect(detail.code).toBe(code);
    expect(detail.ops).toHaveLength(2);
    expect(detail.ops[0]!.opSeq).toBe(1);
    expect(detail.ops[1]!.opSeq).toBe(2);
    expect(detail.ops[1]!.opType).toBe('qc');
    expect(detail.ops[1]!.machineCodeText).toBe('QC');
  });

  it('createRouteCard rejects a second active RC for the same item (ConflictError)', async () => {
    await service.createRouteCard(
      {
        code: `${TEST_PREFIX}DUP-ITEM-1`,
        itemId: testItemId2,
        ops: [
          {
            machineId: testMachineId,
            operation: 'turn',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    await expect(
      service.createRouteCard(
        {
          code: `${TEST_PREFIX}DUP-ITEM-2`,
          itemId: testItemId2,
          ops: [
            {
              machineId: testMachineId,
              operation: 'mill',
              opType: 'process',
              cycleTimeMin: 1,
              qcRequired: false,
            },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createRouteCard denies viewer with AuthorizationError', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.createRouteCard(
        {
          code: `${TEST_PREFIX}VIEW1`,
          itemId: testItemId1,
          ops: [
            {
              machineId: testMachineId,
              operation: 'x',
              opType: 'process',
              cycleTimeMin: 1,
              qcRequired: false,
            },
          ],
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('createRouteCard supports OSP op with FK vendor', async () => {
    const code = `${TEST_PREFIX}OSP1`;
    // Use a fresh item (already used testItemId1+2). Insert one-off.
    const it = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}OSP-ITEM`,
        name: 'OSP item',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const detail = await service.createRouteCard(
      {
        code,
        itemId: it[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'turn',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
          {
            operation: 'coating',
            opType: 'outsource',
            cycleTimeMin: 0,
            qcRequired: false,
            ospVendorId: testVendorId,
            ospLeadDays: 5,
          },
        ],
      },
      admin,
    );
    expect(detail.ops).toHaveLength(2);
    expect(detail.ops[1]!.opType).toBe('outsource');
    expect(detail.ops[1]!.ospVendorId).toBe(testVendorId);
    expect(detail.ops[1]!.ospVendorCode).toBe(`${TEST_PREFIX}VEND`);
    expect(detail.ops[1]!.ospLeadDays).toBe(5);
  });

  it('getRouteCard returns header + ops + revisions + item display', async () => {
    const it = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}GET-ITEM`,
        name: 'Get test',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const created = await service.createRouteCard(
      {
        code: `${TEST_PREFIX}GET1`,
        itemId: it[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'turn',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    const detail = await service.getRouteCard(created.id, admin);
    expect(detail.id).toBe(created.id);
    expect(detail.itemCode).toBe(`${TEST_PREFIX}GET-ITEM`);
    expect(detail.itemName).toBe('Get test');
    expect(detail.ops).toHaveLength(1);
    expect(detail.revisions).toHaveLength(1);
  });

  it('getRouteCard throws NotFoundError on unknown id', async () => {
    await expect(
      service.getRouteCard('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updateRouteCard bumps revision + appends snapshot + auto-generates diff note', async () => {
    const it = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}UPD-ITEM`,
        name: 'Update test',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const created = await service.createRouteCard(
      {
        code: `${TEST_PREFIX}UPD1`,
        itemId: it[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'turn',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    expect(created.currentRevision).toBe(1);

    const updated = await service.updateRouteCard(
      created.id,
      {
        code: `${TEST_PREFIX}UPD1`,
        itemId: it[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'turn',
            opType: 'process',
            cycleTimeMin: 1.5, // cycle change
            qcRequired: false,
          },
          {
            machineCodeText: 'QC',
            operation: 'DIR',
            opType: 'qc',
            cycleTimeMin: 0.25,
            qcRequired: true,
          },
        ],
      },
      admin,
    );
    expect(updated.currentRevision).toBe(2);
    expect(updated.ops).toHaveLength(2);
    expect(updated.revisions).toHaveLength(2);
    const rev2 = updated.revisions.find((r) => r.revisionNo === 2)!;
    expect(rev2.notes).toMatch(/Added|Changed/);
  });

  it('updateRouteCard honours caller-provided revisionNote over auto-generated', async () => {
    const it = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}UPD2-ITEM`,
        name: 'Update note test',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const created = await service.createRouteCard(
      {
        code: `${TEST_PREFIX}UPD2`,
        itemId: it[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'turn',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    const customNote = 'Updated per ECO-456';
    const updated = await service.updateRouteCard(
      created.id,
      {
        code: `${TEST_PREFIX}UPD2`,
        itemId: it[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'turn',
            opType: 'process',
            cycleTimeMin: 2,
            qcRequired: false,
          },
        ],
        revisionNote: customNote,
      },
      admin,
    );
    const rev2 = updated.revisions.find((r) => r.revisionNo === 2)!;
    expect(rev2.notes).toBe(customNote);
  });

  it('updateRouteCard rejects move-to-already-claimed-item (ConflictError)', async () => {
    const itA = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}MOVE-A`,
        name: 'A',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const itB = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}MOVE-B`,
        name: 'B',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    // RC for A and RC for B.
    await service.createRouteCard(
      {
        code: `${TEST_PREFIX}MOVE-RC-A`,
        itemId: itA[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'x',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    const rcB = await service.createRouteCard(
      {
        code: `${TEST_PREFIX}MOVE-RC-B`,
        itemId: itB[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'y',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    await expect(
      service.updateRouteCard(
        rcB.id,
        {
          code: `${TEST_PREFIX}MOVE-RC-B`,
          itemId: itA[0]!.id, // collides with RC-A
          ops: [
            {
              machineId: testMachineId,
              operation: 'y',
              opType: 'process',
              cycleTimeMin: 1,
              qcRequired: false,
            },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('updateRouteCard throws NotFoundError on unknown id', async () => {
    await expect(
      service.updateRouteCard(
        '00000000-0000-0000-0000-000000000000',
        {
          code: 'X',
          itemId: testItemId1,
          ops: [
            {
              machineId: testMachineId,
              operation: 'x',
              opType: 'process',
              cycleTimeMin: 1,
              qcRequired: false,
            },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('softDeleteRouteCard denies manager (admin-only)', async () => {
    const it = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}DEL-MGR-ITEM`,
        name: 'Manager delete test',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const created = await service.createRouteCard(
      {
        code: `${TEST_PREFIX}DEL-MGR`,
        itemId: it[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'x',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    const manager: AuthContext = { ...admin, role: 'manager' };
    await expect(service.softDeleteRouteCard(created.id, manager)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('softDeleteRouteCard succeeds + frees item for a new RC', async () => {
    const it = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}DEL-OK-ITEM`,
        name: 'Free item test',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const created = await service.createRouteCard(
      {
        code: `${TEST_PREFIX}DEL-OK-1`,
        itemId: it[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'x',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    const deleted = await service.softDeleteRouteCard(created.id, admin);
    expect(deleted.deletedAt).not.toBeNull();
    // Subsequent get is NotFound (soft-deleted filtered out).
    await expect(service.getRouteCard(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
    // And a brand-new RC for the same item can now be created.
    const replacement = await service.createRouteCard(
      {
        code: `${TEST_PREFIX}DEL-OK-2`,
        itemId: it[0]!.id,
        ops: [
          {
            machineId: testMachineId,
            operation: 'y',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    expect(replacement.id).not.toBe(created.id);
  });
});
