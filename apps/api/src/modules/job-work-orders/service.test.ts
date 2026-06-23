import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, items, jobWorkOrderLines, jobWorkOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T031-';
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
  // Oldest non-test-prefixed item — sidesteps cross-test pollution where
  // op-entry's afterAll would delete a test item still referenced by a JW
  // line. Migrated seed items predate any test-created item.
  const itemRow = await db
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(
      and(eq(items.companyId, u.companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
    )
    .orderBy(asc(items.createdAt))
    .limit(1);
  const it = itemRow[0];
  if (!it) throw new Error('No items in seed company — run migration load first');
  firstItemId = it.id;
  firstItemCode = it.code;
});

afterAll(async () => {
  const testHeaders = await db
    .select({ id: jobWorkOrders.id })
    .from(jobWorkOrders)
    .where(like(jobWorkOrders.code, `${TEST_PREFIX}%`));
  const ids = testHeaders.map((h) => h.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, id));
    }
    await db.delete(jobWorkOrders).where(like(jobWorkOrders.code, `${TEST_PREFIX}%`));
  }
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
});

describe('job-work-orders service', () => {
  it('createJobWorkOrder inserts header + lines with audit columns + numeric formatting', async () => {
    const code = `${TEST_PREFIX}A1`;
    const detail = await service.createJobWorkOrder(
      {
        header: {
          code,
          jwDate: '2026-05-02',
          customerName: 'JW Acme',
          status: 'open',
          // Client material is header-level (migration 0053).
          clientMaterial: 'EN8 Round Bar 50mm',
          clientMaterialQty: 12.5,
          materialReceivedDate: '2026-05-01',
          materialReceivedQty: 10,
        },
        lines: [
          {
            partName: 'Machined Shaft',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 10,
            rate: 35.5,
          },
          {
            partName: 'Bracket',
            itemCodeText: 'NONEXISTENT-BRK',
            uom: 'NOS',
            orderQty: 5,
          },
        ],
      },
      admin,
    );
    expect(detail.code).toBe(code);
    expect(detail.companyId).toBe(admin.companyId);
    expect(detail.createdBy).toBe(admin.id);
    expect(detail.lines).toHaveLength(2);
    expect(detail.lines[0]?.lineNo).toBe(1);
    expect(detail.lines[0]?.itemId).toBe(firstItemId);
    // Bug 1.3/1.4: a line matched to a master item now surfaces the readable
    // master code on read (instead of null), so the detail/edit form shows it.
    expect(detail.lines[0]?.itemCodeText).toBe(firstItemCode);
    // line rate + header material numeric formatting
    expect(detail.lines[0]?.rate).toBe('35.50');
    expect(detail.clientMaterialQty).toBe('12.50');
    expect(detail.materialReceivedQty).toBe('10.00');
    expect(detail.materialReceivedDate).toBe('2026-05-01');
    // ADR-012 #10 fallback
    expect(detail.lines[1]?.itemId).toBeNull();
    expect(detail.lines[1]?.itemCodeText).toBe('NONEXISTENT-BRK');
    expect(detail.lines[1]?.lineNo).toBe(2);
  });

  it('createJobWorkOrder auto-generates the next IN-JW code when omitted (bug 1.2)', async () => {
    const detail = await service.createJobWorkOrder(
      {
        header: { jwDate: '2026-05-03', customerName: 'Auto Code Co', status: 'open' },
        lines: [{ partName: 'Auto', itemId: firstItemId, uom: 'NOS', orderQty: 1 }],
      },
      admin,
    );
    expect(detail.code).toMatch(/^IN-JW-\d{5}$/);
    // Generated codes don't carry TEST_PREFIX, so clean up explicitly.
    await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, detail.id));
    await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, detail.id));
  });

  it('two quick JWSO creates get distinct sequential IN-JW codes (bug 2)', async () => {
    const mk = () =>
      service.createJobWorkOrder(
        {
          header: { jwDate: '2026-05-03', customerName: 'Seq Co', status: 'open' },
          lines: [{ partName: 'Seq', itemId: firstItemId, uom: 'NOS', orderQty: 1 }],
        },
        admin,
      );
    const a = await mk();
    const b = await mk();
    expect(a.code).not.toBe(b.code);
    expect(Number(b.code.slice(-5))).toBe(Number(a.code.slice(-5)) + 1);
    for (const id of [a.id, b.id]) {
      await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, id));
      await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, id));
    }
  });

  it('createJobWorkOrder rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Dup Co', status: 'open' },
        lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1 }],
      },
      admin,
    );
    await expect(
      service.createJobWorkOrder(
        {
          header: { code, jwDate: '2026-05-02', customerName: 'Dup Co', status: 'open' },
          lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createJobWorkOrder rejects invalid clientId with ValidationError', async () => {
    await expect(
      service.createJobWorkOrder(
        {
          header: {
            code: `${TEST_PREFIX}BADCLI`,
            jwDate: '2026-05-02',
            clientId: '00000000-0000-0000-0000-000000000000',
            status: 'open',
          },
          lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('getJobWorkOrder returns header + lines ordered by lineNo', async () => {
    const code = `${TEST_PREFIX}G1`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Gettable', status: 'open' },
        lines: [
          { partName: 'Line One', itemId: firstItemId, uom: 'NOS', orderQty: 3 },
          { partName: 'Line Two', itemId: firstItemId, uom: 'NOS', orderQty: 7 },
        ],
      },
      admin,
    );
    const fetched = await service.getJobWorkOrder(created.id, admin);
    expect(fetched.id).toBe(created.id);
    expect(fetched.lines.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(fetched.lines[0]?.partName).toBe('Line One');
  });

  it('getJobWorkOrder throws NotFoundError for unknown id', async () => {
    await expect(
      service.getJobWorkOrder('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listJobWorkOrders returns one row per line incl. header material + status filter', async () => {
    const code = `${TEST_PREFIX}LST`;
    await service.createJobWorkOrder(
      {
        header: {
          code,
          jwDate: '2026-05-02',
          customerName: 'Listable',
          status: 'open',
          // Client material is header-level (migration 0053).
          clientMaterialQty: 12,
          materialReceivedQty: 4,
        },
        lines: [
          { partName: 'A', itemId: firstItemId, uom: 'NOS', orderQty: 4, rate: 10 },
          { partName: 'B', itemId: firstItemId, uom: 'NOS', orderQty: 6, rate: 20 },
        ],
      },
      admin,
    );
    const result = await service.listJobWorkOrders(
      { search: 'T031-LST', status: 'open', limit: 50, offset: 0 },
      admin,
    );
    // One row per line (2 lines for this JW), each carrying header material.
    const rowsForJw = result.items
      .filter((j) => j.code === code)
      .sort((a, b) => a.lineNo - b.lineNo);
    expect(rowsForJw).toHaveLength(2);
    expect(rowsForJw[0]?.lineNo).toBe(1);
    expect(rowsForJw[0]?.orderQty).toBe(4);
    expect(rowsForJw[1]?.orderQty).toBe(6);
    expect(Number(rowsForJw[0]?.clientMaterialQty)).toBe(12);
    expect(Number(rowsForJw[0]?.materialReceivedQty)).toBe(4);
    expect(rowsForJw[0]?.jcQty).toBe(0);
  });

  it('updateJobWorkOrder header-only does NOT touch lines', async () => {
    const code = `${TEST_PREFIX}UH1`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Before', status: 'open' },
        lines: [{ partName: 'Stay', itemId: firstItemId, uom: 'NOS', orderQty: 9 }],
      },
      admin,
    );
    const updated = await service.updateJobWorkOrder(
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

  it('updateJobWorkOrder merges lines: id-matched updated, new inserted, absent soft-deleted', async () => {
    const code = `${TEST_PREFIX}UM1`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Merge', status: 'open' },
        lines: [
          { partName: 'Keep+Update', itemId: firstItemId, uom: 'NOS', orderQty: 10 },
          { partName: 'Drop Me', itemId: firstItemId, uom: 'NOS', orderQty: 20 },
        ],
      },
      admin,
    );
    const keptId = created.lines[0]!.id;

    const updated = await service.updateJobWorkOrder(
      created.id,
      {
        header: {},
        lines: [
          { id: keptId, partName: 'Keep+Updated', itemId: firstItemId, uom: 'NOS', orderQty: 11 },
          { partName: 'Brand New', itemId: firstItemId, uom: 'NOS', orderQty: 30 },
          // "Drop Me" is omitted → soft-deleted
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
    expect(fresh?.lineNo).toBe(2);

    const allRows = await db
      .select()
      .from(jobWorkOrderLines)
      .where(eq(jobWorkOrderLines.jobWorkOrderId, created.id));
    const dropped = allRows.find((l) => l.partName === 'Drop Me');
    expect(dropped).toBeDefined();
    expect(dropped?.deletedAt).not.toBeNull();
  });

  it('softDeleteJobWorkOrder soft-deletes header + all lines', async () => {
    const code = `${TEST_PREFIX}DEL`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Goner', status: 'open' },
        lines: [
          { partName: 'L1', itemId: firstItemId, uom: 'NOS', orderQty: 1 },
          { partName: 'L2', itemId: firstItemId, uom: 'NOS', orderQty: 2 },
        ],
      },
      admin,
    );
    await service.softDeleteJobWorkOrder(created.id, admin);
    await expect(service.getJobWorkOrder(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
    const lines = await db
      .select()
      .from(jobWorkOrderLines)
      .where(eq(jobWorkOrderLines.jobWorkOrderId, created.id));
    expect(lines.every((l) => l.deletedAt !== null)).toBe(true);
  });

  it('emits CREATE / EDIT / DELETE activity_log rows atomic with the mutation', async () => {
    const code = `${TEST_PREFIX}AUD`;
    const created = await service.createJobWorkOrder(
      {
        header: { code, jwDate: '2026-05-02', customerName: 'Audit Customer', status: 'open' },
        lines: [{ partName: 'L1', itemId: firstItemId, uom: 'NOS', orderQty: 1 }],
      },
      admin,
    );
    await service.updateJobWorkOrder(
      created.id,
      { header: { customerName: 'Audit Customer (renamed)' } },
      admin,
    );
    await service.softDeleteJobWorkOrder(created.id, admin);

    const auditRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, code)));
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(['CREATE', 'DELETE', 'EDIT']);
    for (const r of auditRows) {
      expect(r.entity).toBe('JobWorkOrder');
      expect(r.userId).toBe(admin.id);
      expect(r.userName).toBe(admin.email);
      expect(r.detail).toContain(code);
    }
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.createJobWorkOrder(
        {
          header: {
            code: `${TEST_PREFIX}NOC`,
            jwDate: '2026-05-02',
            customerName: 'X',
            status: 'open',
          },
          lines: [{ partName: 'L', itemId: firstItemId, uom: 'NOS', orderQty: 1 }],
        },
        noCompanyUser,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
