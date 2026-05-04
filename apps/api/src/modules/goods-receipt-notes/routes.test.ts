import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  goodsReceiptNoteLines,
  goodsReceiptNotes,
  items,
  purchaseOrderLines,
  purchaseOrders,
  storeTransactions,
  users,
  vendors,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import * as poService from '../purchase-orders/service';
import { goodsReceiptNotesRoutes } from './routes';

const TEST_PREFIX = 'T036CR-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;
let firstVendorId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(goodsReceiptNotesRoutes);
  return app;
}

async function freshPo(suffix: string): Promise<{ id: string; lineId: string }> {
  const code = `${TEST_PREFIX}PO-${suffix}-${Date.now()}`;
  const detail = await poService.createPurchaseOrder(
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
      lines: [{ itemId: firstItemId, itemName: 'X', qty: 5, rate: 0 }],
    },
    admin,
  );
  return { id: detail.id, lineId: detail.lines[0]!.id };
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
  const grnHeaders = await db
    .select({ id: goodsReceiptNotes.id })
    .from(goodsReceiptNotes)
    .where(like(goodsReceiptNotes.code, `${TEST_PREFIX}%`));
  for (const h of grnHeaders) {
    await db
      .delete(goodsReceiptNoteLines)
      .where(eq(goodsReceiptNoteLines.goodsReceiptNoteId, h.id));
  }
  await db.delete(goodsReceiptNotes).where(like(goodsReceiptNotes.code, `${TEST_PREFIX}%`));
  await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${TEST_PREFIX}%`));

  const poHeaders = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
  for (const h of poHeaders) {
    await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, h.id));
  }
  await db.delete(purchaseOrders).where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
});

describe('goods-receipt-notes routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /goods-receipt-notes returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/goods-receipt-notes' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /goods-receipt-notes returns 200 with auth', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/goods-receipt-notes?limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('items');
  });

  it('POST /goods-receipt-notes returns 201 on valid input', async () => {
    const po = await freshPo('R1');
    app = await buildApp(admin);
    const code = `${TEST_PREFIX}R1`;
    const res = await app.inject({
      method: 'POST',
      url: '/goods-receipt-notes',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: { code, grnDate: '2026-05-03', purchaseOrderId: po.id, vendorId: firstVendorId },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 2,
            qcStatus: 'pending',
            qcAcceptedQty: 0,
            qcRejectedQty: 0,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe(code);
  });

  it('POST /goods-receipt-notes returns 400 when qc_accepted + qc_rejected exceeds received', async () => {
    const po = await freshPo('R2');
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/goods-receipt-notes',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: {
          code: `${TEST_PREFIX}R2`,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
        },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 2,
            qcStatus: 'completed',
            qcAcceptedQty: 5, // accepted+rejected (5+0) > received (2)
            qcRejectedQty: 0,
            qcDate: '2026-05-03',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('POST /goods-receipt-notes returns clean 403 for viewer role', async () => {
    const po = await freshPo('R3');
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: '/goods-receipt-notes',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: {
          code: `${TEST_PREFIX}R3`,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
        },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 1,
            qcStatus: 'pending',
            qcAcceptedQty: 0,
            qcRejectedQty: 0,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'forbidden' });
  });
});
