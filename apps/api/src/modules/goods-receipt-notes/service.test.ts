import { and, asc, eq, isNull, like, notLike, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
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
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import * as poService from '../purchase-orders/service';
import * as service from './service';

const TEST_PREFIX = 'T036C-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;
let firstVendorId: string;

async function freshPo(
  suffix: string,
  qty = 10,
): Promise<{ id: string; lineId: string; itemId: string }> {
  const code = `${TEST_PREFIX}PO-${suffix}-${Date.now()}`;
  const detail = await poService.createPurchaseOrder(
    {
      header: {
        code,
        poDate: '2026-05-03',
        poType: 'standard',
        vendorId: firstVendorId,
        status: 'open', // bypass draft so the auto-close ladder applies
        sgstPct: 0,
        cgstPct: 0,
        igstPct: 0,
      },
      lines: [{ itemId: firstItemId, itemName: 'GRN Source', qty, rate: 0 }],
    },
    admin,
  );
  return { id: detail.id, lineId: detail.lines[0]!.id, itemId: firstItemId };
}

async function readPoStatus(id: string): Promise<string> {
  const r = await db
    .select({ status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  return r[0]!.status;
}

async function readPoLineReceived(id: string): Promise<number> {
  const r = await db
    .select({ rq: purchaseOrderLines.receivedQty })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.id, id))
    .limit(1);
  return r[0]!.rq;
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

beforeEach(async () => {
  // Clear test-prefixed store_transactions sourced from this suite's GRNs so
  // stock_before/after asserts are deterministic across runs. Match by
  // source_ref which contains the test-prefixed GRN code.
  await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${TEST_PREFIX}%`));
});

afterAll(async () => {
  // Hard cleanup — lines first.
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
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
});

describe('goods-receipt-notes service', () => {
  it('createGoodsReceiptNote inserts header + lines and recalculates PO line received_qty', async () => {
    const po = await freshPo('A1', 10);
    const grnCode = `${TEST_PREFIX}A1`;
    const detail = await service.createGoodsReceiptNote(
      {
        header: {
          code: grnCode,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
        },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'Receiving',
            receivedQty: 4,
            qcStatus: 'pending',
            qcAcceptedQty: 0,
            qcRejectedQty: 0,
          },
        ],
      },
      admin,
    );
    expect(detail.code).toBe(grnCode);
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]?.receivedQty).toBe(4);
    expect(await readPoLineReceived(po.lineId)).toBe(4);
    // Status went open → partial (4 of 10 received, QC still pending so not closed).
    expect(await readPoStatus(po.id)).toBe('partial');
  });

  it('PO header flips to qc_pending when fully received but QC still pending, then closed on QC accept', async () => {
    const po = await freshPo('A2', 10);
    // GRN 1 — receive everything but leave QC pending.
    await service.createGoodsReceiptNote(
      {
        header: {
          code: `${TEST_PREFIX}A2-G1`,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
        },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 10,
            qcStatus: 'pending',
            qcAcceptedQty: 0,
            qcRejectedQty: 0,
          },
        ],
      },
      admin,
    );
    expect(await readPoStatus(po.id)).toBe('qc_pending');

    // Edit the GRN line to mark QC completed → PO header should flip to closed.
    const grns = await db
      .select()
      .from(goodsReceiptNotes)
      .where(eq(goodsReceiptNotes.code, `${TEST_PREFIX}A2-G1`))
      .limit(1);
    const grnId = grns[0]!.id;
    const lineRows = await db
      .select()
      .from(goodsReceiptNoteLines)
      .where(eq(goodsReceiptNoteLines.goodsReceiptNoteId, grnId))
      .limit(1);
    const lineId = lineRows[0]!.id;

    await service.updateGoodsReceiptNote(
      grnId,
      {
        header: {},
        lines: [
          {
            id: lineId,
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 10,
            qcStatus: 'completed',
            qcAcceptedQty: 10,
            qcRejectedQty: 0,
            qcDate: '2026-05-03',
          },
        ],
      },
      admin,
    );
    expect(await readPoStatus(po.id)).toBe('closed');
  });

  it('writes a store_transactions ledger row on QC accept with stock_before/after computed from v_item_stock', async () => {
    const po = await freshPo('A3', 5);
    // Read current on-hand baseline for this item (test runs share one item).
    const baselineRows = (await db.execute(sql`
      SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
      FROM public.v_item_stock
      WHERE company_id = ${admin.companyId}::uuid AND item_id = ${firstItemId}::uuid
    `)) as unknown as Array<{ on_hand: number }>;
    const baseline = Number(baselineRows[0]?.on_hand ?? 0);

    const grnCode = `${TEST_PREFIX}A3`;
    await service.createGoodsReceiptNote(
      {
        header: {
          code: grnCode,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
        },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 5,
            qcStatus: 'completed',
            qcAcceptedQty: 5,
            qcRejectedQty: 0,
            qcDate: '2026-05-03',
          },
        ],
      },
      admin,
    );

    const txn = await db
      .select()
      .from(storeTransactions)
      .where(like(storeTransactions.sourceRef, `${grnCode}%`))
      .limit(1);
    expect(txn).toHaveLength(1);
    expect(txn[0]?.txnType).toBe('in');
    expect(txn[0]?.sourceType).toBe('grn_qc');
    expect(txn[0]?.qty).toBe(5);
    expect(txn[0]?.stockBefore).toBe(baseline);
    expect(txn[0]?.stockAfter).toBe(baseline + 5);
  });

  it('writes NO store_transactions row when QC accept qty is zero (rejected everything)', async () => {
    const po = await freshPo('A4', 3);
    const grnCode = `${TEST_PREFIX}A4`;
    await service.createGoodsReceiptNote(
      {
        header: {
          code: grnCode,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
        },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 3,
            qcStatus: 'completed',
            qcAcceptedQty: 0,
            qcRejectedQty: 3,
            qcDate: '2026-05-03',
          },
        ],
      },
      admin,
    );
    const txn = await db
      .select()
      .from(storeTransactions)
      .where(like(storeTransactions.sourceRef, `${grnCode}%`));
    expect(txn).toHaveLength(0);
    // PO still flips to closed (rejection counts as QC complete from header POV).
    expect(await readPoStatus(po.id)).toBe('closed');
  });

  it('rejects QC field changes on a line that is already QC-completed (ConflictError)', async () => {
    const po = await freshPo('A5', 5);
    const grnCode = `${TEST_PREFIX}A5`;
    const detail = await service.createGoodsReceiptNote(
      {
        header: {
          code: grnCode,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
        },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 5,
            qcStatus: 'completed',
            qcAcceptedQty: 5,
            qcRejectedQty: 0,
            qcDate: '2026-05-03',
          },
        ],
      },
      admin,
    );
    const lineId = detail.lines[0]!.id;
    await expect(
      service.updateGoodsReceiptNote(
        detail.id,
        {
          header: {},
          lines: [
            {
              id: lineId,
              purchaseOrderLineId: po.lineId,
              itemId: firstItemId,
              itemName: 'X',
              receivedQty: 5,
              qcStatus: 'completed',
              qcAcceptedQty: 4, // changed!
              qcRejectedQty: 1,
            },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('blocks softDelete when any line is QC-completed (ConflictError)', async () => {
    const po = await freshPo('A6', 5);
    const detail = await service.createGoodsReceiptNote(
      {
        header: {
          code: `${TEST_PREFIX}A6`,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
        },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 5,
            qcStatus: 'completed',
            qcAcceptedQty: 5,
            qcRejectedQty: 0,
            qcDate: '2026-05-03',
          },
        ],
      },
      admin,
    );
    await expect(service.softDeleteGoodsReceiptNote(detail.id, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('softDelete on a pending GRN reverses received_qty + flips PO header back to open', async () => {
    const po = await freshPo('A7', 8);
    const detail = await service.createGoodsReceiptNote(
      {
        header: {
          code: `${TEST_PREFIX}A7`,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
        },
        lines: [
          {
            purchaseOrderLineId: po.lineId,
            itemId: firstItemId,
            itemName: 'X',
            receivedQty: 4,
            qcStatus: 'pending',
            qcAcceptedQty: 0,
            qcRejectedQty: 0,
          },
        ],
      },
      admin,
    );
    expect(await readPoLineReceived(po.lineId)).toBe(4);
    expect(await readPoStatus(po.id)).toBe('partial');

    await service.softDeleteGoodsReceiptNote(detail.id, admin);
    expect(await readPoLineReceived(po.lineId)).toBe(0);
    expect(await readPoStatus(po.id)).toBe('open');
  });

  it('listGoodsReceiptNotes returns aggregates + applies search/qcStatus filters', async () => {
    const po = await freshPo('A8', 2);
    const grnCode = `${TEST_PREFIX}A8`;
    await service.createGoodsReceiptNote(
      {
        header: {
          code: grnCode,
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
            qcStatus: 'pending',
            qcAcceptedQty: 0,
            qcRejectedQty: 0,
          },
        ],
      },
      admin,
    );
    const result = await service.listGoodsReceiptNotes(
      { search: `${TEST_PREFIX}A8`, qcStatus: 'pending', limit: 50, offset: 0 },
      admin,
    );
    const found = result.items.find((g) => g.code === grnCode);
    expect(found?.lineCount).toBe(1);
    expect(found?.totalReceivedQty).toBe(2);
    expect(found?.qcPendingCount).toBe(1);
    expect(found?.poCode).toBeTruthy();
    expect(found?.vendorName).toBeTruthy();
  });

  it('NotFoundError on get of unknown id; AuthorizationError when no company', async () => {
    await expect(
      service.getGoodsReceiptNote('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.createGoodsReceiptNote(
        {
          header: { code: `${TEST_PREFIX}NOC`, grnDate: '2026-05-03' },
          lines: [
            {
              itemId: firstItemId,
              itemName: 'X',
              receivedQty: 1,
              qcStatus: 'pending',
              qcAcceptedQty: 0,
              qcRejectedQty: 0,
            },
          ],
        },
        { ...admin, companyId: null },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('emits CREATE / EDIT / DELETE activity_log rows atomic with the mutation', async () => {
    const po = await freshPo('AUD', 5);
    const grnCode = `${TEST_PREFIX}AUD`;
    const created = await service.createGoodsReceiptNote(
      {
        header: {
          code: grnCode,
          grnDate: '2026-05-03',
          purchaseOrderId: po.id,
          vendorId: firstVendorId,
          vendorCodeText: 'AUDIT-VEN',
        },
        lines: [
          {
            itemId: firstItemId,
            itemName: 'Audit Item',
            receivedQty: 2,
            purchaseOrderLineId: po.lineId,
            qcStatus: 'pending',
            qcAcceptedQty: 0,
            qcRejectedQty: 0,
          },
        ],
      },
      admin,
    );
    await service.updateGoodsReceiptNote(created.id, { header: { dcNo: 'DC-99' } }, admin);
    await service.softDeleteGoodsReceiptNote(created.id, admin);

    const auditRows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, admin.companyId!), eq(activityLog.refId, grnCode)));
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(['CREATE', 'DELETE', 'EDIT']);
    for (const r of auditRows) {
      expect(r.entity).toBe('GoodsReceiptNote');
      expect(r.userId).toBe(admin.id);
      expect(r.userName).toBe(admin.email);
      expect(r.detail).toContain(grnCode);
    }
  });
});
