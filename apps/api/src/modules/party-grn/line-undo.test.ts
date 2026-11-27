// ADR-324 line undo (P1) — the three Cancel Request types on one Party GRN
// line / NC, end to end on TEST:
//   · Reverse QC (party_grn_line_qc): register −accepted, received −accepted,
//     the line back to waiting for QC, other lines untouched; refused while an
//     NC on the line has a decision, and while the accepted pieces are issued;
//     QC save racing a reverse leaves a consistent register.
//   · Remove line (party_grn_line, one-step): refused when QC is recorded and
//     on the GRN's last live line.
//   · Undo decision (nc_disposition) on a Use As Is: the pieces leave the
//     register again and the NC is back to NC Raised.
// Self-contained fixture (own client / JWSO / customer materials).

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, like, notLike, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  cancelRequests,
  clients,
  items,
  jobWorkOrderLines,
  jobWorkOrders,
  ncRegister,
  partyGrn,
  partyGrnLines,
  partyMaterialIssues,
  partyMaterials,
  partyStockLedger,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { requestCancel } from '../cancel-requests/service';
import { disposeNcRegister } from '../nc-register/service';
import { qcPartyGrn } from './qc';
import * as service from './service';

const P = `TLU${Date.now().toString(36).slice(-5).toUpperCase()}-`;
const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const ORDER = 100;

let admin: AuthContext;
let clientId: string;
let jwId: string;
let lineA: string;
let lineB: string;
let pmA: string;
let pmB: string;

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  const companyId = u.companyId;
  const itemRows = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(eq(items.companyId, companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
    )
    .orderBy(asc(items.createdAt))
    .limit(2);
  if (itemRows.length < 2) throw new Error('Need 2 items in the seed company');
  clientId = (
    await db
      .insert(clients)
      .values({
        companyId,
        code: `${P}CLI`,
        name: 'Line undo client',
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
        code: `${P}JW`,
        jwDate: '2026-11-26',
        clientId,
        customerName: 'Line undo client',
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;
  const pms = await db
    .insert(partyMaterials)
    .values(
      ['A', 'B'].map((k, i) => ({
        companyId,
        code: `${P}PM-${k}`,
        name: `Line undo material ${k}`,
        uom: 'NOS',
        clientId,
        itemId: itemRows[i]!.id,
        createdBy: u.id,
        updatedBy: u.id,
      })),
    )
    .returning();
  pmA = pms.find((p) => p.code.endsWith('PM-A'))!.id;
  pmB = pms.find((p) => p.code.endsWith('PM-B'))!.id;
  const lines = await db
    .insert(jobWorkOrderLines)
    .values(
      [
        { lineNo: 1, pm: pmA, itemId: itemRows[0]!.id },
        { lineNo: 2, pm: pmB, itemId: itemRows[1]!.id },
      ].map((l) => ({
        companyId,
        jobWorkOrderId: jwId,
        lineNo: l.lineNo,
        itemId: l.itemId,
        partyMaterialId: l.pm,
        partName: `${P}PART-${l.lineNo}`,
        uom: 'NOS' as const,
        orderQty: ORDER,
        status: 'open' as const,
        createdBy: u.id,
        updatedBy: u.id,
      })),
    )
    .returning();
  lineA = lines.find((l) => l.lineNo === 1)!.id;
  lineB = lines.find((l) => l.lineNo === 2)!.id;
});

afterAll(async () => {
  const grnIds = (
    await db.select({ id: partyGrn.id }).from(partyGrn).where(eq(partyGrn.jobWorkOrderId, jwId))
  ).map((g) => g.id);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('innovic.ledger_maintenance', 'on', true)`);
    await tx.delete(partyStockLedger).where(inArray(partyStockLedger.partyMaterialId, [pmA, pmB]));
  });
  await db.delete(partyMaterialIssues).where(like(partyMaterialIssues.code, `${P}%`));
  if (grnIds.length > 0) {
    const lineIds = (
      await db
        .select({ id: partyGrnLines.id })
        .from(partyGrnLines)
        .where(inArray(partyGrnLines.partyGrnId, grnIds))
    ).map((l) => l.id);
    if (lineIds.length > 0) {
      await db.delete(ncRegister).where(inArray(ncRegister.partyGrnLineId, lineIds));
      await db.delete(cancelRequests).where(inArray(cancelRequests.docId, lineIds));
    }
    await db.delete(partyGrnLines).where(inArray(partyGrnLines.partyGrnId, grnIds));
    await db.delete(partyGrn).where(inArray(partyGrn.id, grnIds));
  }
  await db.delete(activityLog).where(like(activityLog.detail, `%${P}%`));
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, jwId));
  await db.delete(partyMaterials).where(like(partyMaterials.code, `${P}%`));
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
  await db.delete(clients).where(eq(clients.id, clientId));
});

const receipt = (lines: Array<{ jwLineId: string; receivedQty: number }>) => ({
  grnDate: '2026-11-26',
  jobWorkOrderId: jwId,
  dcNo: `DC-${randomUUID()}`,
  lines,
});
const pm = async (id: string) =>
  (
    await db
      .select({ stockQty: partyMaterials.stockQty, receivedQty: partyMaterials.receivedQty })
      .from(partyMaterials)
      .where(eq(partyMaterials.id, id))
  )[0]!;
const lineRow = async (id: string) =>
  (await db.select().from(partyGrnLines).where(eq(partyGrnLines.id, id)))[0]!;
const reason = 'ADR-324 test';
const reverseQc = (lineId: string) =>
  requestCancel('party_grn_line_qc', lineId, { reason, approveNow: true }, admin);
const removeLine = (lineId: string) =>
  requestCancel('party_grn_line', lineId, { reason, approveNow: true }, admin);

async function grnWith(qtyA: number, qtyB: number) {
  const grn = await service.createPartyGrn(
    receipt([
      { jwLineId: lineA, receivedQty: qtyA },
      { jwLineId: lineB, receivedQty: qtyB },
    ]),
    admin,
  );
  const d = await service.getPartyGrnDetail(grn.id, admin);
  const a = d.lines.find((l) => l.jwLineId === lineA)!.id;
  const b = d.lines.find((l) => l.jwLineId === lineB)!.id;
  return { grn, a, b };
}

describe('ADR-324 — Reverse QC on one Party GRN line', () => {
  it('takes back the accepted pieces of that line only', async () => {
    const { grn, a, b } = await grnWith(10, 5);
    await qcPartyGrn(
      grn.id,
      {
        lines: [
          { lineId: a, acceptedQty: 10, rejectedQty: 0 },
          { lineId: b, acceptedQty: 5, rejectedQty: 0 },
        ],
      },
      admin,
    );
    const beforeA = await pm(pmA);
    const beforeB = await pm(pmB);
    const res = await reverseQc(a);
    expect(res.cancelled).toBe(true);
    const afterA = await pm(pmA);
    expect(afterA.stockQty).toBe(beforeA.stockQty - 10);
    expect(afterA.receivedQty).toBe(beforeA.receivedQty - 10);
    const la = await lineRow(a);
    expect(la.acceptedQty).toBe(0);
    expect(la.rejectedQty).toBe(0);
    expect(la.qcAt).toBeNull();
    expect(la.qcBy).toBeNull();
    expect(la.deletedAt).toBeNull();
    // Line B and its material are untouched.
    expect((await lineRow(b)).acceptedQty).toBe(5);
    expect(await pm(pmB)).toEqual(beforeB);
    // Nothing left to reverse now.
    await expect(reverseQc(a)).rejects.toBeInstanceOf(ConflictError);
  });

  it('is refused while an NC on the line has a decision', async () => {
    const { grn, a } = await grnWith(10, 1);
    await qcPartyGrn(
      grn.id,
      { lines: [{ lineId: a, acceptedQty: 8, rejectedQty: 2, rejectReason: 'dent' }] },
      admin,
    );
    const nc = (
      await db
        .select({ id: ncRegister.id })
        .from(ncRegister)
        .where(and(eq(ncRegister.partyGrnLineId, a), isNull(ncRegister.deletedAt)))
    )[0]!;
    await disposeNcRegister(nc.id, { action: 'scrap', remarks: 'customer agreed' }, admin);
    await expect(reverseQc(a)).rejects.toThrow(/has a decision .* undo the decision first/);
  });

  it('is refused while the accepted pieces are issued (names the issue)', async () => {
    const { grn, a } = await grnWith(6, 1);
    await qcPartyGrn(grn.id, { lines: [{ lineId: a, acceptedQty: 6, rejectedQty: 0 }] }, admin);
    // A live Customer Material Issue of the line holding the pieces (the
    // refusal rule reads documents, so the row alone is enough).
    await db.insert(partyMaterialIssues).values({
      companyId: admin.companyId!,
      code: `${P}PMI-1`,
      issueDate: '2026-11-26',
      jobWorkOrderId: jwId,
      jwLineId: lineA,
      partyMaterialId: pmA,
      qty: 1000,
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    try {
      await expect(reverseQc(a)).rejects.toThrow(new RegExp(`${P}PMI-1`));
    } finally {
      await db.delete(partyMaterialIssues).where(eq(partyMaterialIssues.code, `${P}PMI-1`));
    }
  });

  it('QC save and Reverse QC at the same time — the register stays in step', async () => {
    const { grn, a } = await grnWith(20, 1);
    await qcPartyGrn(grn.id, { lines: [{ lineId: a, acceptedQty: 10, rejectedQty: 0 }] }, admin);
    const before = await pm(pmA);
    const results = await Promise.allSettled([
      qcPartyGrn(grn.id, { lines: [{ lineId: a, acceptedQty: 10, rejectedQty: 0 }] }, admin),
      reverseQc(a),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictError);
    }
    const l = await lineRow(a);
    const after = await pm(pmA);
    // Whatever order they ran in: the register moved by exactly what the line
    // now says is accepted (before held this line's 10).
    expect(after.stockQty - (before.stockQty - 10)).toBe(l.acceptedQty);
  });
});

describe('ADR-324 — Remove a Party GRN line', () => {
  it('is refused when QC is recorded, and on the last live line', async () => {
    const { grn, a, b } = await grnWith(4, 4);
    await qcPartyGrn(grn.id, { lines: [{ lineId: a, acceptedQty: 1, rejectedQty: 0 }] }, admin);
    await expect(removeLine(a)).rejects.toThrow(/QC is recorded on Ln \d+ — Reverse QC first/);
    // B is untouched and not the last line → removed at once (one-step).
    const res = await removeLine(b);
    expect(res.cancelled).toBe(true);
    expect((await lineRow(b)).deletedAt).not.toBeNull();
    // Reverse A's QC; A is now the only line → Cancel the GRN instead.
    await reverseQc(a);
    await expect(removeLine(a)).rejects.toThrow(/is the only line — Cancel the GRN instead/);
  });
});

describe('ADR-324 — Undo an NC decision (Use As Is)', () => {
  it('takes the used-as-is pieces back out and re-opens the NC', async () => {
    const { grn, a } = await grnWith(10, 1);
    await qcPartyGrn(
      grn.id,
      { lines: [{ lineId: a, acceptedQty: 8, rejectedQty: 2, rejectReason: 'scratch' }] },
      admin,
    );
    const nc = (
      await db
        .select({ id: ncRegister.id })
        .from(ncRegister)
        .where(and(eq(ncRegister.partyGrnLineId, a), isNull(ncRegister.deletedAt)))
    )[0]!;
    const before = await pm(pmA);
    await disposeNcRegister(nc.id, { action: 'use_as_is', remarks: 'ok to use' }, admin);
    expect((await pm(pmA)).stockQty).toBe(before.stockQty + 2);
    expect((await lineRow(a)).acceptedQty).toBe(10);

    const res = await requestCancel('nc_disposition', nc.id, { reason, approveNow: true }, admin);
    expect(res.cancelled).toBe(true);
    const after = await pm(pmA);
    expect(after.stockQty).toBe(before.stockQty);
    expect(after.receivedQty).toBe(before.receivedQty);
    const l = await lineRow(a);
    expect(l.acceptedQty).toBe(8);
    expect(l.rejectedQty).toBe(2);
    const back = (await db.select().from(ncRegister).where(eq(ncRegister.id, nc.id)))[0]!;
    expect(back.status).toBe('pending');
    expect(back.disposition).toBeNull();
    expect(Number(back.clearedQty)).toBe(0);
    expect(back.closedAt).toBeNull();
    // Nothing left to undo.
    await expect(
      requestCancel('nc_disposition', nc.id, { reason, approveNow: true }, admin),
    ).rejects.toThrow(/no decision to undo/);
  });
});
