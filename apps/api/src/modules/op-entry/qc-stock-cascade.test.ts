// ADR-105 — the final-QC stock credit must NOT fire for a JWSO Job Card.
//
// A JWSO job card makes the CUSTOMER's goods from the CUSTOMER's material. They
// leave on a JW Return Challan, so crediting own stock counted the customer's
// pieces as inventory — and nothing ever removed them again (the return challan
// writes no ledger row, and the party material issue deliberately writes none).
// Live proof before the fix: item 554117146000 went 35 → 45 on
// `qc_accept · IN-JC-26-00026 Op #2`.
//
// Two job cards, identical in every way except their source link, so the ONLY
// thing that can explain the different outcome is the JWSO link itself.

import { and, asc, eq, isNull, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  clients,
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  salesOrderLines,
  salesOrders,
  storeTransactions,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { withUserContext } from '../../db/with-user-context';
import { tryApplyQcStockCascade } from './qc-stock-cascade';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TAG = `T105-${String(Date.now()).slice(-6)}`;
const QTY = 7;

let admin: AuthContext;
let itemId: string;
let jwJcId: string;
let soJcId: string;
let jwId: string;
let jwLineId: string;
let soId: string;
let soLineId: string;

/** Insert a JC with a single QC op at seq 1 (so it is also the LAST op). */
async function makeJc(
  code: string,
  link: { sourceJwLineId?: string; sourceSoLineId?: string },
): Promise<string> {
  const jc = (
    await db
      .insert(jobCards)
      .values({
        companyId: admin.companyId!,
        code,
        jcDate: '2026-08-05',
        itemId,
        orderQty: QTY,
        priority: 'normal',
        ...link,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobCards.id })
  )[0]!.id;
  await db.insert(jcOps).values({
    companyId: admin.companyId!,
    jobCardId: jc,
    opSeq: 1,
    operation: `${TAG}-DIR`,
    opType: 'qc',
    cycleTimeMin: '0.00',
    qcRequired: true,
    reworkQty: 0,
    outsourceCost: '0.00',
    outsourceSentQty: 0,
    outsourceReturnedQty: 0,
    createdBy: admin.id,
    updatedBy: admin.id,
  });
  return jc;
}

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u?.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  const companyId = u.companyId;

  const it0 = (
    await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(eq(items.companyId, companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
      )
      .orderBy(asc(items.createdAt))
      .limit(1)
  )[0];
  if (!it0) throw new Error('No item in seed company');
  itemId = it0.id;

  const c = (
    await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.companyId, companyId), isNull(clients.deletedAt)))
      .orderBy(asc(clients.createdAt))
      .limit(1)
  )[0];
  if (!c) throw new Error('No client in seed company');

  jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId,
        code: `${TAG}-JW`,
        jwDate: '2026-08-05',
        clientId: c.id,
        customerName: 'ADR-105 client',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobWorkOrders.id })
  )[0]!.id;
  jwLineId = (
    await db
      .insert(jobWorkOrderLines)
      .values({
        companyId,
        jobWorkOrderId: jwId,
        lineNo: 1,
        itemId,
        partName: `${TAG}-PART`,
        uom: 'NOS',
        orderQty: QTY,
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobWorkOrderLines.id })
  )[0]!.id;

  soId = (
    await db
      .insert(salesOrders)
      .values({
        companyId,
        code: `${TAG}-SO`,
        soDate: '2026-08-05',
        clientId: c.id,
        type: 'component_manufacturing',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: salesOrders.id })
  )[0]!.id;
  soLineId = (
    await db
      .insert(salesOrderLines)
      .values({
        companyId,
        salesOrderId: soId,
        lineNo: 1,
        itemId,
        partName: `${TAG}-PART`,
        uom: 'NOS',
        orderQty: QTY,
        rate: '0',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: salesOrderLines.id })
  )[0]!.id;

  jwJcId = await makeJc(`${TAG}-JC-JW`, { sourceJwLineId: jwLineId });
  soJcId = await makeJc(`${TAG}-JC-SO`, { sourceSoLineId: soLineId });
});

afterAll(async () => {
  for (const jc of [jwJcId, soJcId]) {
    await db.delete(jcOps).where(eq(jcOps.jobCardId, jc));
    await db.delete(jobCards).where(eq(jobCards.id, jc));
  }
  await db.delete(salesOrderLines).where(eq(salesOrderLines.id, soLineId));
  await db.delete(salesOrders).where(eq(salesOrders.id, soId));
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.id, jwLineId));
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
});

async function fire(jobCardId: string, jcCode: string): Promise<{ fired: boolean }> {
  return withUserContext(admin, async (tx) =>
    tryApplyQcStockCascade(
      tx,
      {
        companyId: admin.companyId!,
        jobCardId,
        jcCode,
        opSeq: 1,
        acceptedQty: QTY,
        txnDate: '2026-08-05',
      },
      admin,
    ),
  );
}

describe('qc stock cascade — ADR-105 JWSO exclusion', () => {
  it('does NOT credit own stock for a JWSO job card', async () => {
    const res = await fire(jwJcId, `${TAG}-JC-JW`);
    expect(res.fired, 'the customer’s goods must not be booked as our inventory').toBe(false);

    const rows = await db
      .select({ sourceRef: storeTransactions.sourceRef })
      .from(storeTransactions)
      .where(eq(storeTransactions.sourceRef, `${TAG}-JC-JW Op #1`));
    expect(rows, 'no ledger row written').toHaveLength(0);
  });

  it('still credits own stock for an SO-sourced job card', async () => {
    const res = await fire(soJcId, `${TAG}-JC-SO`);
    expect(res.fired, 'our own production is still booked to stock').toBe(true);

    const rows = await db
      .select({ qty: storeTransactions.qty, txnType: storeTransactions.txnType })
      .from(storeTransactions)
      .where(eq(storeTransactions.sourceRef, `${TAG}-JC-SO Op #1`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(QTY);
    expect(rows[0]!.txnType).toBe('in');

    await db
      .delete(storeTransactions)
      .where(eq(storeTransactions.sourceRef, `${TAG}-JC-SO Op #1`));
  });
});
