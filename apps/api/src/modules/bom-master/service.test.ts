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
/** The assembled parent every test BOM builds (migration 0085 — required). */
let testParentId: string;

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
  // Three child items so we can build a 2-line BOM + swap items for diff,
  // plus the parent assembly every BOM must now name (migration 0085).
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
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}PARENT`,
        name: 'BOM test parent assembly',
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
  testParentId = it[3]!.id;
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
        parentItemId: testParentId,
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

  it('createBomMaster stores the parent item and reads it back with code + name', async () => {
    const detail = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}PARENT1`,
        bomName: 'has a parent',
        parentItemId: testParentId,
        status: 'active',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    expect(detail.parentItemId).toBe(testParentId);
    expect(detail.parentItemCode).toBe(`${TEST_PREFIX}PARENT`);
    expect(detail.parentItemName).toBe('BOM test parent assembly');
  });

  it('createBomMaster refuses a parent that is also one of its own children', async () => {
    await expect(
      service.createBomMaster(
        {
          bomNo: `${TEST_PREFIX}SELFREF`,
          bomName: 'builds itself',
          parentItemId: testParentId,
          status: 'draft',
          lines: [
            { childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' },
            { childItemId: testParentId, qtyPerSet: 1, bomType: 'manufacture' },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/cannot also be part 2 of its own BOM/);
  });

  it('createBomMaster refuses a parent item id that does not exist', async () => {
    await expect(
      service.createBomMaster(
        {
          bomNo: `${TEST_PREFIX}NOPARENT`,
          bomName: 'ghost parent',
          parentItemId: '00000000-0000-0000-0000-000000000000',
          status: 'draft',
          lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
        },
        admin,
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('updateBomMaster can swap the parent and says so in the revision note', async () => {
    const created = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}SWAP`,
        bomName: 'parent swap',
        parentItemId: testParentId,
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    const updated = await service.updateBomMaster(
      created.id,
      {
        bomNo: `${TEST_PREFIX}SWAP`,
        bomName: 'parent swap',
        parentItemId: testItemId3, // a different item becomes the parent
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    expect(updated.parentItemId).toBe(testItemId3);
    expect(updated.parentItemCode).toBe(`${TEST_PREFIX}C`);
    const rev2 = updated.revisions.find((r) => r.revision === 2)!;
    expect(rev2.notes).toContain(`Parent ${TEST_PREFIX}PARENT → ${TEST_PREFIX}C`);
  });

  it('createBomMaster honours an explicit bomNo', async () => {
    const code = `${TEST_PREFIX}EXP1`;
    const detail = await service.createBomMaster(
      {
        bomNo: code,
        bomName: 'Explicit-numbered',
        parentItemId: testParentId,
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
        parentItemId: testParentId,
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
          parentItemId: testParentId,
          status: 'draft',
          lines: [{ childItemId: testItemId2, qtyPerSet: 1, bomType: 'manufacture' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createBomMaster rejects the same child item twice, naming both lines', async () => {
    await expect(
      service.createBomMaster(
        {
          bomNo: `${TEST_PREFIX}DUPCHILD`,
          bomName: 'same part twice',
          parentItemId: testParentId,
          status: 'draft',
          lines: [
            { childItemId: testItemId1, qtyPerSet: 2, bomType: 'manufacture' },
            { childItemId: testItemId2, qtyPerSet: 1, bomType: 'purchase' },
            { childItemId: testItemId1, qtyPerSet: 1, bomType: 'purchase' },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/Duplicate item code on line 3.*already on line 1/s);
  });

  it('updateBomMaster rejects the same child item twice', async () => {
    const created = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}DUPCHILD-U`,
        bomName: 'ok at first',
        parentItemId: testParentId,
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    await expect(
      service.updateBomMaster(
        created.id,
        {
          bomNo: `${TEST_PREFIX}DUPCHILD-U`,
          bomName: 'now duplicated',
          parentItemId: testParentId,
          status: 'draft',
          lines: [
            { childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' },
            { childItemId: testItemId1, qtyPerSet: 3, bomType: 'purchase' },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/Duplicate item code on line 2/);
  });

  it('createBomMaster denies viewer with AuthorizationError', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.createBomMaster(
        {
          bomNo: `${TEST_PREFIX}VIEW1`,
          bomName: 'viewer attempt',
          parentItemId: testParentId,
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
        parentItemId: testParentId,
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
        parentItemId: testParentId,
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
        parentItemId: testParentId,
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
        parentItemId: testParentId,
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
        parentItemId: testParentId,
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
        parentItemId: testParentId,
        status: 'draft',
        lines: [{ childItemId: testItemId1, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    const target = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}DUP-B`,
        bomName: 'B',
        parentItemId: testParentId,
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
          parentItemId: testParentId,
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
          parentItemId: testParentId,
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
        parentItemId: testParentId,
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
        parentItemId: testParentId,
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
        parentItemId: testParentId,
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
        parentItemId: testParentId,
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
