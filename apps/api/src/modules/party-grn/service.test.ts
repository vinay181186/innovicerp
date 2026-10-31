// Party GRN service tests — ADR-203 gate-in, Incoming QC and cancel.
//
// Fixtures are self-contained and prefixed TPG- so they never touch seed or
// production rows: one client, one JWSO with TWO lines carrying DIFFERENT
// items, each line pointing at its own party material (the line's customer RM).

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, like, notLike, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  clients,
  items,
  jobWorkOrderLines,
  jobWorkOrders,
  ncRegister,
  partyGrn,
  partyGrnLines,
  partyMaterials,
  partyStockLedger,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { cancelPartyGrnInputSchema, listPartyGrnQuerySchema } from '@innovic/shared';
import { requestCancel } from '../cancel-requests/service';
import { listPartyGrnLines } from './list-lines';
import { qcPartyGrn } from './qc';
import { registerPartialQcCases } from './qc-partial.cases';
import * as service from './service';

const TEST_PREFIX = 'TPG-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let clientId: string;
let jwId: string;
let itemAId: string;
let itemBId: string;
let partialItemIds: [string, string];
/** Party material for line 1's item. */
let pmAId: string;
/** Party material for line 2's item. */
let pmBId: string;
let line1Id: string;
let line2Id: string;

const ORDER_QTY = 100;

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
  const companyId = u.companyId;

  // Four DISTINCT seed items: A / B for the JWSO lines here, C / D for the
  // partial-QC cases (a customer material is unique per company + item + client).
  const itemRows = await db
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(
      and(eq(items.companyId, companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
    )
    .orderBy(asc(items.createdAt))
    .limit(4);
  if (itemRows.length < 4) throw new Error('Need 4 items in the seed company');
  itemAId = itemRows[0]!.id;
  itemBId = itemRows[1]!.id;
  partialItemIds = [itemRows[2]!.id, itemRows[3]!.id];

  clientId = (
    await db
      .insert(clients)
      .values({
        companyId,
        code: `${TEST_PREFIX}CLI`,
        name: 'Party GRN test client',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;

  jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId,
        code: `${TEST_PREFIX}JW`,
        jwDate: '2026-08-04',
        clientId,
        customerName: 'Party GRN test client',
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;

  // ADR-203: each JWSO line carries its own customer material.
  const pms = await db
    .insert(partyMaterials)
    .values([
      {
        companyId,
        code: `${TEST_PREFIX}PM-A`,
        name: 'Test party material A',
        uom: 'NOS',
        clientId,
        itemId: itemAId,
        createdBy: u.id,
        updatedBy: u.id,
      },
      {
        companyId,
        code: `${TEST_PREFIX}PM-B`,
        name: 'Test party material B',
        uom: 'NOS',
        clientId,
        itemId: itemBId,
        createdBy: u.id,
        updatedBy: u.id,
      },
    ])
    .returning();
  pmAId = pms.find((p) => p.code === `${TEST_PREFIX}PM-A`)!.id;
  pmBId = pms.find((p) => p.code === `${TEST_PREFIX}PM-B`)!.id;

  const lines = await db
    .insert(jobWorkOrderLines)
    .values([
      {
        companyId,
        jobWorkOrderId: jwId,
        lineNo: 1,
        itemId: itemAId,
        partyMaterialId: pmAId,
        partName: `${TEST_PREFIX}PART-A`,
        uom: 'NOS',
        orderQty: ORDER_QTY,
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      },
      {
        companyId,
        jobWorkOrderId: jwId,
        lineNo: 2,
        itemId: itemBId,
        partyMaterialId: pmBId,
        partName: `${TEST_PREFIX}PART-B`,
        uom: 'NOS',
        orderQty: ORDER_QTY,
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      },
    ])
    .returning();
  line1Id = lines.find((l) => l.lineNo === 1)!.id;
  line2Id = lines.find((l) => l.lineNo === 2)!.id;
});

afterAll(async () => {
  const grnIds = (
    await db.select({ id: partyGrn.id }).from(partyGrn).where(eq(partyGrn.jobWorkOrderId, jwId))
  ).map((g) => g.id);
  // Append-only ledger: the transaction-local maintenance switch survives the
  // TEST pooler (the application_name exit does not).
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('innovic.ledger_maintenance', 'on', true)`);
    await tx
      .delete(partyStockLedger)
      .where(inArray(partyStockLedger.partyMaterialId, [pmAId, pmBId]));
  });
  if (grnIds.length > 0) {
    // ADR-247 NCs raised on these lines (deviated pieces) go first — they
    // reference the lines.
    const lineIds = (
      await db
        .select({ id: partyGrnLines.id })
        .from(partyGrnLines)
        .where(inArray(partyGrnLines.partyGrnId, grnIds))
    ).map((l) => l.id);
    if (lineIds.length > 0) {
      await db.delete(ncRegister).where(inArray(ncRegister.partyGrnLineId, lineIds));
    }
    await db.delete(partyGrnLines).where(inArray(partyGrnLines.partyGrnId, grnIds));
    await db.delete(partyGrn).where(inArray(partyGrn.id, grnIds));
  }
  await db.delete(activityLog).where(like(activityLog.refId, 'PGRN-%'));
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, jwId));
  await db.delete(partyMaterials).where(like(partyMaterials.code, `${TEST_PREFIX}%`));
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
  await db.delete(clients).where(eq(clients.id, clientId));
});

/** Current stock/received on a party material. */
async function pmStock(id: string): Promise<{ stockQty: number; receivedQty: number }> {
  const r = (
    await db
      .select({ stockQty: partyMaterials.stockQty, receivedQty: partyMaterials.receivedQty })
      .from(partyMaterials)
      .where(eq(partyMaterials.id, id))
  )[0]!;
  return r;
}

function receipt(jwLineId: string, receivedQty: number) {
  // Customer Challan No. is required and unique per customer — a fresh one per receipt.
  return {
    grnDate: '2026-08-04',
    jobWorkOrderId: jwId,
    dcNo: `DC-${randomUUID()}`,
    lines: [{ jwLineId, receivedQty }],
  };
}

/** Receive, then pass Incoming QC with everything accepted. */
async function receiveAndAccept(jwLineId: string, qty: number) {
  const grn = await service.createPartyGrn(receipt(jwLineId, qty), admin);
  const detail = await service.getPartyGrnDetail(grn.id, admin);
  await qcPartyGrn(
    grn.id,
    { lines: [{ lineId: detail.lines[0]!.id, acceptedQty: qty, rejectedQty: 0 }] },
    admin,
  );
  return grn;
}

/** ADR-235: a cancel is a Cancel Request; the admin holds Approve, so
 *  approveNow = request + approve in one call. */
function cancelGrn(id: string, reason: string) {
  return requestCancel('party_grn', id, { reason, approveNow: true }, admin);
}

describe('party-grn service — create (ADR-203)', () => {
  it('rejects an unknown JWSO line', async () => {
    await expect(
      service.createPartyGrn(receipt('00000000-0000-0000-0000-000000000000', 1), admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects more than the line order qty in a single receipt', async () => {
    await expect(
      service.createPartyGrn(receipt(line1Id, ORDER_QTY + 1), admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('books the gate-in only — nothing enters the register until QC', async () => {
    const before = await pmStock(pmAId);
    const grn = await service.createPartyGrn(receipt(line1Id, 60), admin);
    expect(grn.code).toMatch(/^PGRN-\d{5}$/);
    const detail = await service.getPartyGrnDetail(grn.id, admin);
    expect(detail.qcPendingLines).toBe(1);
    expect(detail.totalAcceptedQty).toBe(0);
    expect(detail.lines[0]!.partyMaterialId).toBe(pmAId);
    expect(detail.lines[0]!.jwLineNoText).toBe('1');
    expect(await pmStock(pmAId)).toEqual(before);
  });

  it('counts pieces waiting for QC against the order qty', async () => {
    // 60 waiting above; 41 more would be 101 against an order of 100.
    await expect(service.createPartyGrn(receipt(line1Id, 41), admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('party-grn service — Incoming QC (ADR-203)', () => {
  it('refuses more than the QC Pending Qty (partial QC, 0233)', async () => {
    const grn = await service.createPartyGrn(receipt(line2Id, 10), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    await expect(
      qcPartyGrn(
        grn.id,
        { lines: [{ lineId: d.lines[0]!.id, acceptedQty: 9, rejectedQty: 2, rejectReason: 'x' }] },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await cancelGrn(grn.id, 'cleanup');
  });

  it('posts only the accepted qty and holds the rejects', async () => {
    const before = await pmStock(pmBId);
    const grn = await service.createPartyGrn(receipt(line2Id, 10), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    const after = await qcPartyGrn(
      grn.id,
      {
        lines: [{ lineId: d.lines[0]!.id, acceptedQty: 7, rejectedQty: 3, rejectReason: 'rusty' }],
      },
      admin,
    );
    expect(after.qcPendingLines).toBe(0);
    expect(after.totalAcceptedQty).toBe(7);
    const s = await pmStock(pmBId);
    expect(s.stockQty).toBe(before.stockQty + 7);
    expect(s.receivedQty).toBe(before.receivedQty + 7);
  });

  it('stores QC Remarks on an accepted-only line and returns them on the line read (0232)', async () => {
    const grn = await service.createPartyGrn(receipt(line2Id, 3), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    const lineId = d.lines[0]!.id;
    expect(d.lines[0]!.qcRemarks).toBeNull();
    const after = await qcPartyGrn(
      grn.id,
      {
        lines: [{ lineId, acceptedQty: 3, rejectedQty: 0, qcRemarks: '  surface ok, light oil  ' }],
      },
      admin,
    );
    expect(after.lines[0]!.qcRemarks).toBe('surface ok, light oil');
    expect(after.lines[0]!.rejectReason).toBeNull();
    const stored = await db
      .select({ qcRemarks: partyGrnLines.qcRemarks })
      .from(partyGrnLines)
      .where(eq(partyGrnLines.id, lineId));
    expect(stored[0]!.qcRemarks).toBe('surface ok, light oil');
    const reread = await service.getPartyGrnDetail(grn.id, admin);
    expect(reread.lines[0]!.qcRemarks).toBe('surface ok, light oil');
  });

  it('lets exactly one of two simultaneous QCs of one line through', async () => {
    const grn = await service.createPartyGrn(receipt(line2Id, 4), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    const body = { lines: [{ lineId: d.lines[0]!.id, acceptedQty: 4, rejectedQty: 0 }] };
    const results = await Promise.allSettled([
      qcPartyGrn(grn.id, body, admin),
      qcPartyGrn(grn.id, body, admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
  });
});
registerPartialQcCases(() => ({
  admin,
  jwId,
  clientId,
  itemIds: partialItemIds,
  prefix: TEST_PREFIX,
}));

describe('party-grn service — cancel (ADR-203, ADR-235)', () => {
  it('reverses the accepted qty and shows the GRN as Cancelled', async () => {
    const created = await receiveAndAccept(line1Id, 10);
    const afterQc = await pmStock(pmAId);

    const res = await cancelGrn(created.id, 'entered twice');
    expect(res.cancelled).toBe(true);
    expect(res.request.status).toBe('approved');

    const afterCancel = await pmStock(pmAId);
    expect(afterCancel.stockQty).toBe(afterQc.stockQty - 10);
    expect(afterCancel.receivedQty).toBe(afterQc.receivedQty - 10);

    // ADR-235: still readable (read-only), with the lines cancelled with it.
    const d = await service.getPartyGrnDetail(created.id, admin);
    expect(d.cancelReason).toBe('entered twice');
    expect(d.cancelledAt).not.toBeNull();
    expect(d.lines).toHaveLength(1);
    expect(d.qcPendingLines).toBe(0);
    const rows = await db
      .select({
        deletedAt: partyGrn.deletedAt,
        cancelledAt: partyGrn.cancelledAt,
        remarks: partyGrn.remarks,
      })
      .from(partyGrn)
      .where(eq(partyGrn.id, created.id));
    expect(rows[0]!.deletedAt).not.toBeNull();
    expect(rows[0]!.cancelledAt?.getTime()).toBe(rows[0]!.deletedAt?.getTime());
    expect(rows[0]!.remarks ?? '').not.toContain('[Cancelled]');

    // Live list skips it; includeCancelled brings it back.
    const live = await service.listPartyGrn(
      listPartyGrnQuerySchema.parse({ search: created.code }),
      admin,
    );
    expect(live.items.map((i) => i.id)).not.toContain(created.id);
    const all = await service.listPartyGrn(
      listPartyGrnQuerySchema.parse({ search: created.code, includeCancelled: 'true' }),
      admin,
    );
    const row = all.items.find((i) => i.id === created.id);
    expect(row?.cancelReason).toBe('entered twice');
    expect(all.summary.totalGrns).toBe(live.summary.totalGrns);
  });

  it('requires a reason, and refuses a second cancel', async () => {
    const created = await service.createPartyGrn(receipt(line1Id, 1), admin);
    // The route's schema refuses a blank reason before any request is made.
    expect(cancelPartyGrnInputSchema.safeParse({ reason: '   ' }).success).toBe(false);
    await cancelGrn(created.id, 'cleanup');
    await expect(cancelGrn(created.id, 'again')).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(cancelGrn('00000000-0000-0000-0000-000000000000', 'x')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('party-grn service — edit (ADR-202 Phase 3)', () => {
  it('edits a header field and a waiting-QC line, touching no stock', async () => {
    const before = await pmStock(pmBId);
    const grn = await service.createPartyGrn(receipt(line2Id, 10), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);

    const updated = await service.updatePartyGrn(
      grn.id,
      {
        dcNo: 'DC-EDIT-1',
        remarks: 'corrected',
        lines: [{ id: d.lines[0]!.id, receivedQty: 4, remarks: 'short delivery' }],
      },
      admin,
    );
    expect(updated.dcNo).toBe('DC-EDIT-1');
    expect(updated.lines[0]!.receivedQty).toBe(4);
    expect(updated.lines[0]!.remarks).toBe('short delivery');
    // A waiting-QC line change posts nothing to the register.
    expect(await pmStock(pmBId)).toEqual(before);

    await cancelGrn(grn.id, 'cleanup');
  });

  it('refuses editing a line that is already through Incoming QC', async () => {
    const grn = await service.createPartyGrn(receipt(line2Id, 5), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    await qcPartyGrn(
      grn.id,
      { lines: [{ lineId: d.lines[0]!.id, acceptedQty: 5, rejectedQty: 0 }] },
      admin,
    );
    await expect(
      service.updatePartyGrn(grn.id, { lines: [{ id: d.lines[0]!.id, receivedQty: 3 }] }, admin),
    ).rejects.toBeInstanceOf(ConflictError);

    await cancelGrn(grn.id, 'cleanup');
  });

  it('refuses raising a waiting-QC line past the JWSO-line order qty', async () => {
    const grn = await service.createPartyGrn(receipt(line2Id, 5), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    await expect(
      service.updatePartyGrn(
        grn.id,
        { lines: [{ id: d.lines[0]!.id, receivedQty: ORDER_QTY + 1000 }] },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    await cancelGrn(grn.id, 'cleanup');
  });
});

describe('party-grn service — list one row per line (ADR-261)', () => {
  it('lists each GRN line with its JWSO, POL, item and document fields', async () => {
    const grn = await service.createPartyGrn(receipt(line2Id, 2), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    const q = listPartyGrnQuerySchema.parse({ search: grn.code, limit: 25, offset: 0 });
    const res = await listPartyGrnLines(q, admin);
    expect(res.total).toBe(1);
    const row = res.items[0]!;
    expect(row.lineId).toBe(d.lines[0]!.id);
    expect(row.docId).toBe(grn.id);
    expect(row.docCode).toBe(grn.code);
    expect(row.docStatus).toBe('live');
    expect(row.jwCode).toBe(`${TEST_PREFIX}JW`);
    expect(row.itemCode).toBe(d.lines[0]!.partyMaterialCodeText);
    expect(row.receivedQty).toBe(2);
    expect(row.qcPendingQty).toBe(2);
    expect(row.header.id).toBe(grn.id);
    expect(res.summary.totalGrns).toBe(1);

    await cancelGrn(grn.id, 'cleanup');
  });

  it('never lists another company’s lines', async () => {
    const grn = await service.createPartyGrn(receipt(line2Id, 1), admin);
    const q = listPartyGrnQuerySchema.parse({ search: grn.code, limit: 25, offset: 0 });
    const res = await listPartyGrnLines(q, { ...admin, companyId: randomUUID() });
    expect(res.total).toBe(0);
    expect(res.items).toHaveLength(0);

    await cancelGrn(grn.id, 'cleanup');
  });
});
