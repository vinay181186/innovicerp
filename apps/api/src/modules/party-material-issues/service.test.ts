// Party Material Issue guards — ADR-079 (stock availability) + ADR-103 (job
// card compulsory, client + part identity, per-JWSO-line limit, job-card qty
// cap, and cancel with its already-machined guard).
//
// Fixtures are inserted directly and prefixed T103- so the guards are exercised
// deterministically without depending on seed documents. Shape mirrors the real
// flow: one client, a JWSO with ONE line, a Party GRN receiving material for
// that line, a Job Card on the line, and a party material pinned to the
// client + the line's item. A second material on a DIFFERENT item gives the
// wrong-part case.

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
  opLog,
  partyGrn,
  partyGrnLines,
  partyMaterialIssues,
  partyMaterials,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { NotFoundError, ValidationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TAG = `T103-${String(Date.now()).slice(-6)}`;
const RECEIVED = 10;
const JC_QTY = 10;

let admin: AuthContext;
let clientId: string;
let otherClientId: string;
let itemAId: string;
let itemBId: string;
let jwId: string;
let jwLineId: string;
let jcId: string;
let firstOpId: string;
let grnId: string;
/** Pinned to clientId + itemA — the correct material. */
let pmId: string;
/** Pinned to clientId + itemB — right client, WRONG part. */
let pmWrongPartId: string;
/** Pinned to otherClient + itemA — WRONG client. */
let pmWrongClientId: string;

const issueIds: string[] = [];

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u?.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  const companyId = u.companyId;

  const cs = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.companyId, companyId), isNull(clients.deletedAt)))
    .orderBy(asc(clients.createdAt))
    .limit(2);
  if (cs.length < 2) throw new Error('Need 2 clients in the seed company');
  clientId = cs[0]!.id;
  otherClientId = cs[1]!.id;

  const its = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.companyId, companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')))
    .orderBy(asc(items.createdAt))
    .limit(2);
  if (its.length < 2) throw new Error('Need 2 items in the seed company');
  itemAId = its[0]!.id;
  itemBId = its[1]!.id;

  jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId,
        code: `${TAG}-JW`,
        jwDate: '2026-08-05',
        clientId,
        customerName: 'ADR-103 test client',
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
        itemId: itemAId,
        partName: `${TAG}-PART-A`,
        uom: 'NOS',
        orderQty: JC_QTY,
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobWorkOrderLines.id })
  )[0]!.id;

  jcId = (
    await db
      .insert(jobCards)
      .values({
        companyId,
        code: `${TAG}-JC`,
        jcDate: '2026-08-05',
        itemId: itemAId,
        orderQty: JC_QTY,
        priority: 'normal',
        sourceJwLineId: jwLineId,
        clientMaterialGate: true,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobCards.id })
  )[0]!.id;

  firstOpId = (
    await db
      .insert(jcOps)
      .values({
        companyId,
        jobCardId: jcId,
        opSeq: 1,
        operation: `${TAG}-TURNING`,
        opType: 'process',
        cycleTimeMin: '0.00',
        qcRequired: false,
        reworkQty: 0,
        outsourceCost: '0.00',
        outsourceSentQty: 0,
        outsourceReturnedQty: 0,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jcOps.id })
  )[0]!.id;

  // Material received for line 1 — the per-line ceiling.
  grnId = (
    await db
      .insert(partyGrn)
      .values({
        companyId,
        code: `${TAG}-PGRN`,
        grnDate: '2026-08-05',
        jobWorkOrderId: jwId,
        jwCodeText: `${TAG}-JW`,
        clientId,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: partyGrn.id })
  )[0]!.id;

  const mk = async (code: string, cid: string, iid: string, stock: number): Promise<string> =>
    (
      await db
        .insert(partyMaterials)
        .values({
          companyId,
          code,
          name: `${code} material`,
          uom: 'NOS',
          clientId: cid,
          itemId: iid,
          stockQty: stock,
          receivedQty: stock,
          issuedQty: 0,
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning({ id: partyMaterials.id })
    )[0]!.id;

  pmId = await mk(`${TAG}-PM-A`, clientId, itemAId, RECEIVED);
  pmWrongPartId = await mk(`${TAG}-PM-B`, clientId, itemBId, RECEIVED);
  pmWrongClientId = await mk(`${TAG}-PM-C`, otherClientId, itemAId, RECEIVED);

  await db.insert(partyGrnLines).values({
    companyId,
    partyGrnId: grnId,
    lineNo: 1,
    partyMaterialId: pmId,
    partyMaterialCodeText: `${TAG}-PM-A`,
    receivedQty: RECEIVED,
    jwLineNoText: '1',
    createdBy: admin.id,
    updatedBy: admin.id,
  });
});

afterAll(async () => {
  await db.delete(partyMaterialIssues).where(eq(partyMaterialIssues.jobWorkOrderId, jwId));
  await db.delete(partyGrnLines).where(eq(partyGrnLines.partyGrnId, grnId));
  await db.delete(partyGrn).where(eq(partyGrn.id, grnId));
  await db.delete(opLog).where(eq(opLog.jcOpId, firstOpId));
  await db.delete(jcOps).where(eq(jcOps.jobCardId, jcId));
  await db.delete(jobCards).where(eq(jobCards.id, jcId));
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.id, jwLineId));
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
  for (const id of [pmId, pmWrongPartId, pmWrongClientId]) {
    await db.delete(partyMaterials).where(eq(partyMaterials.id, id));
  }
});

const base = { issueDate: '2026-08-05', jobWorkOrderId: () => jwId, jobCardId: () => jcId };

describe('party-material-issues — ADR-103 guards', () => {
  it('rejects an issue with no job card', async () => {
    // The zod schema now requires it; the service guard is what a stale client
    // or a direct API caller would hit.
    await expect(
      service.createPartyMaterialIssue(
        {
          issueDate: base.issueDate,
          jobWorkOrderId: jwId,
          partyMaterialId: pmId,
          qty: 1,
        } as never,
        admin,
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it("rejects a material belonging to a different client", async () => {
    await expect(
      service.createPartyMaterialIssue(
        {
          issueDate: base.issueDate,
          jobWorkOrderId: jwId,
          jobCardId: jcId,
          partyMaterialId: pmWrongClientId,
          qty: 1,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a material that is not the job card's part", async () => {
    await expect(
      service.createPartyMaterialIssue(
        {
          issueDate: base.issueDate,
          jobWorkOrderId: jwId,
          jobCardId: jcId,
          partyMaterialId: pmWrongPartId,
          qty: 1,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects more than was received for this JWSO line', async () => {
    await expect(
      service.createPartyMaterialIssue(
        {
          issueDate: base.issueDate,
          jobWorkOrderId: jwId,
          jobCardId: jcId,
          partyMaterialId: pmId,
          qty: RECEIVED + 1,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('issues within the limits and draws down party stock', async () => {
    const issue = await service.createPartyMaterialIssue(
      {
        issueDate: base.issueDate,
        jobWorkOrderId: jwId,
        jobCardId: jcId,
        partyMaterialId: pmId,
        qty: RECEIVED,
      },
      admin,
    );
    issueIds.push(issue.id);
    expect(issue.qty).toBe(RECEIVED);
    expect(issue.jobCardId).toBe(jcId);

    const pm = (await db.select().from(partyMaterials).where(eq(partyMaterials.id, pmId)))[0]!;
    expect(pm.stockQty).toBe(0);
    expect(pm.issuedQty).toBe(RECEIVED);
  });

  it('rejects a further issue once the job card already has all it needs', async () => {
    // Put stock back on the material so the failure can only come from the
    // job-card cap, not from the stock check.
    await db.update(partyMaterials).set({ stockQty: 5 }).where(eq(partyMaterials.id, pmId));
    await expect(
      service.createPartyMaterialIssue(
        {
          issueDate: base.issueDate,
          jobWorkOrderId: jwId,
          jobCardId: jcId,
          partyMaterialId: pmId,
          qty: 1,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.update(partyMaterials).set({ stockQty: 0 }).where(eq(partyMaterials.id, pmId));
  });
});

describe('party-material-issues — cancel (ADR-103)', () => {
  it('requires a reason', async () => {
    await expect(
      service.cancelPartyMaterialIssue(issueIds[0]!, '   ', admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(
      service.cancelPartyMaterialIssue('00000000-0000-0000-0000-000000000000', 'x', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to cancel material that has already been machined', async () => {
    await db.insert(opLog).values({
      companyId: admin.companyId!,
      jcOpId: firstOpId,
      logNo: `${TAG}-L1`,
      logType: 'complete',
      logDate: '2026-08-05',
      shift: 'day',
      qty: RECEIVED,
      createdBy: admin.id,
    });
    await expect(
      service.cancelPartyMaterialIssue(issueIds[0]!, 'wrong qty', admin),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.delete(opLog).where(eq(opLog.jcOpId, firstOpId));
  });

  it('cancels an unconsumed issue and puts the qty back on party stock', async () => {
    const before = (await db.select().from(partyMaterials).where(eq(partyMaterials.id, pmId)))[0]!;
    const res = await service.cancelPartyMaterialIssue(issueIds[0]!, 'entered twice', admin);
    expect(res.reversedQty).toBe(RECEIVED);

    const after = (await db.select().from(partyMaterials).where(eq(partyMaterials.id, pmId)))[0]!;
    expect(after.stockQty).toBe(before.stockQty + RECEIVED);
    expect(after.issuedQty).toBe(before.issuedQty - RECEIVED);

    const row = (
      await db
        .select({ deletedAt: partyMaterialIssues.deletedAt, remarks: partyMaterialIssues.remarks })
        .from(partyMaterialIssues)
        .where(eq(partyMaterialIssues.id, issueIds[0]!))
    )[0]!;
    expect(row.deletedAt).not.toBeNull();
    expect(row.remarks).toContain('[Cancelled] entered twice');
  });
});
