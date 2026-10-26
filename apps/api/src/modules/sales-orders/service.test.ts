import { and, asc, eq, inArray, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentEditStagedResult, SalesOrderLineInput } from '@innovic/shared';
import { db } from '../../db/client';
import {
  activityLog,
  approvalConfig,
  documentEditRequests,
  items,
  jobCards,
  salesOrderLines,
  salesOrders,
  soMilestones,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { fmtDate } from '../../lib/format-date';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { AUDITOR, asAccess } from '../../lib/test-access';
import { decideDocumentEdit } from '../document-edits/service';
import * as service from './service';

// ADR-207 — every test Internal SO No. must start with "SO-"; the cleanup
// LIKE patterns below match on this prefix.
const TEST_PREFIX = 'SO-T030-';
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
    .where(like(salesOrders.internalSoNo, `${TEST_PREFIX}%`));
  const ids = testHeaders.map((h) => h.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
    }
    // Audit-log entries the SO emitter wrote for these test rows (refId is the
    // system SO No., so match on the row id).
    await db.delete(activityLog).where(inArray(activityLog.entityId, ids));
    await db.delete(salesOrders).where(like(salesOrders.internalSoNo, `${TEST_PREFIX}%`));
  }
});

describe('sales-orders service', () => {
  it('createSalesOrder inserts header + lines with audit columns', async () => {
    const code = `${TEST_PREFIX}A1`;
    const detail = await service.createSalesOrder(
      {
        header: {
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Acme Customer',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'Widget Alpha',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 10,
            rate: 100.5,
          },
          {
            partName: 'Widget Beta',
            clientPoLineNo: '1',
            revision: 'A',
            itemCodeText: 'NONEXISTENT-CODE',
            uom: 'NOS',
            orderQty: 5,
            rate: 50,
          },
        ],
      },
      admin,
    );
    expect(detail.code).toMatch(/^IN-SO-\d{5}$/);
    expect(detail.internalSoNo).toBe(code);
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
          internalSoNo: `${TEST_PREFIX}ITEMCODE`,
          soDate: '2026-05-02',
          customerName: 'ItemCode Co',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'Coded',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 3,
            rate: 10,
          },
        ],
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
    let autoSeq = 0;
    const mk = () =>
      service.createSalesOrder(
        {
          header: {
            internalSoNo: `${TEST_PREFIX}AUTO-${(autoSeq += 1)}`,
            soDate: '2026-05-02',
            customerName: 'Auto SO Co',
            type: 'component_manufacturing',
            status: 'open',
            gstPercent: 18,
          },
          lines: [
            {
              partName: 'Auto',
              clientPoLineNo: '1',
              revision: 'A',
              itemId: firstItemId,
              uom: 'NOS',
              orderQty: 1,
              rate: 0,
            },
          ],
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

  it('createSalesOrder rejects a duplicate Internal SO No. in the same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createSalesOrder(
      {
        header: {
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Dup Co',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'X',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
            rate: 0,
          },
        ],
      },
      admin,
    );
    const dup = service.createSalesOrder(
      {
        header: {
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Dup Co',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'X',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
            rate: 0,
          },
        ],
      },
      admin,
    );
    await expect(dup).rejects.toBeInstanceOf(ConflictError);
    await expect(dup).rejects.toThrow(/Internal SO No\. .* already exists/);
  });

  it('createSalesOrder rejects invalid clientId with ValidationError (not raw FK)', async () => {
    await expect(
      service.createSalesOrder(
        {
          header: {
            internalSoNo: `${TEST_PREFIX}BADCLI`,
            soDate: '2026-05-02',
            clientId: '00000000-0000-0000-0000-000000000000',
            type: 'component_manufacturing',
            status: 'open',
            gstPercent: 18,
          },
          lines: [
            {
              partName: 'X',
              clientPoLineNo: '1',
              revision: 'A',
              itemId: firstItemId,
              uom: 'NOS',
              orderQty: 1,
              rate: 0,
            },
          ],
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
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Gettable',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'Line One',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 3,
            rate: 0,
          },
          {
            partName: 'Line Two',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 7,
            rate: 0,
          },
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
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Listable',
          type: 'equipment',
          status: 'open',
          gstPercent: 12,
        },
        lines: [
          {
            partName: 'Equip',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 4,
            rate: 0,
          },
          {
            partName: 'Spare',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 6,
            rate: 0,
          },
        ],
      },
      admin,
    );
    const result = await service.listSalesOrders(
      { search: 'T030-LST', status: 'open', limit: 50, offset: 0 },
      admin,
    );
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    const found = result.items.find((s) => s.internalSoNo === code);
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
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Before',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'Stay',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 9,
            rate: 0,
          },
        ],
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
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Merge',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'Keep+Update',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 10,
            rate: 0,
          },
          {
            partName: 'Drop Me',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 20,
            rate: 0,
          },
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
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 11,
            rate: 0,
          },
          // New line — should get auto-assigned lineNo above the surviving max
          {
            partName: 'Brand New',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 30,
            rate: 0,
          },
          // The "Drop Me" line above is omitted — should be soft-deleted
        ],
        // Removing a line needs the version the edit started from.
        expectedUpdatedAt: created.updatedAt,
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
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Goner',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'L1',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
            rate: 0,
          },
          {
            partName: 'L2',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 2,
            rate: 0,
          },
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
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Audit Customer',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'L1',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
            rate: 0,
          },
        ],
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
      .where(
        and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.entityId, created.id)),
      );
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(['CREATE', 'DELETE', 'EDIT']);
    for (const r of auditRows) {
      expect(r.entity).toBe('SalesOrder');
      expect(r.userId).toBe(admin.id);
      expect(r.userName).toBe(admin.email);
      expect(r.detail).toContain(created.code);
    }
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.createSalesOrder(
        {
          header: {
            internalSoNo: `${TEST_PREFIX}NOC`,
            soDate: '2026-05-02',
            customerName: 'X',
            type: 'component_manufacturing',
            status: 'open',
            gstPercent: 18,
          },
          lines: [
            {
              partName: 'L',
              clientPoLineNo: '1',
              revision: 'A',
              itemId: firstItemId,
              uom: 'NOS',
              orderQty: 1,
              rate: 0,
            },
          ],
        },
        noCompanyUser,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('getSalesOrderRelated returns all upstream + downstream groups for a fresh SO', async () => {
    const code = `${TEST_PREFIX}REL`;
    const created = await service.createSalesOrder(
      {
        header: {
          internalSoNo: code,
          soDate: '2026-05-02',
          customerName: 'Traceability Customer',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          {
            partName: 'L1',
            clientPoLineNo: '1',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
            rate: 0,
          },
        ],
      },
      admin,
    );

    const related = await service.getSalesOrderRelated(created.id, admin);

    // Generic traceability shape: self + upstream/downstream section arrays.
    expect(related.self).toEqual({ module: 'sales-orders', code: created.code });

    // A fresh SO has no downstream docs — every downstream section is empty.
    for (const s of related.downstream) {
      expect(s.count).toBe(0);
      expect(s.items).toEqual([]);
    }
    // This SO was created without a client_id (customerName-only) and no
    // BOM-linked lines, so both upstream sections resolve empty.
    for (const s of related.upstream) {
      expect(s.count).toBe(0);
      expect(s.items).toEqual([]);
    }
    // Downstream must include the expected document types.
    const keys = related.downstream.map((s) => s.key);
    expect(keys).toContain('purchase-orders');
    expect(keys).toContain('invoices');
    expect(keys).toContain('assembly-units');
    // Timeline still carries the SO's own creation event.
    expect(related.timeline.some((e) => e.label === 'Sales Order created')).toBe(true);
  });

  it('getSalesOrderRelated throws NotFoundError for an unknown SO', async () => {
    await expect(
      service.getSalesOrderRelated('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ADR-232 (owner, 2026-10-15): the Access Control ticks alone decide; the
// derived role never refuses. Unknown id → a gate pass shows as a non-auth error.
describe('updateSalesOrder (owner D1: no longer admin-only) — ticks decide (ADR-232)', () => {
  const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

  it('sales L3 with role operator passes the gate', async () => {
    const user = asAccess(admin, { departments: { sales: 'L3' } }, 'operator');
    await expect(
      service.updateSalesOrder(UNKNOWN_ID, {} as never, user),
    ).rejects.not.toBeInstanceOf(AuthorizationError);
  });

  it('sales L2 (no tick) is refused', async () => {
    const user = asAccess(admin, { departments: { sales: 'L2' } }, 'manager');
    await expect(service.updateSalesOrder(UNKNOWN_ID, {} as never, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor is refused', async () => {
    const user = asAccess(admin, AUDITOR, 'viewer');
    await expect(service.updateSalesOrder(UNKNOWN_ID, {} as never, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('delete: sales L5 Department Admin is refused (Super Admin only)', async () => {
    const user = asAccess(admin, { departments: { sales: 'L5' } }, 'manager');
    await expect(service.softDeleteSalesOrder(UNKNOWN_ID, user, 'test')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('delete: Super Admin passes the gate', async () => {
    await expect(
      service.softDeleteSalesOrder(UNKNOWN_ID, admin, 'test'),
    ).rejects.not.toBeInstanceOf(AuthorizationError);
  });
});

// ADR-236: POL is compulsory on every SO line; the line Remarks is optional and
// is the SO line's own note. The header note is now labelled "SO Remarks".
const soHeader = (internalSoNo: string) => ({
  internalSoNo,
  soDate: '2026-05-02',
  customerName: 'POL Customer',
  type: 'component_manufacturing' as const,
  status: 'open' as const,
  gstPercent: 18,
});

describe('SO line POL + Remarks (ADR-236)', () => {
  it('edit changes POL and clears Remarks; History names POL, Remarks and SO Remarks', async () => {
    const created = await service.createSalesOrder(
      {
        header: soHeader(`${TEST_PREFIX}POL1`),
        lines: [
          {
            partName: 'Pol Part',
            clientPoLineNo: '20',
            remarks: 'urgent',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 2,
            rate: 0,
          },
        ],
      },
      admin,
    );
    expect(created.lines[0]?.clientPoLineNo).toBe('20');
    expect(created.lines[0]?.remarks).toBe('urgent');

    const updated = await service.updateSalesOrder(
      created.id,
      {
        header: { remarks: 'whole-order note' },
        lines: [
          {
            id: created.lines[0]!.id,
            partName: 'Pol Part',
            clientPoLineNo: '21',
            remarks: null,
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 2,
            rate: 0,
          },
        ],
      },
      admin,
    );
    expect(updated.lines[0]?.clientPoLineNo).toBe('21');
    expect(updated.lines[0]?.remarks).toBeNull();

    const rows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, created.id), eq(activityLog.action, 'EDIT')));
    const labels = rows.flatMap((r) => (r.changes ?? []).map((c) => c.label));
    expect(labels).toContain('POL');
    expect(labels).toContain('Remarks');
    expect(labels).toContain('SO Remarks');
  });

  it('an absent remarks key leaves the stored line Remarks alone', async () => {
    const created = await service.createSalesOrder(
      {
        header: soHeader(`${TEST_PREFIX}POL2`),
        lines: [
          {
            partName: 'Keep Note',
            clientPoLineNo: '5',
            remarks: 'keep me',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
            rate: 0,
          },
        ],
      },
      admin,
    );
    const updated = await service.updateSalesOrder(
      created.id,
      {
        header: {},
        lines: [
          {
            id: created.lines[0]!.id,
            partName: 'Keep Note',
            clientPoLineNo: '5',
            revision: 'A',
            itemId: firstItemId,
            uom: 'NOS',
            orderQty: 1,
            rate: 0,
          },
        ],
      },
      admin,
    );
    expect(updated.lines[0]?.remarks).toBe('keep me');
  });
});

// ADR-202 line approval (2026-10): with Document Edit Approval ON, an SO is
// staged only once it is IN USE (cancel.ts soInUse) or an edit already waits on
// it (so-edit-registry soEditGoesForApproval). Then every line
// and Delivery Schedule change is a box — `line:<id>:<attr>`, `line:add:<n>`,
// `line:remove:<id>`, `ms:<id>:<attr>`, `ms:add:<n>`, `ms:remove:<id>` — and an
// SO Status move is a header box; all applied through the real writer, and a
// doomed change is refused at request by rehearsing that writer. Integration
// tests: the house harness (TEST stack).
describe('SO edit-approval — in-use rule + line / lot boxes', () => {
  let cfgExisted = false;
  let origDocEditApproval = false;
  const jcIds: string[] = [];

  beforeAll(async () => {
    const cfg = await db
      .select()
      .from(approvalConfig)
      .where(eq(approvalConfig.companyId, admin.companyId!))
      .limit(1);
    if (cfg[0]) {
      cfgExisted = true;
      origDocEditApproval = cfg[0].docEditApproval;
      await db
        .update(approvalConfig)
        .set({ docEditApproval: true })
        .where(eq(approvalConfig.id, cfg[0].id));
    } else {
      await db.insert(approvalConfig).values({
        companyId: admin.companyId!,
        docEditApproval: true,
        poApproval: false,
        prApproval: false,
        invoiceApproval: false,
        createdBy: admin.id,
        updatedBy: admin.id,
      });
    }
  }, 180_000);

  afterAll(async () => {
    if (cfgExisted) {
      await db
        .update(approvalConfig)
        .set({ docEditApproval: origDocEditApproval })
        .where(eq(approvalConfig.companyId, admin.companyId!));
    } else {
      await db.delete(approvalConfig).where(eq(approvalConfig.companyId, admin.companyId!));
    }
    for (const id of jcIds) await db.delete(jobCards).where(eq(jobCards.id, id));
    const ids = (
      await db
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(like(salesOrders.internalSoNo, `${TEST_PREFIX}LA%`))
    ).map((r) => r.id);
    if (ids.length > 0) {
      await db.delete(documentEditRequests).where(inArray(documentEditRequests.entityId, ids));
      await db.delete(soMilestones).where(inArray(soMilestones.salesOrderId, ids));
    }
  }, 180_000);

  type LineSpec = { pol: string; qty: number };
  function newSo(
    suffix: string,
    lines: LineSpec[] = [{ pol: '20', qty: 2 }],
    milestones?: Array<{ lotNo: number; qty: number }>,
  ) {
    return service.createSalesOrder(
      {
        header: soHeader(`${TEST_PREFIX}${suffix}`),
        lines: lines.map((l) => ({
          partName: 'Gate Part',
          clientPoLineNo: l.pol,
          revision: 'A',
          itemId: firstItemId,
          uom: 'NOS' as const,
          orderQty: l.qty,
          rate: 0,
        })),
        ...(milestones ? { milestones } : {}),
      },
      admin,
    );
  }

  /** Put a hand-raised Job Card on the line — the SO is then IN USE. */
  async function putJc(lineId: string): Promise<string> {
    const code = `T030-JC-${Date.now()}-${jcIds.length}`;
    const jc = await db
      .insert(jobCards)
      .values({
        companyId: admin.companyId!,
        code,
        jcDate: '2026-05-02',
        itemId: firstItemId,
        orderQty: 1,
        sourceSoLineId: lineId,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobCards.id });
    jcIds.push(jc[0]!.id);
    return code;
  }

  const line = (id: string | undefined, pol: string, qty: number): SalesOrderLineInput => ({
    ...(id ? { id } : {}),
    partName: 'Gate Part',
    clientPoLineNo: pol,
    revision: 'A',
    itemId: firstItemId,
    uom: 'NOS',
    orderQty: qty,
    rate: 0,
  });

  async function readSoLine(id: string) {
    const rows = await db.select().from(salesOrderLines).where(eq(salesOrderLines.id, id));
    return rows[0]!;
  }

  it('nothing downstream: a line edit applies directly even with the gate on', async () => {
    const so = await newSo('LA1');
    const res = await service.updateSalesOrderOrStage(
      so.id,
      {
        header: {},
        lines: [line(so.lines[0]!.id, '21', 3)],
        expectedUpdatedAt: so.updatedAt,
      },
      admin,
    );
    expect((res as DocumentEditStagedResult).staged).toBeUndefined();
    const l = await readSoLine(so.lines[0]!.id);
    expect(l.clientPoLineNo).toBe('21');
    expect(l.orderQty).toBe(3);
  }, 180_000);

  it('in use: a qty change is staged as line:<id>:orderQty; approve → applied; reject → unchanged', async () => {
    const so = await newSo('LA2', [
      { pol: '20', qty: 2 },
      { pol: '30', qty: 4 },
    ]);
    const [l1, l2] = so.lines;
    await putJc(l1!.id);
    const staged = (await service.updateSalesOrderOrStage(
      so.id,
      {
        header: {},
        lines: [line(l1!.id, '20', 5), line(l2!.id, '30', 6)],
        expectedUpdatedAt: so.updatedAt,
      },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);
    const box1 = staged.request.changes.find((c) => c.id === `line:${l1!.id}:orderQty`);
    const box2 = staged.request.changes.find((c) => c.id === `line:${l2!.id}:orderQty`);
    expect(box1?.label).toBe('Line 1 · Order Qty');
    expect(box2).toBeTruthy();
    await decideDocumentEdit(
      {
        id: staged.request.id,
        decisions: [
          { changeId: box1!.id, decision: 'approve' },
          { changeId: box2!.id, decision: 'reject', reason: 'no' },
        ],
      },
      admin,
    );
    expect((await readSoLine(l1!.id)).orderQty).toBe(5);
    expect((await readSoLine(l2!.id)).orderQty).toBe(4);
  }, 180_000);

  it('in use: add a line and remove an unused line — one box each', async () => {
    const so = await newSo('LA3', [
      { pol: '20', qty: 2 },
      { pol: '30', qty: 3 },
    ]);
    const [l1, l2] = so.lines;
    await putJc(l1!.id);
    const staged = (await service.updateSalesOrderOrStage(
      so.id,
      {
        header: {},
        lines: [line(l1!.id, '20', 2), line(undefined, '40', 7)],
        expectedUpdatedAt: so.updatedAt,
      },
      admin,
    )) as DocumentEditStagedResult;
    const add = staged.request.changes.find((c) => c.id === 'line:add:1');
    const remove = staged.request.changes.find((c) => c.id === `line:remove:${l2!.id}`);
    expect(add?.label.startsWith(`Add line · ${firstItemCode}`)).toBe(true);
    expect(remove?.label.startsWith('Remove line 2')).toBe(true);
    await decideDocumentEdit(
      {
        id: staged.request.id,
        decisions: [
          { changeId: add!.id, decision: 'approve' },
          { changeId: remove!.id, decision: 'approve' },
        ],
      },
      admin,
    );
    const live = await db
      .select()
      .from(salesOrderLines)
      .where(and(eq(salesOrderLines.salesOrderId, so.id), isNull(salesOrderLines.deletedAt)));
    expect(live.map((l) => l.clientPoLineNo).sort()).toEqual(['20', '40']);
  }, 180_000);

  it('qty below what is dispatched: refused at request, and at approval when it drifted', async () => {
    const so = await newSo('LA4', [{ pol: '20', qty: 5 }]);
    const lineId = so.lines[0]!.id;
    await db
      .update(salesOrderLines)
      .set({ dispatchedQty: 3 })
      .where(eq(salesOrderLines.id, lineId));
    const fresh = await service.getSalesOrder(so.id, admin);
    await expect(
      service.updateSalesOrderOrStage(
        so.id,
        { header: {}, lines: [line(lineId, '20', 2)], expectedUpdatedAt: fresh.updatedAt },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const staged = (await service.updateSalesOrderOrStage(
      so.id,
      { header: {}, lines: [line(lineId, '20', 4)], expectedUpdatedAt: fresh.updatedAt },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);
    await db
      .update(salesOrderLines)
      .set({ dispatchedQty: 5 })
      .where(eq(salesOrderLines.id, lineId));
    await expect(
      decideDocumentEdit(
        {
          id: staged.request.id,
          decisions: [{ changeId: `line:${lineId}:orderQty`, decision: 'approve' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await readSoLine(lineId)).orderQty).toBe(5);
    await db
      .update(salesOrderLines)
      .set({ dispatchedQty: 0 })
      .where(eq(salesOrderLines.id, lineId));
  }, 180_000);

  it('partial approval: approve POL, reject qty → only POL is written', async () => {
    const so = await newSo('LA5');
    const lineId = so.lines[0]!.id;
    await putJc(lineId);
    const staged = (await service.updateSalesOrderOrStage(
      so.id,
      { header: {}, lines: [line(lineId, '21', 3)], expectedUpdatedAt: so.updatedAt },
      admin,
    )) as DocumentEditStagedResult;
    await decideDocumentEdit(
      {
        id: staged.request.id,
        decisions: [
          { changeId: `line:${lineId}:clientPoLineNo`, decision: 'approve' },
          { changeId: `line:${lineId}:orderQty`, decision: 'reject', reason: 'keep qty' },
        ],
      },
      admin,
    );
    const l = await readSoLine(lineId);
    expect(l.clientPoLineNo).toBe('21');
    expect(l.orderQty).toBe(2);
  }, 180_000);

  it('in use: a Delivery Schedule change is ms:<id>:qty + ms:add:1; approve applies both', async () => {
    const so = await newSo('LA6', [{ pol: '20', qty: 4 }], [{ lotNo: 1, qty: 4 }]);
    await putJc(so.lines[0]!.id);
    const msId = so.milestones[0]!.id;
    const staged = (await service.updateSalesOrderOrStage(
      so.id,
      {
        header: {},
        milestones: [
          { id: msId, lotNo: 1, qty: 2 },
          { lotNo: 2, qty: 2 },
        ],
        expectedUpdatedAt: so.updatedAt,
      },
      admin,
    )) as DocumentEditStagedResult;
    const qtyBox = staged.request.changes.find((c) => c.id === `ms:${msId}:qty`);
    const addBox = staged.request.changes.find((c) => c.id === 'ms:add:1');
    expect(qtyBox?.label).toBe('Lot 1 · Qty');
    expect(addBox?.label).toBe('Add lot · Lot 2 × 2');
    await decideDocumentEdit(
      {
        id: staged.request.id,
        decisions: [
          { changeId: qtyBox!.id, decision: 'approve' },
          { changeId: addBox!.id, decision: 'approve' },
        ],
      },
      admin,
    );
    const lots = await db
      .select()
      .from(soMilestones)
      .where(and(eq(soMilestones.salesOrderId, so.id), isNull(soMilestones.deletedAt)));
    expect(lots.map((m) => [m.lotNo, m.qty]).sort()).toEqual([
      [1, 2],
      [2, 2],
    ]);
  }, 180_000);

  it('in use: an SO Status move is a header box, not a refusal', async () => {
    const so = await newSo('LA7');
    await putJc(so.lines[0]!.id);
    const staged = (await service.updateSalesOrderOrStage(
      so.id,
      { header: { status: 'draft' }, expectedUpdatedAt: so.updatedAt },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);
    expect(staged.request.changes.map((c) => c.id)).toEqual(['status']);
  }, 180_000);

  it('in use: an unchanged resend (blank Remarks vs stored null) is no line box — the header stages', async () => {
    const so = await newSo('LA8');
    await putJc(so.lines[0]!.id);
    const res = (await service.updateSalesOrderOrStage(
      so.id,
      {
        header: { remarks: 'header note' },
        lines: [{ ...line(so.lines[0]!.id, '20', 2), remarks: '' }],
        expectedUpdatedAt: so.updatedAt,
      },
      admin,
    )) as DocumentEditStagedResult;
    expect(res.staged).toBe(true);
    expect(res.request.changes.map((c) => c.id)).toEqual(['remarks']);
  }, 180_000);

  // ── Code-review fixes (2026-10-26) ─────────────────────────────────────────

  it('stale request: in use turns off while an edit waits — a new edit is refused, not written beside it', async () => {
    const so = await newSo('LA9');
    const lineId = so.lines[0]!.id;
    await putJc(lineId);
    const staged = (await service.updateSalesOrderOrStage(
      so.id,
      { header: {}, lines: [line(lineId, '20', 5)], expectedUpdatedAt: so.updatedAt },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);
    await db.update(jobCards).set({ deletedAt: new Date() }).where(eq(jobCards.sourceSoLineId, lineId));
    const err = await service
      .updateSalesOrderOrStage(
        so.id,
        { header: {}, lines: [line(lineId, '22', 2)], expectedUpdatedAt: so.updatedAt },
        admin,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toContain('already has an edit waiting');
    const l = await readSoLine(lineId);
    expect(l.clientPoLineNo).toBe('20');
    expect(l.orderQty).toBe(2);
  }, 180_000);

  it('add box: a lot added by someone else before approval marks the lot add superseded', async () => {
    const so = await newSo('LA10', [{ pol: '20', qty: 4 }], [{ lotNo: 1, qty: 4 }]);
    await putJc(so.lines[0]!.id);
    const msId = so.milestones[0]!.id;
    const staged = (await service.updateSalesOrderOrStage(
      so.id,
      {
        header: {},
        milestones: [
          { id: msId, lotNo: 1, qty: 4 },
          { lotNo: 2, qty: 2 },
        ],
        expectedUpdatedAt: so.updatedAt,
      },
      admin,
    )) as DocumentEditStagedResult;
    const add = staged.request.changes.find((c) => c.id === 'ms:add:1');
    expect(String(add?.before)).toMatch(/^1 lot on the order \(ref [0-9a-f]{6}\)$/);
    // Someone else adds a lot meanwhile.
    await db.insert(soMilestones).values({
      companyId: admin.companyId!,
      salesOrderId: so.id,
      lotNo: 3,
      qty: 1,
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    const decided = await decideDocumentEdit(
      { id: staged.request.id, decisions: [{ changeId: add!.id, decision: 'approve' }] },
      admin,
    );
    expect(decided.decisions.find((d) => d.changeId === add!.id)?.outcome).toBe('superseded');
  }, 180_000);

  it('§20: the direct write re-checks in use under its own locks — an SO that came into use is refused 409', async () => {
    const so = await newSo('LA11');
    const lineId = so.lines[0]!.id;
    await putJc(lineId);
    const err = await withUserContext(admin, (tx) =>
      service.updateSalesOrderTx(
        tx,
        so.id,
        { header: {}, lines: [line(lineId, '23', 2)], expectedUpdatedAt: so.updatedAt },
        admin,
        null,
        { requireNotLive: true },
      ),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toBe(
      'This Sales Order is now in use — save again and the change will go for approval.',
    );
    expect((await readSoLine(lineId)).clientPoLineNo).toBe('20');
  }, 180_000);

  it('a lot Due Date box reads as a date, like the line Due Date', async () => {
    const so = await newSo('LA12', [{ pol: '20', qty: 4 }], [{ lotNo: 1, qty: 4 }]);
    await putJc(so.lines[0]!.id);
    const msId = so.milestones[0]!.id;
    const staged = (await service.updateSalesOrderOrStage(
      so.id,
      {
        header: {},
        milestones: [{ id: msId, lotNo: 1, qty: 4, dueDate: '2026-12-31' }],
        expectedUpdatedAt: so.updatedAt,
      },
      admin,
    )) as DocumentEditStagedResult;
    const box = staged.request.changes.find((c) => c.id === `ms:${msId}:dueDate`);
    expect(box?.label).toBe('Lot 1 · Due Date');
    expect(box?.after).toBe(fmtDate('2026-12-31'));
  }, 180_000);
});
