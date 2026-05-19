import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  deliveryChallanLines,
  deliveryChallanReceipts,
  deliveryChallans,
  items,
  jcOps,
  jobCards,
  ncRegister,
  purchaseOrderLines,
  purchaseOrders,
  storeTransactions,
  users,
  vendors,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import * as poService from '../purchase-orders/service';
import { deliveryChallansRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'T059AR-';
let admin: AuthContext;
let firstVendorId: string;
let testItemId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(deliveryChallansRoutes);
  return app;
}

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
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  const itemRows = await db
    .insert(items)
    .values({
      companyId: u.companyId,
      code: `${TEST_PREFIX}ITEM`,
      name: 'DC routes test item',
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
  await db
    .delete(deliveryChallanReceipts)
    .where(like(deliveryChallanReceipts.receiptCode, `RCPT-${TEST_PREFIX}%`));
  const dcs = await db
    .select({ id: deliveryChallans.id })
    .from(deliveryChallans)
    .where(like(deliveryChallans.code, `${TEST_PREFIX}%`));
  for (const d of dcs) {
    await db.delete(deliveryChallanLines).where(eq(deliveryChallanLines.deliveryChallanId, d.id));
  }
  await db.delete(deliveryChallans).where(like(deliveryChallans.code, `${TEST_PREFIX}%`));
  await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${TEST_PREFIX}%`));
  await db
    .delete(storeTransactions)
    .where(like(storeTransactions.sourceRef, `RCPT-${TEST_PREFIX}%`));
  await db.delete(ncRegister).where(like(ncRegister.code, `NC-AUTO-${TEST_PREFIX}%`));
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
  await db.delete(activityLog).where(like(activityLog.refId, `RCPT-${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
});

async function freshJwPo(suffix: string): Promise<{ id: string; lineId: string }> {
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
      lines: [{ itemId: testItemId, itemName: 'X', qty: 5, rate: 0 }],
    },
    admin,
  );
  return { id: detail.id, lineId: detail.lines[0]!.id };
}

describe('delivery-challans routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /delivery-challans returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/delivery-challans' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /delivery-challans returns 200 + viewer role works (read-only)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({ method: 'GET', url: '/delivery-challans?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /delivery-challans/:id returns 404 for unknown id', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: '/delivery-challans/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /delivery-challans returns 201 + detail body', async () => {
    const po = await freshJwPo('PR1');
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/delivery-challans',
      payload: {
        header: {
          code: `${TEST_PREFIX}PR1`,
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
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe(`${TEST_PREFIX}PR1`);
    expect(body.status).toBe('issued');
    expect(body.lines).toHaveLength(1);
  });

  it('POST /delivery-challans/:id/cancel flips status to cancelled and returns detail', async () => {
    const po = await freshJwPo('PR2');
    app = await buildApp(admin);
    const createRes = await app.inject({
      method: 'POST',
      url: '/delivery-challans',
      payload: {
        header: {
          code: `${TEST_PREFIX}PR2`,
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
    });
    const dcId = createRes.json().id;
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/delivery-challans/${dcId}/cancel`,
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe('cancelled');
  });

  it('POST /delivery-challans returns 403 when viewer attempts to create', async () => {
    const po = await freshJwPo('PR3');
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: '/delivery-challans',
      payload: {
        header: {
          code: `${TEST_PREFIX}PR3`,
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
    });
    expect(res.statusCode).toBe(403);
  });

  // T-059b — receive-back endpoint surface tests.

  async function createIssuedDcViaRoute(
    suffix: string,
  ): Promise<{ id: string; lineId: string; opId: string }> {
    const po = await freshJwPo(suffix);

    // Build a JC + outsource op so the receive cascade has something to flip.
    const jcCode = `${TEST_PREFIX}JC-${suffix}-${Date.now()}`;
    const jcRows = await db
      .insert(jobCards)
      .values({
        companyId: admin.companyId!,
        code: jcCode,
        jcDate: '2026-05-19',
        itemId: testItemId,
        orderQty: 4,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const opRows = await db
      .insert(jcOps)
      .values({
        companyId: admin.companyId!,
        jobCardId: jcRows[0]!.id,
        opSeq: 1,
        operation: 'COATING',
        opType: 'outsource',
        outsourcePoLineId: po.lineId,
        outsourceStatus: 'po_created',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();

    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/delivery-challans',
      payload: {
        header: {
          code: `${TEST_PREFIX}DC-${suffix}`,
          dcDate: '2026-05-19',
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
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    return { id: body.id, lineId: body.lines[0].id, opId: opRows[0]!.id };
  }

  it('POST /delivery-challans/:id/receive returns 201 with detail + receipt', async () => {
    const dc = await createIssuedDcViaRoute('RCV1');
    const res = await app.inject({
      method: 'POST',
      url: `/delivery-challans/${dc.id}/receive`,
      payload: {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: dc.lineId, receivedQty: 4, rejectedQty: 0 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('received');
    expect(body.receipts).toHaveLength(1);
    expect(body.receipts[0].receiptCode).toBe(`RCPT-${TEST_PREFIX}DC-RCV1-01`);
  });

  it('POST /delivery-challans/:id/receive returns 403 for viewer', async () => {
    const dc = await createIssuedDcViaRoute('RCV2');
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await app.close();
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: `/delivery-challans/${dc.id}/receive`,
      payload: {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: dc.lineId, receivedQty: 1, rejectedQty: 0 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /delivery-challans/:id/receive returns 400 when reject without reason', async () => {
    const dc = await createIssuedDcViaRoute('RCV3');
    const res = await app.inject({
      method: 'POST',
      url: `/delivery-challans/${dc.id}/receive`,
      payload: {
        receiptDate: '2026-05-19',
        lines: [{ deliveryChallanLineId: dc.lineId, receivedQty: 0, rejectedQty: 2 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
