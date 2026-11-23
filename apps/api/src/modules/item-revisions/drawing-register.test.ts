// ADR-290 — Drawing Register (release status) and the Released-only rule.
// Positive asserts on TEST:
//   • a Rev first named on an SO line is draft ("Not released");
//   • submit without a drawing file is refused;
//   • Plan / PRO on a draft Rev are refused with the standard sentence; a PRO
//     on an old (unverified) Rev is allowed;
//   • submit → approve → release stores the file's SHA-256 and supersedes the
//     lower released Rev of the item;
//   • two approves at the same moment → exactly one wins, the other is 409
//     (CLAUDE.md §20.2);
//   • release without the "Can release drawings" switch → 403;
//   • Replace drawing on a released Rev files ONE correction; the file changes
//     only when the correction is approved (new hash stored);
//   • drawing history refuses UPDATE (append-only trigger, 0248);
//   • the register list and its Sort & Filter;
//   • the BOM cascade on a draft child Rev still runs (exempt).
// Runs on TEST only, on its own (no global setup): prefix TDRG-. Uploads three
// small files to the drawings bucket and removes them afterwards.

import { createHash } from 'node:crypto';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  bomMasterLines,
  bomMasterRevisions,
  bomMasters,
  drawingCorrections,
  itemRevisionDrawings,
  itemRevisions,
  items,
  jcOps,
  jobCards,
  plans,
  productionOrders,
  purchaseRequests,
  routeCardOps,
  routeCards,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, ValidationError } from '../../lib/errors';
import { replaceItemRevisionDrawing, resolveItemRevision } from '../../lib/item-revision';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { asAccess } from '../../lib/test-access';
import { cascadeBomToSoLine } from '../bom-master/cascade';
import * as bomService from '../bom-master/service';
import * as planService from '../plans/service';
import * as proService from '../production-orders/service';
import { decideDrawingCorrection } from './corrections';
import { listDrawingRegister } from './register';
import { revStatusAction } from './release';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TDRG-';
const BUCKET = 'qc-docs';

let admin: AuthContext;
let companyId: string;
let itemId: string;
let parentId: string;
const FILE1 = Buffer.from(`drawing one ${'x'.repeat(50)}`);
const FILE2 = Buffer.from(`drawing two ${'y'.repeat(50)}`);
let path1: string;
let path2: string;
let path3: string;
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function cleanup(): Promise<void> {
  const its = await db
    .select({ id: items.id })
    .from(items)
    .where(like(items.code, `${P}%`));
  const ids = its.map((i) => i.id);
  if (ids.length === 0) return;
  const jcs = await db
    .select({ id: jobCards.id })
    .from(jobCards)
    .where(inArray(jobCards.itemId, ids));
  const jcIds = jcs.map((j) => j.id);
  if (jcIds.length > 0) {
    await db.update(plans).set({ jcId: null }).where(inArray(plans.itemId, ids));
    await db.update(jobCards).set({ productionOrderId: null }).where(inArray(jobCards.id, jcIds));
  }
  await db.delete(productionOrders).where(like(productionOrders.planCodeText, `${P}%`));
  if (jcIds.length > 0) {
    await db.delete(jcOps).where(inArray(jcOps.jobCardId, jcIds));
    await db.delete(jobCards).where(inArray(jobCards.id, jcIds));
  }
  await db.delete(purchaseRequests).where(inArray(purchaseRequests.itemId, ids));
  await db.delete(plans).where(inArray(plans.itemId, ids));
  await db.delete(salesOrders).where(like(salesOrders.code, `${P}%`));
  const boms = await db
    .select({ id: bomMasters.id })
    .from(bomMasters)
    .where(like(bomMasters.bomName, `${P}%`));
  if (boms.length > 0) {
    const bomIds = boms.map((b) => b.id);
    await db.delete(bomMasterLines).where(inArray(bomMasterLines.bomMasterId, bomIds));
    await db.delete(bomMasterRevisions).where(inArray(bomMasterRevisions.bomMasterId, bomIds));
    await db.delete(bomMasters).where(inArray(bomMasters.id, bomIds));
  }
  const cards = await db
    .select({ id: routeCards.id })
    .from(routeCards)
    .where(like(routeCards.code, `${P}%`));
  if (cards.length > 0) {
    await db.delete(routeCardOps).where(
      inArray(
        routeCardOps.routeCardId,
        cards.map((c) => c.id),
      ),
    );
    await db.delete(routeCards).where(like(routeCards.code, `${P}%`));
  }
  const revs = await db
    .select({ id: itemRevisions.id })
    .from(itemRevisions)
    .where(inArray(itemRevisions.itemId, ids));
  const revIds = revs.map((r) => r.id);
  if (revIds.length > 0) {
    await db.delete(drawingCorrections).where(inArray(drawingCorrections.itemRevisionId, revIds));
    await db.delete(activityLog).where(inArray(activityLog.entityId, revIds));
    // No user claims on this session → the append-only trigger lets a purge through.
    await db
      .delete(itemRevisionDrawings)
      .where(inArray(itemRevisionDrawings.itemRevisionId, revIds));
    await db.delete(itemRevisions).where(inArray(itemRevisions.id, revIds));
  }
  await db.delete(items).where(inArray(items.id, ids));
}

const newRev = (rev: string, file: string | null) =>
  withUserContext(admin, (tx) =>
    resolveItemRevision(tx, admin, companyId, {
      itemId,
      rev,
      drawingFilePath: file,
      sourceType: 'so_line',
      sourceRef: `${P}SO ln 1`,
    }),
  );

async function revRow(id: string) {
  return (await db.select().from(itemRevisions).where(eq(itemRevisions.id, id)))[0]!;
}

async function act(
  id: string,
  action: 'submit' | 'approve' | 'reject' | 'release' | 'obsolete',
  note?: string,
  user: AuthContext = admin,
): Promise<void> {
  const r = await revRow(id);
  await revStatusAction(id, action, { expectedUpdatedAt: r.updatedAt.toISOString(), note }, user);
}

async function makeCard(key: string, revId: string): Promise<string> {
  const [rc] = await db
    .insert(routeCards)
    .values({
      companyId,
      code: `${P}RC-${key}`,
      itemId,
      itemRevisionId: revId,
      approvalStatus: 'approved',
      rawMaterialGradeText: 'EN8',
      rawMaterialSizeText: 'DIA 40',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: routeCards.id });
  await db.insert(routeCardOps).values({
    companyId,
    routeCardId: rc!.id,
    opSeq: 10,
    operation: 'Turning',
    opType: 'process',
    createdBy: admin.id,
    updatedBy: admin.id,
  });
  return rc!.id;
}

async function makePlan(key: string, revId: string): Promise<string> {
  const [pl] = await db
    .insert(plans)
    .values({
      companyId,
      code: `${P}PLN-${key}`,
      planDate: '2026-11-14',
      planStatus: 'planned',
      planType: 'manufacture',
      opsSource: 'route_card',
      itemId,
      itemRevisionId: revId,
      itemCodeText: `${P}X`,
      orderQty: 5,
      planQty: 5,
      rawMaterialGradeText: 'EN8',
      rawMaterialSizeText: 'DIA 40',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: plans.id });
  return pl!.id;
}

async function makeSoLine(
  key: string,
  item: string,
  revId: string | null,
  bomId?: string,
): Promise<string> {
  const [so] = await db
    .insert(salesOrders)
    .values({
      companyId,
      code: `${P}SO-${key}`,
      soDate: '2026-11-14',
      status: 'open',
      type: 'component_manufacturing',
      gstPercent: '18.00',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: salesOrders.id });
  const [line] = await db
    .insert(salesOrderLines)
    .values({
      companyId,
      salesOrderId: so!.id,
      lineNo: 1,
      itemId: item,
      partName: 'part',
      orderQty: 5,
      rate: '0',
      status: 'open',
      itemRevisionId: revId,
      sourceBomMasterId: bomId ?? null,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: salesOrderLines.id });
  return line!.id;
}

const raisePro = (planId: string, routeCardId: string) =>
  proService.createProductionOrder(
    { planId, routeCardId, targetDate: '2026-11-30', orderQty: 2, rawMaterialAvailable: true },
    admin,
  );

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await cleanup();
  const mk = async (code: string): Promise<string> =>
    (
      await db
        .insert(items)
        .values({
          companyId,
          code,
          name: 'Drawing Register test part',
          revision: 'A',
          uom: 'NOS',
          itemType: 'component',
          procurementType: 'make',
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning({ id: items.id })
    )[0]!.id;
  itemId = await mk(`${P}X`);
  parentId = await mk(`${P}PARENT`);
  const stamp = Date.now();
  path1 = `${companyId}/drawings/${P}one-${stamp}.pdf`;
  path2 = `${companyId}/drawings/${P}two-${stamp}.pdf`;
  path3 = `${companyId}/drawings/${P}three-${stamp}.pdf`;
  for (const [p, b] of [
    [path1, FILE1],
    [path2, FILE2],
    [path3, FILE2],
  ] as const) {
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(p, b, { contentType: 'application/pdf' });
    if (error) throw error;
  }
}, 120_000);

afterAll(async () => {
  await cleanup();
  await supabaseAdmin.storage.from(BUCKET).remove([path1, path2, path3]);
}, 120_000);

describe('ADR-290 Drawing Register', () => {
  let r1: string;
  let r2: string;

  it('a new Rev named on an SO line is draft', async () => {
    r1 = (await newRev('1', null))!.id;
    expect((await revRow(r1)).releaseStatus).toBe('draft');
  });

  it('submit without a drawing file is refused', async () => {
    await expect(act(r1, 'submit')).rejects.toThrow(
      'Upload the drawing before sending it for review',
    );
  });

  it('Plan and PRO on a draft Rev are refused with the standard sentence', async () => {
    const line = await makeSoLine('D', itemId, r1);
    const plan = planService.createPlan(
      {
        planDate: '2026-11-14',
        planType: 'manufacture',
        soLineId: line,
        itemId,
        orderQty: 2,
        planQty: 2,
        opsSource: 'route_card',
      } as never,
      admin,
    );
    await expect(plan).rejects.toBeInstanceOf(ValidationError);
    await expect(plan).rejects.toThrow(`${P}X/1 is Not released — Design must release it`);
    const pro = raisePro(await makePlan('D', r1), await makeCard('D', r1));
    await expect(pro).rejects.toThrow(`${P}X/1 is Not released`);
  });

  it('a PRO on an old (unverified) Rev is allowed', async () => {
    const [u] = await db
      .insert(itemRevisions)
      .values({
        companyId,
        itemId,
        rev: '9',
        sourceType: 'legacy',
        sourceRef: P,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: itemRevisions.id });
    expect((await revRow(u!.id)).releaseStatus).toBe('unverified');
    const pro = await raisePro(await makePlan('U', u!.id), await makeCard('U', u!.id));
    expect(pro.id).toBeTruthy();
  });

  it('submit → approve → release stores the file hash', async () => {
    await withUserContext(admin, (tx) =>
      replaceItemRevisionDrawing(tx, admin, companyId, r1, {
        drawingFilePath: path1,
        reason: 'first file',
      }),
    );
    // ADR-311 — the first file moves the Rev straight to Under Review (no submit).
    expect((await revRow(r1)).releaseStatus).toBe('under_review');
    await act(r1, 'approve');
    await act(r1, 'release');
    const row = await revRow(r1);
    expect(row.releaseStatus).toBe('released');
    expect(row.fileHash).toBe(sha(FILE1));
    expect(row.releasedBy).toBe(admin.id);
  });

  it('releasing Rev 2 supersedes released Rev 1; lookup names the latest', async () => {
    r2 = (await newRev('2', path2))!.id;
    expect((await revRow(r2)).releaseStatus).toBe('under_review'); // ADR-311
    await act(r2, 'approve');
    await act(r2, 'release');
    expect((await revRow(r2)).releaseStatus).toBe('released');
    expect((await revRow(r1)).releaseStatus).toBe('superseded');
    const look = await service.lookupItemRevision({ itemId, rev: '1' }, admin);
    expect(look.release?.latestReleasedLabel).toBe(`${P}X/2`);
  });

  it('two approves at the same moment → exactly one wins, the other is 409 (§20.2)', async () => {
    const r = (await newRev('3', path3))!.id; // born with a file → Under Review (ADR-311)
    const res = await Promise.allSettled([act(r, 'approve'), act(r, 'approve')]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = res.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    expect(String((lost.reason as Error).message)).toMatch(/is Approved/);
    expect((await revRow(r)).releaseStatus).toBe('approved');
  });

  it('release without the "Can release drawings" switch → 403', async () => {
    const r = (await newRev('4', path3))!.id; // born with a file → Under Review (ADR-311)
    await act(r, 'approve');
    const designer = asAccess(admin, { departments: { design: 'L5' } }, 'manager');
    await expect(act(r, 'release', undefined, designer)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect((await revRow(r)).releaseStatus).toBe('approved');
  });

  it('Replace drawing on a released Rev files ONE correction; the file changes only on approve', async () => {
    const before = await revRow(r2);
    await withUserContext(admin, (tx) =>
      replaceItemRevisionDrawing(tx, admin, companyId, r2, {
        drawingFilePath: path1,
        reason: 'hole moved',
      }),
    );
    expect((await revRow(r2)).drawingFilePath).toBe(before.drawingFilePath);
    const again = withUserContext(admin, (tx) =>
      replaceItemRevisionDrawing(tx, admin, companyId, r2, {
        drawingFilePath: path3,
        reason: 'second try',
      }),
    );
    await expect(again).rejects.toThrow(`A correction for ${P}X/2 is already waiting`);
    const detail = await service.getItemRevision(r2, admin);
    expect(detail.corrections).toHaveLength(1);
    expect(detail.corrections[0]!.status).toBe('pending');
    // ADR-311 — self-approval allowed: the requester approves their own correction.
    await decideDrawingCorrection(detail.corrections[0]!.id, { decision: 'approve' }, admin);
    const after = await revRow(r2);
    expect(after.drawingFilePath).toBe(path1);
    expect(after.fileHash).toBe(sha(FILE1));
    expect(after.releaseStatus).toBe('released');
  });

  it('drawing history refuses UPDATE (append-only trigger)', async () => {
    await expect(
      db.execute(
        sql`UPDATE public.item_revision_drawings SET reason = 'x' WHERE item_revision_id = ${r1}::uuid`,
      ),
    ).rejects.toThrow(/history — rows are never changed/);
  });

  it('register list: status, open lines, Sort & Filter', async () => {
    const reg = await listDrawingRegister({ search: `${P}X`, limit: 25, offset: 0 }, admin);
    const one = reg.items.find((x) => x.id === r1);
    expect(one?.releaseStatus).toBe('superseded');
    expect(one?.openLines).toBe(1);
    expect(reg.items.find((x) => x.id === r2)?.releaseStatus).toBe('released');
    const sorted = await listDrawingRegister(
      {
        search: `${P}X`,
        sf: JSON.stringify({ sort: { field: 'openLines', dir: 'desc' }, filters: [] }),
        limit: 25,
        offset: 0,
      },
      admin,
    );
    expect(sorted.total).toBe(reg.total);
    expect(sorted.items[0]!.openLines).toBeGreaterThanOrEqual(1);
  });

  it('the BOM cascade on a draft child Rev still runs (exempt)', async () => {
    const bom = await bomService.createBomMaster(
      {
        bomName: `${P}BOM`,
        parentItemId: parentId,
        lines: [
          { childItemId: itemId, childDrawingRev: '7', qtyPerSet: 1, bomType: 'manufacture' },
        ],
      },
      admin,
    );
    const childRev = bom.lines[0]!.childItemRevisionId!;
    expect((await revRow(childRev)).releaseStatus).toBe('draft');
    const line = await makeSoLine('B', parentId, null, bom.id);
    const res = await withUserContext(admin, (tx) => cascadeBomToSoLine(tx, line, admin));
    expect(res.fired).toBe(true);
    expect(res.createdJobCardCodes).toHaveLength(1);
  });
});
