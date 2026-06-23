import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, items, salesOrderLines, salesOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T030-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;
let firstItemCode: string;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) {
    throw new Error('Seed admin missing — run pnpm --filter api seed');
  }
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
  // Pick the OLDEST item in the seed company. This sidesteps cross-test
  // pollution where another test file's afterAll might delete an item this
  // test's JW/SO lines still reference. Migrated seed items predate any
  // test-created item, so ordering by createdAt ASC is stable.
  const itemRow = await db
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(
      and(
        eq(items.companyId, u.companyId),
        isNull(items.deletedAt),
        notLike(items.code, 'T%-%'), // belt-and-braces: skip test-prefixed codes
      ),
    )
    .orderBy(asc(items.createdAt))
    .limit(1);
  const it = itemRow[0];
  if (!it) throw new Error('No items in seed company — run migration load first');
  firstItemId = it.id;
  firstItemCode = it.code;
});

afterAll(async () => {
  // Hard-cleanup test rows. Lines first (FK).
  const testHeaders = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${TEST_PREFIX}%`));
  const ids = testHeaders.map((h) => h.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
    }
    await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
  }
  // Wipe audit-log entries the SO emitter wrote for these test rows.
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
});

describe('sales-orders service', () => {
  it('createSalesOrder inserts header + lines with audit columns', async () => {
    const code = `${TEST_PREFIX}A1`;
    const detail = await service.createSalesOrder(
      {
        header: {
          code,
          soDate: '2026-05-02',
          customerName: 'Acme Customer',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'Widget Alpha',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 10,
            rate: 100.5,
          },
          {
            partName: 'Widget Beta',
            itemCodeText: 'NONEXISTENT-CODE',
            uom: 'NOS',
            orderQty: 5,
            rate: 50,
          },
        ],
      },
      admin,
    );
    expect(detail.code).toBe(code);
    expect(detail.companyId).toBe(admin.companyId);
    expect(detail.createdBy).toBe(admin.id);
    expect(detail.gstPercent).toBe('18.00');
    expect(detail.lines).toHaveLength(2);
    expect(detail.lines[0]?.lineNo).toBe(1);
    expect(detail.lines[0]?.itemId).toBe(firstItemId);
    expect(detail.lines[0]?.itemCodeText).toBeNull();
    expect(detail.lines[0]?.rate).toBe('100.50');
    expect(detail.lines[1]?.lineNo).toBe(2);
    // Unresolved itemCodeText is preserved per ADR-012 #10.
    expect(detail.lines[1]?.itemId).toBeNull();
    expect(detail.lines[1]?.itemCodeText).toBe('NONEXISTENT-CODE');
  });

  it('SO detail lines include the resolved itemCode (bug 1)', async () => {
    const created = await service.createSalesOrder(
      {
        header: {
          code: `${TEST_PREFIX}ITEMCODE`,
          soDate: '2026-05-02',
          customerName: 'ItemCode Co',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [{ partName: 'Coded', itemId: firstItemId, uom: 'NOS', orderQty: 3, rate: 10 }],
      },
      admin,
    );
    // Create response carries the readable code (back-resolved from item_id).
    expect(created.lines[0]?.itemCode).toBe(firstItemCode);
    // Detail GET also returns itemCode on every line.
    const detail = await service.getSalesOrder(created.id, admin);
    expect(detail.lines[0]?.itemId).toBe(firstItemId);
    expect(detail.lines[0]?.itemCode).toBe(firstItemCode);
  });

  it('createSalesOrder auto-generates distinct sequential IN-SO codes (bug 2)', async () => {
    const mk = () =>
      service.createSalesOrder(
        {
          header: {
            soDate: '2026-05-02',
            customerName: 'Auto SO Co',
            type: 'component_manufacturing',
            status: 'open',
            gstPercent: 18,
          },
          lines: [{ partName: 'Auto', itemId: firstItemId, uom: 'NOS', orderQty: 1, rate: 0 }],
        },
        admin,
      );
    const a = await mk();
    const b = await mk();
    expect(a.code).toMatch(/^IN-SO-\d{5}$/);
    expect(b.code).toMatch(/^IN-SO-\d{5}$/);
    expect(a.code).not.toBe(b.code);
    // Sequential: second number is first + 1.
    const na = Number(a.code.slice(-5));
    const nb = Number(b.code.slice(-5));
    expect(nb).toBe(na + 1);
    // Generated codes don't carry TEST_PREFIX, so clean up explicitly.
    for (const id of [a.id, b.id]) {
      await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
      await db.delete(salesOrders).where(eq(salesOrders.id, id));
    }
  });

  it('createSalesOrder rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createSalesOrder(
      {
        header: {
          code,
          soDate: '2026-05-02',
          customerName: 'Dup Co',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1, rate: 0 }],
      },
      admin,
    );
    await expect(
      service.createSalesOrder(
        {
          header: {
            code,
            soDate: '2026-05-02',
            customerName: 'Dup Co',
            type: 'component_manufacturing',
            status: 'open',
            gstPercent: 18,
          },
          lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1, rate: 0 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createSalesOrder rejects invalid clientId with ValidationError (not raw FK)', async () => {
    await expect(
      service.createSalesOrder(
        {
          header: {
            code: `${TEST_PREFIX}BADCLI`,
            soDate: '2026-05-02',
            clientId: '00000000-0000-0000-0000-000000000000',
            type: 'component_manufacturing',
            status: 'open',
            gstPercent: 18,
          },
          lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1, rate: 0 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('getSalesOrder returns header + lines ordered by lineNo', async () => {
    const code = `${TEST_PREFIX}G1`;
    const created = await service.createSalesOrder(
      {
        header: {
          code,
          soDate: '2026-05-02',
          customerName: 'Gettable',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          { partName: 'Line One', itemId: firstItemId, uom: 'NOS', orderQty: 3, rate: 0 },
          { partName: 'Line Two', itemId: firstItemId, uom: 'NOS', orderQty: 7, rate: 0 },
        ],
      },
      admin,
    );
    const fetched = await service.getSalesOrder(created.id, admin);
    expect(fetched.id).toBe(created.id);
    expect(fetched.lines.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(fetched.lines[0]?.partName).toBe('Line One');
  });

  it('getSalesOrder throws NotFoundError for unknown id', async () => {
    await expect(
      service.getSalesOrder('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listSalesOrders returns aggregates + applies status filter', async () => {
    const code = `${TEST_PREFIX}LST`;
    await service.createSalesOrder(
      {
        header: {
          code,
          soDate: '2026-05-02',
          customerName: 'Listable',
          type: 'equipment',
          status: 'open',
          gstPercent: 12,
        },
        lines: [
          { partName: 'Equip', itemId: firstItemId, uom: 'NOS', orderQty: 4, rate: 0 },
          { partName: 'Spare', itemId: firstItemId, uom: 'NOS', orderQty: 6, rate: 0 },
        ],
      },
      admin,
    );
    const result = await service.listSalesOrders(
      { search: 'T030-LST', status: 'open', limit: 50, offset: 0 },
      admin,
    );
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    const found = result.items.find((s) => s.code === code);
    expect(found?.lineCount).toBe(2);
    expect(found?.totalQty).toBe(10);
    expect(found?.jcQty).toBe(0);
    expect(found?.gstPercent).toBe('12.00');
  });

  it('updateSalesOrder header-only does NOT touch lines', async () => {
    const code = `${TEST_PREFIX}UH1`;
    const created = await service.createSalesOrder(
      {
        header: {
          code,
          soDate: '2026-05-02',
          customerName: 'Before',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [{ partName: 'Stay', itemId: firstItemId, uom: 'NOS', orderQty: 9, rate: 0 }],
      },
      admin,
    );
    const updated = await service.updateSalesOrder(
      created.id,
      { header: { customerName: 'After', remarks: 'changed' } },
      admin,
    );
    expect(updated.customerName).toBe('After');
    expect(updated.remarks).toBe('changed');
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]?.id).toBe(created.lines[0]?.id);
    expect(updated.lines[0]?.partName).toBe('Stay');
  });

  it('updateSalesOrder merges lines: id-matched updated, new inserted, absent soft-deleted', async () => {
    const code = `${TEST_PREFIX}UM1`;
    const created = await service.createSalesOrder(
      {
        header: {
          code,
          soDate: '2026-05-02',
          customerName: 'Merge',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          { partName: 'Keep+Update', itemId: firstItemId, uom: 'NOS', orderQty: 10, rate: 0 },
          { partName: 'Drop Me', itemId: firstItemId, uom: 'NOS', orderQty: 20, rate: 0 },
        ],
      },
      admin,
    );
    const keptId = created.lines[0]!.id;

    const updated = await service.updateSalesOrder(
      created.id,
      {
        header: {},
        lines: [
          // Update the kept line — new partName, new qty
          {
            id: keptId,
            partName: 'Keep+Updated',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 11,
            rate: 0,
          },
          // New line — should get auto-assigned lineNo above the surviving max
          { partName: 'Brand New', itemId: firstItemId, uom: 'NOS', orderQty: 30, rate: 0 },
          // The "Drop Me" line above is omitted — should be soft-deleted
        ],
      },
      admin,
    );
    expect(updated.lines).toHaveLength(2);
    const kept = updated.lines.find((l) => l.id === keptId);
    const fresh = updated.lines.find((l) => l.id !== keptId);
    expect(kept?.partName).toBe('Keep+Updated');
    expect(kept?.orderQty).toBe(11);
    expect(fresh?.partName).toBe('Brand New');
    // Surviving max was lineNo=1 (the kept one); new starts at 2.
    expect(fresh?.lineNo).toBe(2);

    // Verify the dropped line is soft-deleted (still in DB, deletedAt set).
    const allRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, created.id));
    const dropped = allRows.find((l) => l.partName === 'Drop Me');
    expect(dropped).toBeDefined();
    expect(dropped?.deletedAt).not.toBeNull();
  });

  it('softDeleteSalesOrder soft-deletes header + all lines', async () => {
    const code = `${TEST_PREFIX}DEL`;
    const created = await service.createSalesOrder(
      {
        header: {
          code,
          soDate: '2026-05-02',
          customerName: 'Goner',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          { partName: 'L1', itemId: firstItemId, uom: 'NOS', orderQty: 1, rate: 0 },
          { partName: 'L2', itemId: firstItemId, uom: 'NOS', orderQty: 2, rate: 0 },
        ],
      },
      admin,
    );
    await service.softDeleteSalesOrder(created.id, admin);
    await expect(service.getSalesOrder(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
    const lines = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, created.id));
    expect(lines.every((l) => l.deletedAt !== null)).toBe(true);
  });

  it('emits CREATE / EDIT / DELETE activity_log rows atomic with the mutation', async () => {
    const code = `${TEST_PREFIX}AUD`;
    const created = await service.createSalesOrder(
      {
        header: {
          code,
          soDate: '2026-05-02',
          customerName: 'Audit Customer',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [{ partName: 'L1', itemId: firstItemId, uom: 'NOS', orderQty: 1, rate: 0 }],
      },
      admin,
    );
    await service.updateSalesOrder(
      created.id,
      { header: { customerName: 'Audit Customer (renamed)' } },
      admin,
    );
    await service.softDeleteSalesOrder(created.id, admin);

    const auditRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, code)));
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(['CREATE', 'DELETE', 'EDIT']);
    for (const r of auditRows) {
      expect(r.entity).toBe('SalesOrder');
      expect(r.userId).toBe(admin.id);
      expect(r.userName).toBe(admin.email);
      expect(r.detail).toContain(code);
    }
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.createSalesOrder(
        {
          header: {
            code: `${TEST_PREFIX}NOC`,
            soDate: '2026-05-02',
            customerName: 'X',
            type: 'component_manufacturing',
            status: 'open',
            gstPercent: 18,
          },
          lines: [{ partName: 'L', itemId: firstItemId, uom: 'NOS', orderQty: 1, rate: 0 }],
        },
        noCompanyUser,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
