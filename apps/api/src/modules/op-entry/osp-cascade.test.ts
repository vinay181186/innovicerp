// OSP auto-PR generation tests (ADR-039).
//
// Two layers:
//   - matchOspProcess: pure substring-match logic (no DB), the trickiest bit.
//   - generateOspPr: integration against the dev DB — creates a JC with a few
//     outsource ops + two OSP processes, then exercises no-match / PR-only /
//     PR+PO / duplicate. The dev DB is slow under DLP, so the integration
//     tests carry generous per-test timeouts.

import { and, asc, eq, inArray, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  items,
  jcOps,
  jobCards,
  ospProcesses,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
  users,
  vendors,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
import { matchOspProcess } from './osp-cascade';
import * as service from './service';

describe('matchOspProcess (pure)', () => {
  const cfg = [
    { processName: 'Coating' },
    { processName: 'Heat Treatment' },
    { processName: 'Painting' },
  ];

  it('matches when a process name is a substring of the op name (case-insensitive)', () => {
    expect(matchOspProcess('Powder Coating', cfg)?.processName).toBe('Coating');
    expect(matchOspProcess('spray painting finish', cfg)?.processName).toBe('Painting');
    expect(matchOspProcess('HEAT TREATMENT - stage 2', cfg)?.processName).toBe('Heat Treatment');
  });

  it('returns the first configured match in order', () => {
    // "Coating" appears before "Painting" in the config; an op mentioning both
    // resolves to the first.
    expect(matchOspProcess('coating then painting', cfg)?.processName).toBe('Coating');
  });

  it('returns null when nothing matches or input is empty', () => {
    expect(matchOspProcess('CNC Turning', cfg)).toBeNull();
    expect(matchOspProcess('', cfg)).toBeNull();
    expect(matchOspProcess(null, cfg)).toBeNull();
    expect(matchOspProcess('Coating', [])).toBeNull();
  });
});

const TEST_PREFIX = 'TOSP-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let itemId: string;
let vendorId: string;
let jcId: string;
let opCoatingId: string; // matches "Coating" (no-vendor process) → PR only
let opPaintingId: string; // matches "Painting" (vendor + autoPo) → PR + draft PO
let opNoMatchId: string; // matches nothing → ValidationError
// Generated rows to clean up (auto codes use the real IN-JWPR-/IN-JWPO- series,
// so we delete by captured id, never by prefix).
const createdPrIds: string[] = [];
const createdPoIds: string[] = [];
const createdCodes: string[] = [];

describe('generateOspPr (integration)', () => {
  beforeAll(async () => {
    const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
    if (!u || !u.companyId) throw new Error('Seed admin missing');
    admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

    const v = (
      await db
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
        .limit(1)
    )[0];
    if (!v) throw new Error('Seed vendor missing');
    vendorId = v.id;

    itemId = (
      await db
        .insert(items)
        .values({
          companyId: u.companyId,
          code: `${TEST_PREFIX}ITEM`,
          name: 'OSP Test Item',
          revision: 'A',
          uom: 'NOS',
          itemType: 'component',
          createdBy: u.id,
          updatedBy: u.id,
        })
        .returning()
    )[0]!.id;

    jcId = (
      await db
        .insert(jobCards)
        .values({
          companyId: u.companyId,
          code: `${TEST_PREFIX}JC-001`,
          jcDate: '2026-06-01',
          itemId,
          orderQty: 10,
          priority: 'normal',
          createdBy: u.id,
          updatedBy: u.id,
        })
        .returning()
    )[0]!.id;

    const baseOp = {
      companyId: u.companyId,
      jobCardId: jcId,
      opType: 'outsource' as const,
      cycleTimeMin: '0.00',
      qcRequired: false,
      reworkQty: 0,
      outsourceCost: '0.00',
      outsourceSentQty: 0,
      outsourceReturnedQty: 0,
      createdBy: u.id,
      updatedBy: u.id,
    };
    // Op names embed the prefixed process names so the substring matcher hits
    // our test-only OSP processes (named with TEST_PREFIX for clean teardown)
    // and never a real one.
    const ops = await db
      .insert(jcOps)
      .values([
        { ...baseOp, opSeq: 1, operation: `${TEST_PREFIX}Coating finish` },
        { ...baseOp, opSeq: 2, operation: `${TEST_PREFIX}Painting stage` },
        { ...baseOp, opSeq: 3, operation: 'CNC Deburring' },
      ])
      .returning();
    opCoatingId = ops.find((o) => o.opSeq === 1)!.id;
    opPaintingId = ops.find((o) => o.opSeq === 2)!.id;
    opNoMatchId = ops.find((o) => o.opSeq === 3)!.id;

    // OSP processes: "Coating" (no vendor) + "Painting" (vendor + autoPo).
    await db.insert(ospProcesses).values([
      {
        companyId: u.companyId,
        processName: `${TEST_PREFIX}Coating`,
        vendorId: null,
        autoPo: false,
        leadDays: 5,
        createdBy: u.id,
        updatedBy: u.id,
      },
      {
        companyId: u.companyId,
        processName: `${TEST_PREFIX}Painting`,
        vendorId,
        autoPo: true,
        leadDays: 7,
        createdBy: u.id,
        updatedBy: u.id,
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    // PO lines → POs → PRs → ops → jc → item → osp processes → activity log.
    if (createdPoIds.length > 0) {
      await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, createdPoIds));
      await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, createdPoIds));
    }
    if (createdPrIds.length > 0) {
      await db.delete(purchaseRequests).where(inArray(purchaseRequests.id, createdPrIds));
    }
    await db.delete(jcOps).where(eq(jcOps.jobCardId, jcId));
    await db.delete(jobCards).where(eq(jobCards.id, jcId));
    await db.delete(items).where(eq(items.id, itemId));
    await db.delete(ospProcesses).where(like(ospProcesses.processName, `${TEST_PREFIX}%`));
    if (createdCodes.length > 0) {
      await db.delete(activityLog).where(inArray(activityLog.refId, createdCodes));
    }
  }, 180_000);

  it('throws ValidationError when the op matches no configured OSP process', async () => {
    await expect(service.generateOspPr({ jcOpId: opNoMatchId }, admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  }, 180_000);

  it('creates a PR only (no vendor / autoPo off) and links the op as pr_raised', async () => {
    const res = await service.generateOspPr({ jcOpId: opCoatingId }, admin);
    createdPrIds.push(res.prId);
    createdCodes.push(res.prCode);
    expect(res.autoPoCreated).toBe(false);
    expect(res.poId).toBeNull();
    expect(res.prCode).toMatch(/^IN-JWPR-\d{5}$/);

    const pr = (await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, res.prId)))[0]!;
    expect(pr.prType).toBe('jw_osp');
    expect(pr.status).toBe('open');
    expect(pr.sourceJcOpId).toBe(opCoatingId);
    expect(pr.vendorId).toBeNull();
    expect(pr.vendorCodeText).toBeTruthy(); // sentinel so vendor_check passes

    const op = (await db.select().from(jcOps).where(eq(jcOps.id, opCoatingId)))[0]!;
    expect(op.outsourcePrId).toBe(res.prId);
    expect(op.outsourceStatus).toBe('pr_raised');
  }, 180_000);

  it('creates a PR + draft PO when the process has a vendor + autoPo', async () => {
    const res = await service.generateOspPr({ jcOpId: opPaintingId }, admin);
    createdPrIds.push(res.prId);
    if (res.poId) createdPoIds.push(res.poId);
    createdCodes.push(res.prCode);
    if (res.poCode) createdCodes.push(res.poCode);

    expect(res.autoPoCreated).toBe(true);
    expect(res.poId).not.toBeNull();
    expect(res.poCode).toMatch(/^IN-JWPO-\d{5}$/);

    const pr = (await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, res.prId)))[0]!;
    expect(pr.status).toBe('po_created'); // React PR→PO invariant
    expect(pr.poId).toBe(res.poId);

    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, res.poId!)))[0]!;
    expect(po.status).toBe('draft');
    expect(po.poType).toBe('job_work');
    expect(po.vendorId).toBe(vendorId);

    const op = (await db.select().from(jcOps).where(eq(jcOps.id, opPaintingId)))[0]!;
    expect(op.outsourceStatus).toBe('po_created');
    expect(op.outsourcePoLineId).not.toBeNull();

    // New-ERP enhancement (beyond legacy): the OSP PO activity entry carries the
    // JC code + "OSP", so the JC completion feed (matched by detail ILIKE
    // '%<jc.code>%' AND '%OSP%') can now trace the PO event — osp-cascade.ts:303.
    const poAct = (
      await db.select().from(activityLog).where(eq(activityLog.refId, res.poCode!))
    )[0]!;
    expect(poAct.entity).toBe('PurchaseOrder');
    expect(poAct.detail).toContain(`${TEST_PREFIX}JC-001`);
    expect(poAct.detail).toContain('OSP');
    // Regression guard: PR activity still carries the JC code (unchanged path).
    const prAct = (
      await db.select().from(activityLog).where(eq(activityLog.refId, res.prCode))
    )[0]!;
    expect(prAct.entity).toBe('PurchaseRequest');
    expect(prAct.detail).toContain(`${TEST_PREFIX}JC-001`);
  }, 180_000);

  it('rejects a second generation on the same op (ConflictError)', async () => {
    await expect(service.generateOspPr({ jcOpId: opCoatingId }, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  }, 180_000);
});
