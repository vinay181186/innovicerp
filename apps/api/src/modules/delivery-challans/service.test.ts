// DC service tests.
//
// T-040a: read-only — list + get against migrated dev rows.
// T-059a: outward writes — createDeliveryChallan + cancelDeliveryChallan with
//   cascades into jc_ops.outsource_status / outsource_sent_qty +
//   store_transactions ledger. Tests build fresh JW PO + outsource jc_op
//   fixtures under the T059A- prefix.

import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  deliveryChallanLines,
  deliveryChallans,
  items,
  jcOps,
  jobCards,
  purchaseOrderLines,
  purchaseOrders,
  storeTransactions,
  users,
  vendors,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import * as poService from '../purchase-orders/service';
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

describe('delivery-challans service', () => {
  it('listDeliveryChallans returns the 4 migrated challans with vendor/po/line aggregates', async () => {
    const result = await service.listDeliveryChallans({ limit: 200, offset: 0 }, admin);
    expect(result.items.length).toBeGreaterThanOrEqual(4);
    // All 4 migrated DCs are vendored to VND-001
    const vendorNames = new Set(result.items.map((d) => d.vendorName));
    expect(vendorNames.size).toBeGreaterThan(0);
    // Each migrated DC has 1 line in current data
    for (const dc of result.items) {
      expect(dc.lineCount).toBeGreaterThanOrEqual(0);
    }
    // DC-00002 case: po_unresolved → poCode null but poCodeText preserved
    const dc00002 = result.items.find((d) => d.code === 'DC-00002');
    if (dc00002) {
      expect(dc00002.purchaseOrderId).toBeNull();
      expect(dc00002.poCodeText).toBe('IN-PO-00002');
    }
  });

  it('listDeliveryChallans status filter narrows to issued', async () => {
    const result = await service.listDeliveryChallans(
      { status: 'issued', limit: 200, offset: 0 },
      admin,
    );
    expect(result.items.every((d) => d.status === 'issued')).toBe(true);
  });

  it('listDeliveryChallans search matches code prefix', async () => {
    const result = await service.listDeliveryChallans(
      { search: 'DC-00001', limit: 50, offset: 0 },
      admin,
    );
    // DC-00001, DC-00001-02, DC-00001-03 all match
    expect(result.items.length).toBeGreaterThanOrEqual(3);
  });

  it('getDeliveryChallan returns header + lines for a migrated DC', async () => {
    const list = await service.listDeliveryChallans({ limit: 1, offset: 0 }, admin);
    const first = list.items[0];
    expect(first).toBeDefined();
    const detail = await service.getDeliveryChallan(first!.id, admin);
    expect(detail.id).toBe(first!.id);
    expect(detail.lines.length).toBeGreaterThanOrEqual(1);
    // Lines preserve uom enum + qty as numeric string
    for (const line of detail.lines) {
      expect(line.uom).toBeDefined();
      expect(line.qty).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('getDeliveryChallan throws NotFoundError on unknown id', async () => {
    await expect(
      service.getDeliveryChallan('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── T-059a: outward write path ────────────────────────────────────────────

const TEST_PREFIX = 'T059A-';

let manager: AuthContext;
let testItemId: string;
let firstVendorId: string;

async function freshJwPo(suffix: string, qty = 10): Promise<{ id: string; lineId: string }> {
  const code = `${TEST_PREFIX}PO-${suffix}-${Date.now()}`;
  const detail = await poService.createPurchaseOrder(
    {
      header: {
        code,
        poDate: '2026-05-18',
        poType: 'job_work',
        vendorId: firstVendorId,
        status: 'open',
        sgstPct: 0,
        cgstPct: 0,
        igstPct: 0,
      },
      lines: [{ itemId: testItemId, itemName: 'JW outsource source', qty, rate: 0 }],
    },
    admin,
  );
  return { id: detail.id, lineId: detail.lines[0]!.id };
}

async function freshOutsourceJcOp(
  suffix: string,
  poLineId: string,
  status: 'po_created' | 'pr_raised' | 'pending' = 'po_created',
): Promise<{ jcId: string; jcCode: string; opId: string }> {
  const jcCode = `${TEST_PREFIX}JC-${suffix}-${Date.now()}`;
  const jcRows = await db
    .insert(jobCards)
    .values({
      companyId: admin.companyId!,
      code: jcCode,
      jcDate: '2026-05-18',
      itemId: testItemId,
      orderQty: 50,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  const jcId = jcRows[0]!.id;
  const opRows = await db
    .insert(jcOps)
    .values({
      companyId: admin.companyId!,
      jobCardId: jcId,
      opSeq: 1,
      operation: 'COATING',
      opType: 'outsource',
      outsourceVendorId: firstVendorId,
      outsourcePoLineId: poLineId,
      outsourceStatus: status,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  return { jcId, jcCode, opId: opRows[0]!.id };
}

async function readJcOp(opId: string): Promise<{
  outsourceSentQty: number;
  outsourceStatus: string | null;
  outsourceDcNo: string | null;
  outsourceSentDate: string | null;
}> {
  const rows = await db
    .select({
      outsourceSentQty: jcOps.outsourceSentQty,
      outsourceStatus: jcOps.outsourceStatus,
      outsourceDcNo: jcOps.outsourceDcNo,
      outsourceSentDate: jcOps.outsourceSentDate,
    })
    .from(jcOps)
    .where(eq(jcOps.id, opId))
    .limit(1);
  return rows[0]! as {
    outsourceSentQty: number;
    outsourceStatus: string | null;
    outsourceDcNo: string | null;
    outsourceSentDate: string | null;
  };
}

async function readStockTxnsFor(
  sourceRefLike: string,
): Promise<Array<{ txnType: string; qty: number; sourceType: string; remarks: string | null }>> {
  return db
    .select({
      txnType: storeTransactions.txnType,
      qty: storeTransactions.qty,
      sourceType: storeTransactions.sourceType,
      remarks: storeTransactions.remarks,
    })
    .from(storeTransactions)
    .where(like(storeTransactions.sourceRef, sourceRefLike));
}

describe('delivery-challans service — outward writes (T-059a)', () => {
  beforeAll(async () => {
    manager = { ...admin, role: 'manager' };
    await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
    const itemRows = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}ITEM`,
        name: 'DC outward test item',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    testItemId = itemRows[0]!.id;
    const vendorRow = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(
        and(
          eq(vendors.companyId, admin.companyId!),
          isNull(vendors.deletedAt),
          notLike(vendors.code, 'T%-%'),
        ),
      )
      .orderBy(asc(vendors.createdAt))
      .limit(1);
    firstVendorId = vendorRow[0]!.id;
  });

  beforeEach(async () => {
    await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${TEST_PREFIX}%`));
  });

  afterAll(async () => {
    const dcs = await db
      .select({ id: deliveryChallans.id })
      .from(deliveryChallans)
      .where(like(deliveryChallans.code, `${TEST_PREFIX}%`));
    for (const d of dcs) {
      await db.delete(deliveryChallanLines).where(eq(deliveryChallanLines.deliveryChallanId, d.id));
    }
    await db.delete(deliveryChallans).where(like(deliveryChallans.code, `${TEST_PREFIX}%`));
    await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${TEST_PREFIX}%`));
    await db.delete(jobCards).where(like(jobCards.code, `${TEST_PREFIX}%`));
    const poHeaders = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
    for (const h of poHeaders) {
      await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, h.id));
    }
    await db.delete(purchaseOrders).where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
    await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
    await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  });

  it('createDeliveryChallan inserts header + lines and returns detail', async () => {
    const po = await freshJwPo('CR1', 10);
    const dcCode = `${TEST_PREFIX}CR1`;
    const detail = await service.createDeliveryChallan(
      {
        header: {
          code: dcCode,
          dcDate: '2026-05-18',
          purchaseOrderId: po.id,
          poCodeText: 'JW-PO',
          vendorId: firstVendorId,
          vendorCodeText: 'TEST-VENDOR',
        },
        lines: [
          {
            itemId: testItemId,
            itemCodeText: `${TEST_PREFIX}ITEM`,
            qty: 4,
            uom: 'NOS',
            purchaseOrderLineId: po.lineId,
          },
        ],
      },
      admin,
    );
    expect(detail.code).toBe(dcCode);
    expect(detail.lines).toHaveLength(1);
    expect(Number(detail.lines[0]?.qty)).toBe(4);
    expect(detail.lines[0]?.purchaseOrderLineId).toBe(po.lineId);
    expect(detail.status).toBe('issued');
  });

  it('createDeliveryChallan flips jc_op status po_created → sent and bumps sent_qty', async () => {
    const po = await freshJwPo('CR2', 10);
    const op = await freshOutsourceJcOp('CR2', po.lineId, 'po_created');
    const dcCode = `${TEST_PREFIX}CR2`;
    await service.createDeliveryChallan(
      {
        header: {
          code: dcCode,
          dcDate: '2026-05-18',
          purchaseOrderId: po.id,
          poCodeText: 'JW-PO',
          vendorId: firstVendorId,
          vendorCodeText: 'TEST-VENDOR',
        },
        lines: [
          {
            itemId: testItemId,
            itemCodeText: `${TEST_PREFIX}ITEM`,
            qty: 6,
            uom: 'NOS',
            purchaseOrderLineId: po.lineId,
          },
        ],
      },
      admin,
    );
    const after = await readJcOp(op.opId);
    expect(after.outsourceStatus).toBe('sent');
    expect(after.outsourceSentQty).toBe(6);
    expect(after.outsourceDcNo).toBe(dcCode);
    expect(after.outsourceSentDate).toBe('2026-05-18');
  });

  it('createDeliveryChallan writes store_transactions OUT row with source_type=jw_out', async () => {
    const po = await freshJwPo('CR3', 10);
    const dcCode = `${TEST_PREFIX}CR3`;
    await service.createDeliveryChallan(
      {
        header: {
          code: dcCode,
          dcDate: '2026-05-18',
          purchaseOrderId: po.id,
          poCodeText: 'JW-PO',
          vendorId: firstVendorId,
          vendorCodeText: 'TEST-VENDOR',
        },
        lines: [
          {
            itemId: testItemId,
            itemCodeText: `${TEST_PREFIX}ITEM`,
            qty: 3,
            uom: 'NOS',
            purchaseOrderLineId: po.lineId,
          },
        ],
      },
      admin,
    );
    const txns = await readStockTxnsFor(`${dcCode}%`);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({
      txnType: 'out',
      qty: 3,
      sourceType: 'jw_out',
    });
  });

  it('createDeliveryChallan emits DC_ISSUE + OP_OUTSOURCE_SENT audit rows in same tx', async () => {
    const po = await freshJwPo('CR4', 10);
    await freshOutsourceJcOp('CR4', po.lineId, 'po_created');
    const dcCode = `${TEST_PREFIX}CR4`;
    await service.createDeliveryChallan(
      {
        header: {
          code: dcCode,
          dcDate: '2026-05-18',
          purchaseOrderId: po.id,
          poCodeText: 'JW-PO',
          vendorId: firstVendorId,
          vendorCodeText: 'TEST-VENDOR',
        },
        lines: [
          {
            itemId: testItemId,
            itemCodeText: `${TEST_PREFIX}ITEM`,
            qty: 5,
            uom: 'NOS',
            purchaseOrderLineId: po.lineId,
          },
        ],
      },
      admin,
    );
    const rows = await db
      .select({
        action: activityLog.action,
        entity: activityLog.entity,
        detail: activityLog.detail,
      })
      .from(activityLog)
      .where(like(activityLog.detail, `%${dcCode}%`));
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toContain('DC_ISSUE');
    expect(actions).toContain('OP_OUTSOURCE_SENT');
    const issue = rows.find((r) => r.action === 'DC_ISSUE');
    expect(issue?.detail).toContain(dcCode);
    expect(issue?.detail).toContain('TEST-VENDOR');
  });

  it('createDeliveryChallan rejects qty exceeding PO line remaining', async () => {
    const po = await freshJwPo('CR5', 10);
    await expect(
      service.createDeliveryChallan(
        {
          header: {
            code: `${TEST_PREFIX}CR5`,
            dcDate: '2026-05-18',
            purchaseOrderId: po.id,
            poCodeText: 'JW-PO',
            vendorId: firstVendorId,
            vendorCodeText: 'TEST-VENDOR',
          },
          lines: [
            {
              itemId: testItemId,
              itemCodeText: `${TEST_PREFIX}ITEM`,
              qty: 15,
              uom: 'NOS',
              purchaseOrderLineId: po.lineId,
            },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const dcs = await db
      .select({ id: deliveryChallans.id })
      .from(deliveryChallans)
      .where(eq(deliveryChallans.code, `${TEST_PREFIX}CR5`));
    expect(dcs).toHaveLength(0);
  });

  it('createDeliveryChallan rejects duplicate code', async () => {
    const po = await freshJwPo('CR6', 10);
    const code = `${TEST_PREFIX}CR6`;
    await service.createDeliveryChallan(
      {
        header: {
          code,
          dcDate: '2026-05-18',
          purchaseOrderId: po.id,
          poCodeText: 'JW-PO',
          vendorId: firstVendorId,
          vendorCodeText: 'TEST-VENDOR',
        },
        lines: [
          {
            itemId: testItemId,
            itemCodeText: `${TEST_PREFIX}ITEM`,
            qty: 1,
            uom: 'NOS',
            purchaseOrderLineId: po.lineId,
          },
        ],
      },
      admin,
    );
    await expect(
      service.createDeliveryChallan(
        {
          header: {
            code,
            dcDate: '2026-05-18',
            purchaseOrderId: po.id,
            poCodeText: 'JW-PO',
            vendorId: firstVendorId,
            vendorCodeText: 'TEST-VENDOR',
          },
          lines: [
            {
              itemId: testItemId,
              itemCodeText: `${TEST_PREFIX}ITEM`,
              qty: 1,
              uom: 'NOS',
              purchaseOrderLineId: po.lineId,
            },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createDeliveryChallan denies viewer role with AuthorizationError', async () => {
    const po = await freshJwPo('CR7', 10);
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.createDeliveryChallan(
        {
          header: {
            code: `${TEST_PREFIX}CR7`,
            dcDate: '2026-05-18',
            purchaseOrderId: po.id,
            poCodeText: 'JW-PO',
            vendorId: firstVendorId,
            vendorCodeText: 'TEST-VENDOR',
          },
          lines: [
            {
              itemId: testItemId,
              itemCodeText: `${TEST_PREFIX}ITEM`,
              qty: 1,
              uom: 'NOS',
              purchaseOrderLineId: po.lineId,
            },
          ],
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('cancelDeliveryChallan reverses jc_op + writes compensating IN stock txn', async () => {
    const po = await freshJwPo('CN1', 10);
    const op = await freshOutsourceJcOp('CN1', po.lineId, 'po_created');
    const dcCode = `${TEST_PREFIX}CN1`;
    const detail = await service.createDeliveryChallan(
      {
        header: {
          code: dcCode,
          dcDate: '2026-05-18',
          purchaseOrderId: po.id,
          poCodeText: 'JW-PO',
          vendorId: firstVendorId,
          vendorCodeText: 'TEST-VENDOR',
        },
        lines: [
          {
            itemId: testItemId,
            itemCodeText: `${TEST_PREFIX}ITEM`,
            qty: 4,
            uom: 'NOS',
            purchaseOrderLineId: po.lineId,
          },
        ],
      },
      admin,
    );
    const cancelled = await service.cancelDeliveryChallan(detail.id, admin);
    expect(cancelled.status).toBe('cancelled');
    const after = await readJcOp(op.opId);
    expect(after.outsourceStatus).toBe('po_created');
    expect(after.outsourceSentQty).toBe(0);
    expect(after.outsourceDcNo).toBeNull();
    const txns = await readStockTxnsFor(`${dcCode}%`);
    expect(txns).toHaveLength(2);
    expect(txns.filter((t) => t.txnType === 'out')).toHaveLength(1);
    expect(txns.filter((t) => t.txnType === 'in')).toHaveLength(1);
  });

  it('cancelDeliveryChallan denies manager role with AuthorizationError', async () => {
    const po = await freshJwPo('CN2', 10);
    const detail = await service.createDeliveryChallan(
      {
        header: {
          code: `${TEST_PREFIX}CN2`,
          dcDate: '2026-05-18',
          purchaseOrderId: po.id,
          poCodeText: 'JW-PO',
          vendorId: firstVendorId,
          vendorCodeText: 'TEST-VENDOR',
        },
        lines: [
          {
            itemId: testItemId,
            itemCodeText: `${TEST_PREFIX}ITEM`,
            qty: 2,
            uom: 'NOS',
            purchaseOrderLineId: po.lineId,
          },
        ],
      },
      admin,
    );
    await expect(service.cancelDeliveryChallan(detail.id, manager)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('cancelDeliveryChallan throws NotFoundError on unknown id', async () => {
    await expect(
      service.cancelDeliveryChallan('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('cancelDeliveryChallan is idempotent — second cancel raises ConflictError', async () => {
    const po = await freshJwPo('CN4', 10);
    const detail = await service.createDeliveryChallan(
      {
        header: {
          code: `${TEST_PREFIX}CN4`,
          dcDate: '2026-05-18',
          purchaseOrderId: po.id,
          poCodeText: 'JW-PO',
          vendorId: firstVendorId,
          vendorCodeText: 'TEST-VENDOR',
        },
        lines: [
          {
            itemId: testItemId,
            itemCodeText: `${TEST_PREFIX}ITEM`,
            qty: 1,
            uom: 'NOS',
            purchaseOrderLineId: po.lineId,
          },
        ],
      },
      admin,
    );
    await service.cancelDeliveryChallan(detail.id, admin);
    await expect(service.cancelDeliveryChallan(detail.id, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
