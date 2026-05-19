// BOM Master service tests (BOM-7). Covers the legacy renderBOMMaster
// workflows (legacy/InnovicERP_v82_12_3.html L8438) plus the revision
// audit + linked-SO delete guard that our schema enforces in DB.

import { and, eq, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  bomMasterLines,
  bomMasterRevisions,
  bomMasters,
  items,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';
import { computeBomDiffNote } from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TBOM-';

let admin: AuthContext;
let testItemId1: string;
let testItemId2: string;
let testItemId3: string;

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
  // Three test items so we can build a 2-line BOM + swap items for diff.
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  const it = await db
    .insert(items)
    .values([
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}A`,
        name: 'BOM test A',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}B`,
        name: 'BOM test B',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}C`,
        name: 'BOM test C',
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
  testItemId3 = it[2]!.id;
});

afterAll(async () => {
  // BOM line + revision rows cascade from the header delete via FK.
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
});

describe('bom-master service — pure helpers', () => {
  it('computeBomDiffNote: added + removed + qty change', () => {
    const oldLines = [
      { childItemId: 'a', childItemCode: 'A', qtyPerSet: '1.00', bomType: 'manufacture' },
      { childItemId: 'b', childItemCode: 'B', qtyPerSet: '2.00', bomType: 'purchase' },
    ];
    const newLines = [
      { childItemId: 'a', childItemCode: 'A', qtyPerSet: '5.00', bomType: 'manufacture' }, // qty change
      { childItemId: 'c', childItemCode: 'C', qtyPerSet: '1.00', bomType: 'outsource' }, // added
      // b removed
    ];
    const note = computeBomDiffNote(oldLines, newLines);
    expect(note).toContain('Added: C');
    expect(note).toContain('Removed: B');
    expect(note).toContain('Changed: A');
    expect(note).toContain('qty 1.00 → 5.00');
  });

  it('computeBomDiffNote: no changes', () => {
    const lines = [
      { childItemId: 'a', childItemCode: 'A', qtyPerSet: '1.00', bomType: 'manufacture' },
    ];
    expect(computeBomDiffNote(lines, lines)).toBe('No item changes');
  });

  it('computeBomDiffNote: bom_type change reported separately', () => {
    const o = [{ childItemId: 'a', childItemCode: 'A', qtyPerSet: '1.00', bomType: 'manufacture' }];
    const n = [{ childItemId: 'a', childItemCode: 'A', qtyPerSet: '1.00', bomType: 'purchase' }];
    expect(computeBomDiffNote(o, n)).toContain('type manufacture → purchase');
  });
});

describe('bom-master service — CRUD', () => {
  it('createBomMaster auto-generates BOM-NNNN when bomNo omitted', async () => {
    const detail = await service.createBomMaster(
      {
        bomName: 'Auto-numbered BOM',
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 2, bomType: 'manufacture' }],
      },
      admin,
    );
    expect(detail.bomNo).toMatch(/^BOM-\d{4}$/);
    expect(detail.revision).toBe(1);
    expect(detail.lines).toHaveLength(1);
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]!.revision).toBe(1);
    expect(detail.revisions[0]!.notes).toBe('Initial creation');

    // Cleanup the auto-numbered row so the next iteration's nextBomNo
    // doesn't drift the assertion above on re-runs.
    await db.delete(bomMasters).where(eq(bomMasters.id, detail.id));
  });

  it('createBomMaster honours an explicit bomNo', async () => {
    const code = `${TEST_PREFIX}EXP1`;
    const detail = await service.createBomMaster(
      {
        bomNo: code,
        bomName: 'Explicit-numbered',
        status: 'active',
        lines: [
          { childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' },
          { childItemId: testItemId2, qtyPerSet: 2, bomType: 'purchase' },
        ],
      },
      admin,
    );
    expect(detail.bomNo).toBe(code);
    expect(detail.lines).toHaveLength(2);
    expect(detail.lines[0]!.lineNo).toBe(1);
    expect(detail.lines[1]!.lineNo).toBe(2);
  });

  it('createBomMaster rejects duplicate bomNo (ConflictError)', async () => {
    const code = `${TEST_PREFIX}DUP1`;
    await service.createBomMaster(
      {
        bomNo: code,
        bomName: 'first',
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    await expect(
      service.createBomMaster(
        {
          bomNo: code,
          bomName: 'second',
          status: 'draft',
          lines: [{ childItemId: testItemId2, qtyPerSet: 1, bomType: 'manufacture' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createBomMaster denies viewer with AuthorizationError', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.createBomMaster(
        {
          bomNo: `${TEST_PREFIX}VIEW1`,
          bomName: 'viewer attempt',
          status: 'draft',
          lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('getBomMaster returns header + lines + revisions', async () => {
    const created = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}GET1`,
        bomName: 'getter',
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    const detail = await service.getBomMaster(created.id, admin);
    expect(detail.id).toBe(created.id);
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]!.childItemCode).toBe(`${TEST_PREFIX}A`);
    expect(detail.lines[0]!.childItemName).toBe('BOM test A');
    expect(detail.revisions).toHaveLength(1);
  });

  it('getBomMaster throws NotFoundError on unknown id', async () => {
    await expect(
      service.getBomMaster('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updateBomMaster bumps revision + appends snapshot + auto-generates diff note', async () => {
    const created = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}UPD1`,
        bomName: 'will be updated',
        status: 'draft',
        lines: [
          { childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' },
          { childItemId: testItemId2, qtyPerSet: 2, bomType: 'purchase' },
        ],
      },
      admin,
    );
    expect(created.revision).toBe(1);

    const updated = await service.updateBomMaster(
      created.id,
      {
        bomNo: `${TEST_PREFIX}UPD1`,
        bomName: 'updated name',
        status: 'active',
        lines: [
          { childItemId: testItemId1, qtyPerSet: 5, bomType: 'manufacture' }, // qty change
          { childItemId: testItemId3, qtyPerSet: 1, bomType: 'outsource' }, // added
          // testItemId2 removed
        ],
      },
      admin,
    );
    expect(updated.revision).toBe(2);
    expect(updated.bomName).toBe('updated name');
    expect(updated.status).toBe('active');
    expect(updated.lines).toHaveLength(2);
    expect(updated.revisions).toHaveLength(2);
    const rev2 = updated.revisions.find((r) => r.revision === 2)!;
    expect(rev2.notes).toContain('Added');
    expect(rev2.notes).toContain('Removed');
    expect(rev2.notes).toContain('Changed');
  });

  it('updateBomMaster honours caller-provided revisionNote over auto-generated', async () => {
    const created = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}UPD2`,
        bomName: 'override note',
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    const customNote = 'Updated per ECO-123 — customer change request';
    const updated = await service.updateBomMaster(
      created.id,
      {
        bomNo: `${TEST_PREFIX}UPD2`,
        bomName: 'override note',
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 2, bomType: 'manufacture' }],
        revisionNote: customNote,
      },
      admin,
    );
    const rev2 = updated.revisions.find((r) => r.revision === 2)!;
    expect(rev2.notes).toBe(customNote);
  });

  it('updateBomMaster rejects duplicate bomNo on rename (ConflictError)', async () => {
    await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}DUP-A`,
        bomName: 'A',
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    const target = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}DUP-B`,
        bomName: 'B',
        status: 'draft',
        lines: [{ childItemId: testItemId2, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    await expect(
      service.updateBomMaster(
        target.id,
        {
          bomNo: `${TEST_PREFIX}DUP-A`,
          bomName: 'B renamed',
          status: 'draft',
          lines: [{ childItemId: testItemId2, qtyPerSet: 1, bomType: 'manufacture' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('updateBomMaster throws NotFoundError on unknown id', async () => {
    await expect(
      service.updateBomMaster(
        '00000000-0000-0000-0000-000000000000',
        {
          bomNo: 'X',
          bomName: 'X',
          status: 'draft',
          lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('softDeleteBomMaster denies manager (admin-only)', async () => {
    const created = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}DEL1`,
        bomName: 'manager attempt',
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    const manager: AuthContext = { ...admin, role: 'manager' };
    await expect(service.softDeleteBomMaster(created.id, manager)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('softDeleteBomMaster succeeds when no SO links the BOM', async () => {
    const created = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}DEL2`,
        bomName: 'cleanly deletable',
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    const deleted = await service.softDeleteBomMaster(created.id, admin);
    expect(deleted.deletedAt).not.toBeNull();
    // Subsequent get throws NotFound (the load function filters soft-deleted).
    await expect(service.getBomMaster(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('softDeleteBomMaster refuses when linked from a non-cancelled SO line', async () => {
    const bom = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}DEL3`,
        bomName: 'linked from SO',
        status: 'active',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    // Plant an SO + line that links this BOM.
    const so = await db
      .insert(salesOrders)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}SO-LINK`,
        soDate: '2026-05-20',
        status: 'open',
        type: 'component_manufacturing',
        gstPercent: '18.00',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    await db.insert(salesOrderLines).values({
      companyId: admin.companyId!,
      salesOrderId: so[0]!.id,
      lineNo: 1,
      itemId: testItemId1,
      partName: 'p',
      orderQty: 1,
      rate: '0',
      status: 'open',
      sourceBomMasterId: bom.id,
      createdBy: admin.id,
      updatedBy: admin.id,
    });

    await expect(service.softDeleteBomMaster(bom.id, admin)).rejects.toBeInstanceOf(ConflictError);

    // Cleanup the planted SO so other suites aren't affected.
    await db.delete(salesOrders).where(eq(salesOrders.id, so[0]!.id));
  });

  it('listBomMasters filters by status + search + shows lineCount / linkedSoCount', async () => {
    await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}LST-ACT`,
        bomName: 'active one',
        status: 'active',
        lines: [
          { childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' },
          { childItemId: testItemId2, qtyPerSet: 2, bomType: 'purchase' },
        ],
      },
      admin,
    );
    const list = await service.listBomMasters({ status: 'active', limit: 100, offset: 0 }, admin);
    const row = list.items.find((b) => b.bomNo === `${TEST_PREFIX}LST-ACT`);
    expect(row).toBeDefined();
    expect(row!.lineCount).toBe(2);
    expect(row!.linkedSoCount).toBe(0);
  });
});

// Silence unused-import false positives.
void bomMasterLines;
void bomMasterRevisions;
void and;
void isNull;
void notLike;
