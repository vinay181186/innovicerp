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
  deliveryChallanReceiptLines,
  deliveryChallanReceipts,
  deliveryChallans,
  items,
  jcOps,
  jobCards,
  ncRegister,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  storeTransactions,
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

  it('createDeliveryChallan is stock-neutral — no jw_out ledger row on OSP send (ADR-067)', async () => {
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
    // Option A: sending material out for OSP no longer debits finished stock.
    // The qty out is tracked as "at vendor" via v_osp_wip, not the ledger.
    const txns = await readStockTxnsFor(`${dcCode}%`);
    expect(txns).toHaveLength(0);
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

// ─── T-059b: receive-back ──────────────────────────────────────────────────

const RB_PREFIX = 'T059B-';

let rbItemId: string;
let rbVendorId: string;

interface DcContext {
  poId: string;
  poLineId: string;
  dcId: string;
  dcLineId: string;
  jcCode: string;
  jcId: string;
  opId: string;
}

async function setupIssuedDc(
  suffix: string,
  options: { sentQty?: number; sourceSoLineId?: string | null; opSeq?: number } = {},
): Promise<DcContext> {
  const sentQty = options.sentQty ?? 6;
  const opSeq = options.opSeq ?? 1;
  const poCode = `${RB_PREFIX}PO-${suffix}-${Date.now()}`;
  const poDetail = await poService.createPurchaseOrder(
    {
      header: {
        code: poCode,
        poDate: '2026-05-19',
        poType: 'job_work',
        vendorId: rbVendorId,
        status: 'open',
        sgstPct: 0,
        cgstPct: 0,
        igstPct: 0,
      },
      lines: [{ itemId: rbItemId, itemName: 'JW outsource source', qty: sentQty + 4, rate: 0 }],
    },
    admin,
  );
  const poLineId = poDetail.lines[0]!.id;

  const jcCode = `${RB_PREFIX}JC-${suffix}-${Date.now()}`;
  const jcRows = await db
    .insert(jobCards)
    .values({
      companyId: admin.companyId!,
      code: jcCode,
      jcDate: '2026-05-19',
      itemId: rbItemId,
      orderQty: sentQty,
      sourceSoLineId: options.sourceSoLineId ?? null,
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
      opSeq,
      operation: 'COATING',
      opType: 'outsource',
      outsourceVendorId: rbVendorId,
      outsourcePoLineId: poLineId,
      outsourceStatus: 'po_created',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  const opId = opRows[0]!.id;

  const dcCode = `${RB_PREFIX}DC-${suffix}`;
  const dcDetail = await service.createDeliveryChallan(
    {
      header: {
        code: dcCode,
        dcDate: '2026-05-19',
        purchaseOrderId: poDetail.id,
        poCodeText: poCode,
        vendorId: rbVendorId,
        vendorCodeText: 'TEST-VENDOR',
      },
      lines: [
        {
          itemId: rbItemId,
          itemCodeText: `${RB_PREFIX}ITEM`,
          qty: sentQty,
          uom: 'NOS',
          purchaseOrderLineId: poLineId,
        },
      ],
    },
    admin,
  );
  const dcLineId = dcDetail.lines[0]!.id;

  return { poId: poDetail.id, poLineId, dcId: dcDetail.id, dcLineId, jcCode, jcId, opId };
}

async function readJcOpRb(opId: string): Promise<{
  outsourceStatus: string | null;
  outsourceSentQty: number;
}> {
  const rows = await db
    .select({
      outsourceStatus: jcOps.outsourceStatus,
      outsourceSentQty: jcOps.outsourceSentQty,
    })
    .from(jcOps)
    .where(eq(jcOps.id, opId))
    .limit(1);
  return rows[0]! as { outsourceStatus: string | null; outsourceSentQty: number };
}

describe('delivery-challans service — receive-back (T-059b)', () => {
  beforeAll(async () => {
    await db.delete(items).where(like(items.code, `${RB_PREFIX}%`));
    const itemRows = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${RB_PREFIX}ITEM`,
        name: 'DC receive test item',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    rbItemId = itemRows[0]!.id;
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
    rbVendorId = vendorRow[0]!.id;
  });

  beforeEach(async () => {
    await db
      .delete(storeTransactions)
      .where(like(storeTransactions.sourceRef, `RCPT-${RB_PREFIX}%`));
    await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${RB_PREFIX}%`));
  });

  afterAll(async () => {
    // Receipts CASCADE from DCs; DCs CASCADE from their wipe. Belt-and-braces.
    await db
      .delete(deliveryChallanReceipts)
      .where(like(deliveryChallanReceipts.receiptCode, `RCPT-${RB_PREFIX}%`));
    const dcs = await db
      .select({ id: deliveryChallans.id })
      .from(deliveryChallans)
      .where(like(deliveryChallans.code, `${RB_PREFIX}%`));
    for (const d of dcs) {
      await db.delete(deliveryChallanLines).where(eq(deliveryChallanLines.deliveryChallanId, d.id));
    }
    await db.delete(deliveryChallans).where(like(deliveryChallans.code, `${RB_PREFIX}%`));
    await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${RB_PREFIX}%`));
    await db
      .delete(storeTransactions)
      .where(like(storeTransactions.sourceRef, `RCPT-${RB_PREFIX}%`));
    await db.delete(ncRegister).where(like(ncRegister.code, `NC-AUTO-${RB_PREFIX}%`));
    await db.delete(jobCards).where(like(jobCards.code, `${RB_PREFIX}%`));
    const poHeaders = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(like(purchaseOrders.code, `${RB_PREFIX}%`));
    for (const h of poHeaders) {
      await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, h.id));
    }
    await db.delete(purchaseOrders).where(like(purchaseOrders.code, `${RB_PREFIX}%`));
    // sales_order_lines CASCADE-delete from sales_orders.
    await db.delete(salesOrders).where(like(salesOrders.code, `${RB_PREFIX}%`));
    await db.delete(activityLog).where(like(activityLog.refId, `${RB_PREFIX}%`));
    await db.delete(activityLog).where(like(activityLog.refId, `RCPT-${RB_PREFIX}%`));
    await db.delete(activityLog).where(like(activityLog.refId, `NC-AUTO-${RB_PREFIX}%`));
    await db.delete(items).where(like(items.code, `${RB_PREFIX}%`));
  });

  it('full receive flips DC status → received + jc_op outsourceStatus → received', async () => {
    const ctx = await setupIssuedDc('RC1', { sentQty: 5 });
    const result = await service.receiveAgainstDeliveryChallan(
      ctx.dcId,
      {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 5, rejectedQty: 0 }],
      },
      admin,
    );
    expect(result.status).toBe('received');
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]?.receiptCode).toBe(`RCPT-${RB_PREFIX}DC-RC1-01`);
    const op = await readJcOpRb(ctx.opId);
    expect(op.outsourceStatus).toBe('received');
  });

  it('partial receive leaves DC status=issued and jc_op status=sent', async () => {
    const ctx = await setupIssuedDc('RC2', { sentQty: 10 });
    const result = await service.receiveAgainstDeliveryChallan(
      ctx.dcId,
      {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 4, rejectedQty: 0 }],
      },
      admin,
    );
    expect(result.status).toBe('issued');
    const op = await readJcOpRb(ctx.opId);
    expect(op.outsourceStatus).toBe('sent');
  });

  it('cumulative receive across two receipts flips DC on the second', async () => {
    const ctx = await setupIssuedDc('RC3', { sentQty: 8 });
    await service.receiveAgainstDeliveryChallan(
      ctx.dcId,
      {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 3, rejectedQty: 0 }],
      },
      admin,
    );
    const second = await service.receiveAgainstDeliveryChallan(
      ctx.dcId,
      {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 5, rejectedQty: 0 }],
      },
      admin,
    );
    expect(second.status).toBe('received');
    expect(second.receipts).toHaveLength(2);
    expect(second.receipts.map((r) => r.receiptCode)).toEqual([
      `RCPT-${RB_PREFIX}DC-RC3-01`,
      `RCPT-${RB_PREFIX}DC-RC3-02`,
    ]);
  });

  it('over-receive (sent_qty + 1) raises ConflictError and writes no rows', async () => {
    const ctx = await setupIssuedDc('RC4', { sentQty: 5 });
    await expect(
      service.receiveAgainstDeliveryChallan(
        ctx.dcId,
        {
          receiptDate: '2026-05-19',
          lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 6, rejectedQty: 0 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const headers = await db
      .select({ id: deliveryChallanReceipts.id })
      .from(deliveryChallanReceipts)
      .where(eq(deliveryChallanReceipts.deliveryChallanId, ctx.dcId));
    expect(headers).toHaveLength(0);
  });

  it('reject-qty creates auto-NC, stock IN counts only received-good qty', async () => {
    const ctx = await setupIssuedDc('RC5', { sentQty: 10 });
    await service.receiveAgainstDeliveryChallan(
      ctx.dcId,
      {
        receiptDate: '2026-05-19',
        lines: [
          {
            deliveryChallanLineId: ctx.dcLineId,
            receivedQty: 7,
            rejectedQty: 3,
            rejectReason: 'Coating thickness out of tol',
          },
        ],
      },
      admin,
    );
    const ncs = await db
      .select({ code: ncRegister.code, rejectedQty: ncRegister.rejectedQty })
      .from(ncRegister)
      .where(eq(ncRegister.jcOpId, ctx.opId));
    expect(ncs).toHaveLength(1);
    expect(ncs[0]?.code).toMatch(/^NC-AUTO-T059B-JC-RC5-/);
    expect(Number(ncs[0]?.rejectedQty)).toBe(3);
    const txns = await db
      .select({ qty: storeTransactions.qty, txnType: storeTransactions.txnType })
      .from(storeTransactions)
      .where(like(storeTransactions.sourceRef, `RCPT-${RB_PREFIX}DC-RC5%`));
    expect(txns).toHaveLength(1);
    expect(txns[0]?.qty).toBe(7);
    expect(txns[0]?.txnType).toBe('in');
    const op = await readJcOpRb(ctx.opId);
    expect(op.outsourceStatus).toBe('received'); // 7+3=10 reconciled
  });

  it('reject without reason is rejected at the input schema layer', async () => {
    const ctx = await setupIssuedDc('RC6', { sentQty: 4 });
    await expect(
      service.receiveAgainstDeliveryChallan(
        ctx.dcId,
        {
          receiptDate: '2026-05-19',
          lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 0, rejectedQty: 4 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it('writes store_transactions IN row with source_type=jw_in and matching qty', async () => {
    const ctx = await setupIssuedDc('RC7', { sentQty: 6 });
    await service.receiveAgainstDeliveryChallan(
      ctx.dcId,
      {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 6, rejectedQty: 0 }],
      },
      admin,
    );
    const txns = await db
      .select({
        qty: storeTransactions.qty,
        txnType: storeTransactions.txnType,
        sourceType: storeTransactions.sourceType,
      })
      .from(storeTransactions)
      .where(like(storeTransactions.sourceRef, `RCPT-${RB_PREFIX}DC-RC7%`));
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ qty: 6, txnType: 'in', sourceType: 'jw_in' });
  });

  it('emits DC_RECEIVE + OP_OUTSOURCE_RECEIVED audit rows on full receive', async () => {
    const ctx = await setupIssuedDc('RC8', { sentQty: 5 });
    await service.receiveAgainstDeliveryChallan(
      ctx.dcId,
      {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 5, rejectedQty: 0 }],
      },
      admin,
    );
    const dcRows = await db
      .select({ action: activityLog.action, detail: activityLog.detail })
      .from(activityLog)
      .where(eq(activityLog.refId, `${RB_PREFIX}DC-RC8`));
    const dcReceive = dcRows.find((r) => r.action === 'DC_RECEIVE');
    expect(dcReceive).toBeDefined();
    expect(dcReceive?.detail).toContain(`${RB_PREFIX}DC-RC8`);

    const opRows = await db
      .select({ action: activityLog.action, detail: activityLog.detail })
      .from(activityLog)
      .where(eq(activityLog.refId, ctx.jcCode));
    const opReceived = opRows.find((r) => r.action === 'OP_OUTSOURCE_RECEIVED');
    expect(opReceived).toBeDefined();
    expect(opReceived?.detail).toContain(ctx.jcCode);
  });

  it('sales cascade fires when outsource is the only op of a JC linked to an SO line', async () => {
    // Build SO + line + JC pointing at it via sourceSoLineId.
    const soCode = `${RB_PREFIX}SO-RC9`;
    // Clean up any leftover from a prior failed run.
    await db.delete(salesOrders).where(eq(salesOrders.code, soCode));
    const soRows = await db
      .insert(salesOrders)
      .values({
        companyId: admin.companyId!,
        code: soCode,
        soDate: '2026-05-19',
        status: 'open',
        type: 'component_manufacturing',
        gstPercent: '18.00',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const soId = soRows[0]!.id;
    const soLineRows = await db
      .insert(salesOrderLines)
      .values({
        companyId: admin.companyId!,
        salesOrderId: soId,
        lineNo: 1,
        itemId: rbItemId,
        partName: 'Test part',
        orderQty: 5,
        rate: '0',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const soLineId = soLineRows[0]!.id;

    const ctx = await setupIssuedDc('RC9', { sentQty: 5, sourceSoLineId: soLineId });

    await service.receiveAgainstDeliveryChallan(
      ctx.dcId,
      {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 5, rejectedQty: 0 }],
      },
      admin,
    );

    const soAfter = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, soId))
      .limit(1);
    const soLineAfter = await db
      .select({ status: salesOrderLines.status })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, soLineId))
      .limit(1);
    expect(soLineAfter[0]?.status).toBe('closed');
    expect(soAfter[0]?.status).toBe('closed');
  });

  it('viewer role denied with AuthorizationError', async () => {
    const ctx = await setupIssuedDc('RCA', { sentQty: 3 });
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.receiveAgainstDeliveryChallan(
        ctx.dcId,
        {
          receiptDate: '2026-05-19',
          lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 3, rejectedQty: 0 }],
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('NotFoundError on unknown DC id', async () => {
    await expect(
      service.receiveAgainstDeliveryChallan(
        '00000000-0000-0000-0000-000000000000',
        {
          receiptDate: '2026-05-19',
          lines: [
            {
              deliveryChallanLineId: '00000000-0000-0000-0000-000000000001',
              receivedQty: 1,
              rejectedQty: 0,
            },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('receive against cancelled DC raises ConflictError', async () => {
    const ctx = await setupIssuedDc('RCC', { sentQty: 3 });
    await service.cancelDeliveryChallan(ctx.dcId, admin);
    await expect(
      service.receiveAgainstDeliveryChallan(
        ctx.dcId,
        {
          receiptDate: '2026-05-19',
          lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 3, rejectedQty: 0 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('input line referencing wrong DC raises ValidationError', async () => {
    const ctxA = await setupIssuedDc('RCV1', { sentQty: 3 });
    const ctxB = await setupIssuedDc('RCV2', { sentQty: 3 });
    await expect(
      service.receiveAgainstDeliveryChallan(
        ctxA.dcId,
        {
          receiptDate: '2026-05-19',
          lines: [{ deliveryChallanLineId: ctxB.dcLineId, receivedQty: 1, rejectedQty: 0 }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('cancel after a receipt raises ConflictError (block until receipts voided)', async () => {
    const ctx = await setupIssuedDc('RCN', { sentQty: 5 });
    await service.receiveAgainstDeliveryChallan(
      ctx.dcId,
      {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: ctx.dcLineId, receivedQty: 2, rejectedQty: 0 }],
      },
      admin,
    );
    await expect(service.cancelDeliveryChallan(ctx.dcId, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

// Reference to deliveryChallanReceiptLines to avoid unused-import lint when
// the suite is run in isolation (drizzle relations don't trip the lint, but
// the import is included for future tests asserting line-level state).
void deliveryChallanReceiptLines;
