// ADR-235 — the standard Cancel, end to end on a Customer Dispatch (the Phase A
// document that moves stock): request → pending (document untouched, edits
// refused) → approve runs the dispatch's own cancel worker in one transaction
// (stock back, SO dispatched qty reopened, reason on the row). Two requests or
// two approvals at the same instant leave exactly one effect (§20.2 / §20.3).
// A dispatch already invoiced is blocked and names the invoice.

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  bomMasterLines,
  bomMasters,
  cancelRequests,
  customerDispatchLines,
  customerDispatches,
  invoiceLines,
  invoices,
  itemStockBalances,
  items,
  salesOrderLines,
  salesOrders,
  storeTransactions,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { createDispatch, updateCustomerDispatch } from '../customer-dispatches/service';
import { createInvoice } from '../invoices/service';
import { decideCancelRequest, getCancelPreview, requestCancel } from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
// Unique per run: ledger rows (and so their items) can never be deleted (ADR-185).
const P = `TCNR${Date.now().toString(36).slice(-5).toUpperCase()}-`;

let admin: AuthContext;
const itemIds: string[] = [];
const soIds: string[] = [];

async function makeFixture(tag: string, orderQty: number, stock: number) {
  const mk = async (code: string) => {
    const r = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${P}${code}`,
        name: `${P}${code}`,
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    itemIds.push(r[0]!.id);
    return r[0]!.id;
  };
  const parentId = await mk(`PEN-${tag}`);
  const compId = await mk(`C-${tag}`);
  const bom = await db
    .insert(bomMasters)
    .values({
      companyId: admin.companyId!,
      bomNo: `${P}${tag}`,
      bomName: `cancel ${tag}`,
      parentItemId: parentId,
      status: 'active',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  await db.insert(bomMasterLines).values({
    companyId: admin.companyId!,
    bomMasterId: bom[0]!.id,
    lineNo: 1,
    childItemId: compId,
    qtyPerSet: '1.00',
    bomType: 'manufacture',
    createdBy: admin.id,
    updatedBy: admin.id,
  });
  const so = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${P}SO-${tag}`,
      soDate: '2026-08-01',
      status: 'open',
      type: 'component_manufacturing',
      gstPercent: '18.00',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soIds.push(so[0]!.id);
  const line = await db
    .insert(salesOrderLines)
    .values({
      companyId: admin.companyId!,
      salesOrderId: so[0]!.id,
      lineNo: 1,
      itemId: parentId,
      partName: 'PEN-TCNR',
      orderQty,
      rate: '100',
      status: 'open',
      sourceBomMasterId: bom[0]!.id,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  await db.insert(storeTransactions).values({
    companyId: admin.companyId!,
    txnDate: '2026-08-02',
    itemId: parentId,
    txnType: 'in',
    qty: stock,
    sourceType: 'assembly',
    sourceRef: `${P}seed`,
    stockBefore: 0,
    stockAfter: stock,
    remarks: 'test seed',
    createdBy: admin.id,
  });
  return { soId: so[0]!.id, soLineId: line[0]!.id, parentId };
}

async function onHand(itemId: string): Promise<number> {
  const r = await db
    .select({ q: itemStockBalances.onHandQty })
    .from(itemStockBalances)
    .where(eq(itemStockBalances.itemId, itemId));
  return Number(r[0]?.q ?? 0);
}

async function dispatchedQty(soLineId: string): Promise<number> {
  const r = await db
    .select({ q: salesOrderLines.dispatchedQty })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.id, soLineId));
  return Number(r[0]?.q ?? 0);
}

async function dispatchOf(tag: string, qty: number, stock = 10) {
  const f = await makeFixture(tag, 10, stock);
  const d = await createDispatch(
    {
      salesOrderId: f.soId,
      dispatchDate: '2026-08-03',
      lines: [{ salesOrderLineId: f.soLineId, qty }],
    },
    admin,
  );
  return { ...f, dispatchId: d.id };
}

async function cleanup(): Promise<void> {
  if (soIds.length > 0) {
    const invs = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(inArray(invoices.salesOrderId, soIds));
    if (invs.length > 0) {
      const ids = invs.map((i) => i.id);
      await db.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, ids));
      await db.delete(invoices).where(inArray(invoices.id, ids));
    }
  }
  const ds = await db
    .select({ id: customerDispatches.id })
    .from(customerDispatches)
    .where(like(customerDispatches.soCodeText, `${P}%`));
  if (ds.length > 0) {
    const ids = ds.map((d) => d.id);
    await db.delete(cancelRequests).where(inArray(cancelRequests.docId, ids));
    await db
      .delete(customerDispatchLines)
      .where(inArray(customerDispatchLines.customerDispatchId, ids));
    await db.delete(customerDispatches).where(inArray(customerDispatches.id, ids));
  }
  // Ledger rows (and so the items) stay: the ledger refuses DELETE (ADR-185);
  // the harness global setup sweeps test-prefixed data.
  await db.delete(salesOrderLines).where(like(salesOrderLines.partName, 'PEN-TCNR'));
  await db.delete(salesOrders).where(like(salesOrders.code, `${P}%`));
  const boms = await db
    .select({ id: bomMasters.id })
    .from(bomMasters)
    .where(like(bomMasters.bomNo, `${P}%`));
  if (boms.length > 0) {
    await db.delete(bomMasterLines).where(
      inArray(
        bomMasterLines.bomMasterId,
        boms.map((b) => b.id),
      ),
    );
  }
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${P}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

afterAll(async () => {
  await cleanup().catch(() => undefined);
});

describe('ADR-235 cancel request — Customer Dispatch', () => {
  it('request leaves the dispatch live and locks edits; approve reverses stock once', async () => {
    const { dispatchId, parentId, soLineId } = await dispatchOf('A', 4);
    expect(await onHand(parentId)).toBe(6);
    expect(await dispatchedQty(soLineId)).toBe(4);

    const pv = await getCancelPreview('customer_dispatch', dispatchId, admin);
    expect(pv.blockers).toEqual([]);
    expect(pv.effects.some((e) => e.kind === 'stock' && e.qty === 4)).toBe(true);

    const r = await requestCancel(
      'customer_dispatch',
      dispatchId,
      { reason: 'wrong customer', approveNow: false },
      admin,
    );
    expect(r.cancelled).toBe(false);
    expect(r.request.status).toBe('pending');
    expect(await onHand(parentId)).toBe(6);

    // A second request while one is pending is refused.
    await expect(
      requestCancel('customer_dispatch', dispatchId, { reason: 'again', approveNow: false }, admin),
    ).rejects.toThrow(/already pending/);
    // Editing a document with a pending cancel is refused.
    await expect(updateCustomerDispatch(dispatchId, {} as never, admin)).rejects.toThrow(
      /cancel request pending/,
    );

    // Two approvals at the same instant: exactly one wins.
    const results = await Promise.allSettled([
      decideCancelRequest(r.request.id, { decision: 'approve' }, admin),
      decideCancelRequest(r.request.id, { decision: 'approve' }, admin),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);

    expect(await onHand(parentId)).toBe(10);
    expect(await dispatchedQty(soLineId)).toBe(0);
    const row = (
      await db.select().from(customerDispatches).where(eq(customerDispatches.id, dispatchId))
    )[0]!;
    expect(row.status).toBe('cancelled');
    expect(row.cancelReason).toBe('wrong customer');
    expect(row.cancelledAt).not.toBeNull();
    // Exactly one reversing "in" entry for this dispatch.
    const ins = (
      await db.select().from(storeTransactions).where(eq(storeTransactions.itemId, parentId))
    ).filter((t) => t.sourceType === 'dispatch' && t.txnType === 'in');
    expect(ins).toHaveLength(1);
  });

  it('two requests at the same instant leave one pending row', async () => {
    const { dispatchId } = await dispatchOf('B', 2);
    const results = await Promise.allSettled([
      requestCancel('customer_dispatch', dispatchId, { reason: 'x1', approveNow: false }, admin),
      requestCancel('customer_dispatch', dispatchId, { reason: 'x2', approveNow: false }, admin),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rows = await db.select().from(cancelRequests).where(eq(cancelRequests.docId, dispatchId));
    expect(rows.filter((x) => x.status === 'pending')).toHaveLength(1);
  });

  it('reject needs a note and leaves the dispatch live', async () => {
    const { dispatchId, parentId } = await dispatchOf('C', 3);
    const r = await requestCancel(
      'customer_dispatch',
      dispatchId,
      { reason: 'test', approveNow: false },
      admin,
    );
    const d = await decideCancelRequest(
      r.request.id,
      { decision: 'reject', note: 'not a mistake' },
      admin,
    );
    expect(d.request.status).toBe('rejected');
    expect(d.cancelled).toBe(false);
    expect(await onHand(parentId)).toBe(7);
    const row = (
      await db.select().from(customerDispatches).where(eq(customerDispatches.id, dispatchId))
    )[0]!;
    expect(row.status).toBe('dispatched');
  });

  it('approveNow cancels at once for an Approve-tick holder', async () => {
    const { dispatchId, parentId } = await dispatchOf('D', 5);
    const r = await requestCancel(
      'customer_dispatch',
      dispatchId,
      { reason: 'duplicate entry', approveNow: true },
      admin,
    );
    expect(r.cancelled).toBe(true);
    expect(r.request.status).toBe('approved');
    expect(await onHand(parentId)).toBe(10);
  });

  it('an invoiced dispatch is blocked and names the invoice', async () => {
    const { dispatchId, soId, soLineId } = await dispatchOf('E', 4);
    const inv = await createInvoice(
      {
        salesOrderId: soId,
        invoiceDate: '2026-08-04',
        lines: [{ salesOrderLineId: soLineId, qty: 4, rate: 100 }],
      },
      admin,
    );
    const pv = await getCancelPreview('customer_dispatch', dispatchId, admin);
    expect(pv.blockers.length).toBeGreaterThan(0);
    expect(pv.blockers[0]!.docNo).toBe(inv.code);
    await expect(
      requestCancel('customer_dispatch', dispatchId, { reason: 'x', approveNow: false }, admin),
    ).rejects.toThrow(/can't be cancelled yet/);

    // The invoice itself can be cancelled (no payment), then the dispatch.
    const ri = await requestCancel(
      'invoice',
      inv.id,
      { reason: 'test chain', approveNow: true },
      admin,
    );
    expect(ri.cancelled).toBe(true);
    const pv2 = await getCancelPreview('customer_dispatch', dispatchId, admin);
    expect(pv2.blockers).toEqual([]);
  });
});
