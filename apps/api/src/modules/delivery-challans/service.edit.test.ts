// OSP Delivery Challan EDIT tests (ADR-202 Phase 3).
//
// DO NOT RUN against a shared DB from an agent — the api suite seeds / deletes on
// PRODUCTION (house rule). These are written for the deploy gate / CI run.
//
// Covers: editing a line's Challan Qty up then down moves jc_ops.outsource_sent_qty
// by the deltas (reverse-then-repost, §20.1 single writer); an over-PO refusal
// leaves the op counter untouched; a DC that already has a receipt refuses the
// edit; and the registry's applyEdit with ONLY one approved line key applies that
// line and leaves the other line's qty + op counter unchanged.

import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  deliveryChallanLines,
  deliveryChallanReceipts,
  deliveryChallans,
  items,
  jcOps,
  jobCards,
  purchaseOrderLines,
  purchaseOrders,
  users,
  vendors,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import * as poService from '../purchase-orders/service';
import { dcEditRegistryEntry } from './dc-edit-registry';
import { dcLineQtyKey } from './edit-fields';
import * as service from './service';

const PREFIX = 'T202DC-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let testItemId: string;
let vendorId: string;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  await db.delete(items).where(like(items.code, `${PREFIX}%`));
  const itemRows = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${PREFIX}ITEM`,
      name: 'DC edit test item',
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
  vendorId = vendorRow[0]!.id;
});

afterAll(async () => {
  const dcs = await db
    .select({ id: deliveryChallans.id })
    .from(deliveryChallans)
    .where(like(deliveryChallans.code, `${PREFIX}%`));
  for (const d of dcs) {
    await db
      .delete(deliveryChallanReceipts)
      .where(eq(deliveryChallanReceipts.deliveryChallanId, d.id));
    await db.delete(deliveryChallanLines).where(eq(deliveryChallanLines.deliveryChallanId, d.id));
  }
  await db.delete(deliveryChallans).where(like(deliveryChallans.code, `${PREFIX}%`));
  await db.delete(jobCards).where(like(jobCards.code, `${PREFIX}%`));
  const poHeaders = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(like(purchaseOrders.code, `${PREFIX}%`));
  for (const h of poHeaders) {
    await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, h.id));
  }
  await db.delete(purchaseOrders).where(like(purchaseOrders.code, `${PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${PREFIX}%`));
  await db.delete(items).where(like(items.code, `${PREFIX}%`));
});

/** A JW PO with one line per `qtys` entry, plus one outsource JC op bound to each
 *  line (op_seq 1, order qty 100 so input_avail never binds — the PO line qty is
 *  the cap under test). Returns the PO line ids and their op ids, in order. */
async function freshPoWithOps(
  suffix: string,
  qtys: number[],
): Promise<{ poId: string; lines: Array<{ poLineId: string; opId: string }> }> {
  const code = `${PREFIX}PO-${suffix}-${Date.now()}`;
  const detail = await poService.createPurchaseOrder(
    {
      header: {
        code,
        poDate: '2026-06-01',
        poType: 'job_work',
        vendorId,
        status: 'open',
        sgstPct: 0,
        cgstPct: 0,
        igstPct: 0,
      },
      lines: qtys.map((qty) => ({ itemId: testItemId, itemName: 'JW source', qty, rate: 0 })),
    },
    admin,
  );
  const lines: Array<{ poLineId: string; opId: string }> = [];
  for (let i = 0; i < detail.lines.length; i++) {
    const poLineId = detail.lines[i]!.id;
    const jcRows = await db
      .insert(jobCards)
      .values({
        companyId: admin.companyId!,
        code: `${PREFIX}JC-${suffix}-${i}-${Date.now()}`,
        jcDate: '2026-06-01',
        itemId: testItemId,
        orderQty: 100,
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
        outsourceVendorId: vendorId,
        outsourcePoLineId: poLineId,
        outsourceStatus: 'po_created',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    lines.push({ poLineId, opId: opRows[0]!.id });
  }
  return { poId: detail.id, lines };
}

async function sentQtyOf(opId: string): Promise<number> {
  const rows = await db
    .select({ sent: jcOps.outsourceSentQty })
    .from(jcOps)
    .where(eq(jcOps.id, opId))
    .limit(1);
  return Number(rows[0]!.sent);
}

async function makeDc(
  suffix: string,
  po: Awaited<ReturnType<typeof freshPoWithOps>>,
  qtys: number[],
): Promise<Awaited<ReturnType<typeof service.createDeliveryChallan>>> {
  return service.createDeliveryChallan(
    {
      header: {
        code: `${PREFIX}${suffix}`,
        dcDate: '2026-06-01',
        purchaseOrderId: po.poId,
        poCodeText: 'JW-PO',
        vendorId,
        vendorCodeText: 'TEST-VENDOR',
      },
      lines: po.lines.map((l, i) => ({
        itemId: testItemId,
        itemCodeText: `${PREFIX}ITEM`,
        qty: qtys[i]!,
        uom: 'NOS',
        purchaseOrderLineId: l.poLineId,
      })),
    },
    admin,
  );
}

describe('delivery-challans service — EDIT (ADR-202 Phase 3)', () => {
  it('editing a line qty up then down moves outsource_sent_qty by the deltas', async () => {
    const po = await freshPoWithOps('UD', [10]);
    const dc = await makeDc('UD', po, [4]);
    const lineId = dc.lines[0]!.id;
    expect(await sentQtyOf(po.lines[0]!.opId)).toBe(4);

    // Up: 4 → 7. The op counter is reversed (−4) then reposted (+7) = 7.
    const up = await service.updateDeliveryChallan(dc.id, { lines: [{ id: lineId, qty: 7 }] }, admin);
    expect(Number(up.lines[0]!.qty)).toBe(7);
    expect(await sentQtyOf(po.lines[0]!.opId)).toBe(7);
    // The code bumped a revision on the edit.
    expect(up.code).not.toBe(dc.code);

    // Down: 7 → 2. Reversed (−7) then reposted (+2) = 2.
    const down = await service.updateDeliveryChallan(
      dc.id,
      { lines: [{ id: lineId, qty: 2 }] },
      admin,
    );
    expect(Number(down.lines[0]!.qty)).toBe(2);
    expect(await sentQtyOf(po.lines[0]!.opId)).toBe(2);
  });

  it('editing a line above the PO line pending is refused and leaves the op counter untouched', async () => {
    const po = await freshPoWithOps('OV', [10]);
    const dc = await makeDc('OV', po, [4]);
    const lineId = dc.lines[0]!.id;

    await expect(
      service.updateDeliveryChallan(dc.id, { lines: [{ id: lineId, qty: 11 }] }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
    // The whole edit rolled back — the op still reads the original 4.
    expect(await sentQtyOf(po.lines[0]!.opId)).toBe(4);
  });

  it('editing a DC that already has a receipt is refused', async () => {
    const po = await freshPoWithOps('RC', [10]);
    const dc = await makeDc('RC', po, [6]);
    const lineId = dc.lines[0]!.id;
    await service.receiveAgainstDeliveryChallan(
      dc.id,
      { receiptDate: '2026-06-01', lines: [{ deliveryChallanLineId: lineId, receivedQty: 2 }] },
      admin,
    );
    await expect(
      service.updateDeliveryChallan(dc.id, { lines: [{ id: lineId, qty: 8 }] }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('applyEdit with ONLY one approved line key applies that line and leaves the other unchanged', async () => {
    const po = await freshPoWithOps('AP', [10, 10]);
    const dc = await makeDc('AP', po, [4, 6]);
    const line1 = dc.lines[0]!.id;
    const line2 = dc.lines[1]!.id;
    expect(await sentQtyOf(po.lines[0]!.opId)).toBe(4);
    expect(await sentQtyOf(po.lines[1]!.opId)).toBe(6);

    // The proposed edit raises BOTH lines, but only Line 1's qty is approved.
    const proposed = {
      lines: [
        { id: line1, qty: 8 },
        { id: line2, qty: 9 },
      ],
    };
    const approved = new Set([dcLineQtyKey(line1)]);
    const filtered = dcEditRegistryEntry.buildFilteredInput(proposed, approved);
    expect(filtered).not.toBeNull();

    await withUserContext(admin, async (tx) =>
      dcEditRegistryEntry.applyEdit(tx, admin.companyId!, dc.id, filtered, null, admin),
    );

    // Line 1 moved to 8; Line 2 kept its current 6 (its op counter unchanged).
    expect(await sentQtyOf(po.lines[0]!.opId)).toBe(8);
    expect(await sentQtyOf(po.lines[1]!.opId)).toBe(6);
    const after = await service.getDeliveryChallan(dc.id, admin);
    const l2 = after.lines.find((l) => l.id === line2)!;
    expect(Number(l2.qty)).toBe(6);
  });
});
