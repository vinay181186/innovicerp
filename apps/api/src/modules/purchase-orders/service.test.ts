import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  items,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
  users,
  vendors,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T036B-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;
let firstVendorId: string;

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
  const itemRow = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(eq(items.companyId, u.companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
    )
    .orderBy(asc(items.createdAt))
    .limit(1);
  firstItemId = itemRow[0]!.id;
  const vendorRow = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(
        eq(vendors.companyId, u.companyId),
        isNull(vendors.deletedAt),
        notLike(vendors.code, 'T%-%'),
      ),
    )
    .orderBy(asc(vendors.createdAt))
    .limit(1);
  firstVendorId = vendorRow[0]!.id;
});

afterAll(async () => {
  // Cleanup: lines first (FK), then PRs that point at our test POs, then POs.
  const testHeaders = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
  const ids = testHeaders.map((h) => h.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
      // Clear poId on any PR that pointed at this PO so the FK cascade doesn't fail.
      await db
        .update(purchaseRequests)
        .set({ poId: null, status: 'open' })
        .where(eq(purchaseRequests.poId, id));
    }
    await db.delete(purchaseOrders).where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
  }
  await db.delete(purchaseRequests).where(like(purchaseRequests.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
});

describe('purchase-orders service', () => {
  it('createPurchaseOrder inserts header + lines with audit + correct enum/numeric coercion', async () => {
    const code = `${TEST_PREFIX}A1`;
    const detail = await service.createPurchaseOrder(
      {
        header: {
          code,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          status: 'draft',
          taxType: 'sgst_cgst',
          sgstPct: 9,
          cgstPct: 9,
          igstPct: 0,
        },
        lines: [
          { itemId: firstItemId, itemName: 'Widget Alpha', qty: 10, rate: 100.5 },
          { itemCodeText: 'NONEXISTENT-CODE', itemName: 'Widget Beta', qty: 5, rate: 50 },
        ],
      },
      admin,
    );
    expect(detail.code).toBe(code);
    expect(detail.companyId).toBe(admin.companyId);
    expect(detail.createdBy).toBe(admin.id);
    expect(detail.poType).toBe('standard');
    expect(detail.sgstPct).toBe('9.00');
    expect(detail.lines).toHaveLength(2);
    expect(detail.lines[0]?.lineNo).toBe(1);
    expect(detail.lines[0]?.itemId).toBe(firstItemId);
    expect(detail.lines[0]?.rate).toBe('100.50');
    expect(detail.lines[1]?.itemId).toBeNull();
    expect(detail.lines[1]?.itemCodeText).toBe('NONEXISTENT-CODE');
  });

  it('createPurchaseOrder rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createPurchaseOrder(
      {
        header: {
          code,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          status: 'draft',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [{ itemId: firstItemId, itemName: 'X', qty: 1, rate: 0 }],
      },
      admin,
    );
    await expect(
      service.createPurchaseOrder(
        {
          header: {
            code,
            poDate: '2026-05-03',
            poType: 'standard',
            vendorId: firstVendorId,
            status: 'draft',
            sgstPct: 0,
            cgstPct: 0,
            igstPct: 0,
          },
          lines: [{ itemId: firstItemId, itemName: 'X', qty: 1, rate: 0 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createPurchaseOrder rejects unknown vendorId / itemId with ValidationError', async () => {
    await expect(
      service.createPurchaseOrder(
        {
          header: {
            code: `${TEST_PREFIX}BADV`,
            poDate: '2026-05-03',
            poType: 'standard',
            vendorId: '00000000-0000-0000-0000-000000000000',
            status: 'draft',
            sgstPct: 0,
            cgstPct: 0,
            igstPct: 0,
          },
          lines: [{ itemId: firstItemId, itemName: 'X', qty: 1, rate: 0 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.createPurchaseOrder(
        {
          header: {
            code: `${TEST_PREFIX}BADI`,
            poDate: '2026-05-03',
            poType: 'standard',
            vendorId: firstVendorId,
            status: 'draft',
            sgstPct: 0,
            cgstPct: 0,
            igstPct: 0,
          },
          lines: [
            { itemId: '00000000-0000-0000-0000-000000000000', itemName: 'X', qty: 1, rate: 0 },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('listPurchaseOrders returns aggregates + applies status/type filters', async () => {
    const code = `${TEST_PREFIX}LST`;
    await service.createPurchaseOrder(
      {
        header: {
          code,
          poDate: '2026-05-03',
          poType: 'job_work',
          vendorId: firstVendorId,
          status: 'open',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [
          { itemId: firstItemId, itemName: 'A', qty: 4, rate: 0 },
          { itemId: firstItemId, itemName: 'B', qty: 6, rate: 0 },
        ],
      },
      admin,
    );
    const result = await service.listPurchaseOrders(
      { search: 'T036B-LST', status: 'open', poType: 'job_work', limit: 50, offset: 0 },
      admin,
    );
    const found = result.items.find((p) => p.code === code);
    expect(found?.lineCount).toBe(2);
    expect(found?.totalQty).toBe(10);
    expect(found?.receivedQty).toBe(0);
    expect(found?.vendorName).not.toBeNull();
  });

  it('updatePurchaseOrder header-only does NOT touch lines (option C)', async () => {
    const code = `${TEST_PREFIX}UH1`;
    const created = await service.createPurchaseOrder(
      {
        header: {
          code,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          status: 'draft',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [{ itemId: firstItemId, itemName: 'Stay', qty: 9, rate: 0 }],
      },
      admin,
    );
    const updated = await service.updatePurchaseOrder(
      created.id,
      { header: { remarks: 'changed', status: 'open' } },
      admin,
    );
    expect(updated.remarks).toBe('changed');
    expect(updated.status).toBe('open');
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]?.id).toBe(created.lines[0]?.id);
    expect(updated.lines[0]?.itemName).toBe('Stay');
  });

  it('updatePurchaseOrder merges lines: id-matched updated, new inserted, absent soft-deleted', async () => {
    const code = `${TEST_PREFIX}UM1`;
    const created = await service.createPurchaseOrder(
      {
        header: {
          code,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          status: 'open',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [
          { itemId: firstItemId, itemName: 'Keep+Update', qty: 10, rate: 0 },
          { itemId: firstItemId, itemName: 'Drop Me', qty: 20, rate: 0 },
        ],
      },
      admin,
    );
    const keptId = created.lines[0]!.id;
    const updated = await service.updatePurchaseOrder(
      created.id,
      {
        header: {},
        lines: [
          { id: keptId, itemId: firstItemId, itemName: 'Keep+Updated', qty: 11, rate: 0 },
          { itemId: firstItemId, itemName: 'Brand New', qty: 30, rate: 0 },
        ],
      },
      admin,
    );
    expect(updated.lines).toHaveLength(2);
    const kept = updated.lines.find((l) => l.id === keptId);
    const fresh = updated.lines.find((l) => l.id !== keptId);
    expect(kept?.itemName).toBe('Keep+Updated');
    expect(kept?.qty).toBe(11);
    expect(fresh?.itemName).toBe('Brand New');
    expect(fresh?.lineNo).toBe(2);
  });

  it('updatePurchaseOrder ignores received_qty in payload (mutated only by GRN cascade in T-036c)', async () => {
    const code = `${TEST_PREFIX}URQ`;
    const created = await service.createPurchaseOrder(
      {
        header: {
          code,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          status: 'open',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [{ itemId: firstItemId, itemName: 'X', qty: 10, rate: 0 }],
      },
      admin,
    );
    const lineId = created.lines[0]!.id;
    const updated = await service.updatePurchaseOrder(
      created.id,
      {
        header: {},
        lines: [
          { id: lineId, itemId: firstItemId, itemName: 'X', qty: 12, rate: 0, receivedQty: 999 },
        ],
      },
      admin,
    );
    expect(updated.lines[0]?.qty).toBe(12);
    expect(updated.lines[0]?.receivedQty).toBe(0); // ignored
  });

  it('createPurchaseOrderFromPr creates PO + line and stamps PR with poId/poCreatedAt/status', async () => {
    const prCode = `${TEST_PREFIX}PR1`;
    const prRow = await db
      .insert(purchaseRequests)
      .values({
        companyId: admin.companyId!,
        code: prCode,
        prDate: '2026-05-03',
        status: 'open',
        vendorId: firstVendorId,
        itemId: firstItemId,
        itemName: 'PR Source Item',
        qty: 25,
        estCost: '12.34',
        operation: 'COATING',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const pr = prRow[0]!;

    const poCode = `${TEST_PREFIX}FROM-PR-1`;
    const detail = await service.createPurchaseOrderFromPr(
      {
        prId: pr.id,
        header: {
          code: poCode,
          poDate: '2026-05-03',
          poType: 'job_work',
          taxType: 'sgst_cgst',
          sgstPct: 9,
          cgstPct: 9,
          igstPct: 0,
        },
      },
      admin,
    );
    expect(detail.code).toBe(poCode);
    expect(detail.status).toBe('open');
    expect(detail.poType).toBe('job_work');
    expect(detail.vendorId).toBe(firstVendorId);
    expect(detail.prCodeText).toBe(prCode);
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]?.qty).toBe(25);
    expect(detail.lines[0]?.rate).toBe('12.34');
    expect(detail.lines[0]?.itemName).toBe('PR Source Item');

    // PR side-effects
    const reread = await db
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, pr.id))
      .limit(1);
    const updated = reread[0]!;
    expect(updated.poId).toBe(detail.id);
    expect(updated.status).toBe('po_created');
    expect(updated.poCreatedAt).not.toBeNull();
  });

  it('createPurchaseOrderFromPr blocks when PR already converted (status=po_created)', async () => {
    const prCode = `${TEST_PREFIX}PR2`;
    const prRow = await db
      .insert(purchaseRequests)
      .values({
        companyId: admin.companyId!,
        code: prCode,
        prDate: '2026-05-03',
        status: 'po_created',
        vendorId: firstVendorId,
        itemId: firstItemId,
        qty: 1,
        estCost: '0',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    await expect(
      service.createPurchaseOrderFromPr(
        {
          prId: prRow[0]!.id,
          header: {
            code: `${TEST_PREFIX}NOPE`,
            poDate: '2026-05-03',
            poType: 'job_work',
            sgstPct: 0,
            cgstPct: 0,
            igstPct: 0,
          },
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createPurchaseOrderFromPr blocks when PR is cancelled', async () => {
    const prCode = `${TEST_PREFIX}PR3`;
    const prRow = await db
      .insert(purchaseRequests)
      .values({
        companyId: admin.companyId!,
        code: prCode,
        prDate: '2026-05-03',
        status: 'cancelled',
        vendorId: firstVendorId,
        itemId: firstItemId,
        qty: 1,
        estCost: '0',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    await expect(
      service.createPurchaseOrderFromPr(
        {
          prId: prRow[0]!.id,
          header: {
            code: `${TEST_PREFIX}NOPE2`,
            poDate: '2026-05-03',
            poType: 'job_work',
            sgstPct: 0,
            cgstPct: 0,
            igstPct: 0,
          },
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('softDeletePurchaseOrder soft-deletes header + lines', async () => {
    const code = `${TEST_PREFIX}DEL`;
    const created = await service.createPurchaseOrder(
      {
        header: {
          code,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          status: 'open',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [{ itemId: firstItemId, itemName: 'L1', qty: 1, rate: 0 }],
      },
      admin,
    );
    await service.softDeletePurchaseOrder(created.id, admin);
    await expect(service.getPurchaseOrder(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, created.id));
    expect(lines.every((l) => l.deletedAt !== null)).toBe(true);
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.createPurchaseOrder(
        {
          header: {
            code: `${TEST_PREFIX}NOC`,
            poDate: '2026-05-03',
            poType: 'standard',
            vendorId: firstVendorId,
            status: 'draft',
            sgstPct: 0,
            cgstPct: 0,
            igstPct: 0,
          },
          lines: [{ itemId: firstItemId, itemName: 'L', qty: 1, rate: 0 }],
        },
        noCompanyUser,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('emits CREATE / EDIT / DELETE activity_log rows atomic with the mutation', async () => {
    const code = `${TEST_PREFIX}AUD`;
    const created = await service.createPurchaseOrder(
      {
        header: {
          code,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          vendorCodeText: 'AUDIT-VEN',
          status: 'draft',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [{ itemId: firstItemId, itemName: 'Audit Item', qty: 1, rate: 0 }],
      },
      admin,
    );
    await service.updatePurchaseOrder(created.id, { header: { remarks: 'updated' } }, admin);
    await service.softDeletePurchaseOrder(created.id, admin);

    const auditRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, code)));
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(['CREATE', 'DELETE', 'EDIT']);
    for (const r of auditRows) {
      expect(r.entity).toBe('PurchaseOrder');
      expect(r.userId).toBe(admin.id);
      expect(r.userName).toBe(admin.email);
      expect(r.detail).toContain(code);
    }
  });

  it('createPurchaseOrderFromPr emits PO CREATE + PR PR_CONVERT atomic with the conversion', async () => {
    const prCode = `${TEST_PREFIX}AUD-PR`;
    const poCode = `${TEST_PREFIX}AUD-FROM-PR`;
    const pr = await db
      .insert(purchaseRequests)
      .values({
        companyId: admin.companyId!,
        code: prCode,
        prDate: '2026-05-03',
        status: 'open',
        vendorId: firstVendorId,
        vendorCodeText: 'PR-VEN',
        itemId: firstItemId,
        itemName: 'PR Item',
        qty: 4,
        estCost: '0.00',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    await service.createPurchaseOrderFromPr(
      {
        prId: pr[0]!.id,
        header: {
          code: poCode,
          poDate: '2026-05-03',
          poType: 'job_work',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
      },
      admin,
    );

    const poAudit = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, poCode)));
    expect(poAudit.map((r) => r.action)).toEqual(['CREATE']);
    expect(poAudit[0]!.entity).toBe('PurchaseOrder');

    const prAudit = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, prCode)));
    expect(prAudit.map((r) => r.action)).toEqual(['PR_CONVERT']);
    expect(prAudit[0]!.entity).toBe('PurchaseRequest');
    expect(prAudit[0]!.detail).toContain(prCode);
    expect(prAudit[0]!.detail).toContain(poCode);
  });
});
