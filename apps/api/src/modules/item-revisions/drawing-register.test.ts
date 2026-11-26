// ADR-323 — Drawing Register: Unverified / Verified / Obsolete, one Verify.
// Positive asserts on TEST:
//   • a Rev first named on an SO line is Unverified; its first file keeps it
//     Unverified (no automatic step);
//   • Verify without a drawing file is refused; Verify stores the file's
//     SHA-256 and Verified On / By; a file replaced since the screen loaded
//     (expectedDrawingFilePath) → 409 "The drawing changed";
//   • two Verifies at the same moment → exactly one wins, the other is 409
//     (CLAUDE.md §20.2);
//   • Replace drawing on a Verified Rev: a DIFFERENT file → Unverified (hash
//     and Verified On / By cleared); the SAME file (same hash) → stays Verified;
//   • Unverify / Obsolete need a reason; PRO on an Obsolete Rev is refused with
//     the standard sentence, on an Unverified Rev it is allowed;
//   • Home › Approvals lists an Unverified Rev WITH a PDF on an open SO line
//     ("Drawing to verify") and drops it once Verified;
//   • a NEW Route Card needs the Rev in the register (else refused) WITH a PDF
//     (else refused);
//   • drawing history refuses UPDATE (append-only trigger, 0248);
//   • the register list, its status / PDF filters and Sort & Filter;
//   • the BOM cascade on an Unverified child Rev still runs.
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
import type { RevStatusAction } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
import { replaceItemRevisionDrawing, resolveItemRevision } from '../../lib/item-revision';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { cascadeBomToSoLine } from '../bom-master/cascade';
import { getWaitingApprovals } from '../approvals/waiting';
import * as bomService from '../bom-master/service';
import * as proService from '../production-orders/service';
import * as rcService from '../route-cards/service';
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
  action: RevStatusAction,
  note?: string,
  expectedDrawingFilePath?: string,
): Promise<void> {
  const r = await revRow(id);
  await revStatusAction(
    id,
    action,
    { expectedUpdatedAt: r.updatedAt.toISOString(), note, expectedDrawingFilePath },
    admin,
  );
}

/** Replace drawing the way the route does it (new file hashed first). */
const replaceVia = async (id: string, file: string, reason = 'customer sent a new scan') =>
  service.replaceDrawing(
    id,
    {
      drawingFilePath: file,
      reason,
      expectedUpdatedAt: (await revRow(id)).updatedAt.toISOString(),
    },
    admin,
  );

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

describe('ADR-323 Drawing Register', () => {
  let r1: string;
  let r2: string;

  it('a new Rev named on an SO line is Unverified; its first file keeps it Unverified', async () => {
    r1 = (await newRev('1', null))!.id;
    expect((await revRow(r1)).releaseStatus).toBe('unverified');
    r2 = (await newRev('2', path2))!.id;
    expect((await revRow(r2)).releaseStatus).toBe('unverified');
    expect((await revRow(r2)).drawingFilePath).toBe(path2);
  });

  it('Verify without a drawing file is refused', async () => {
    await expect(act(r1, 'verify')).rejects.toThrow('Upload the drawing PDF before verifying it');
    expect((await revRow(r1)).releaseStatus).toBe('unverified');
  });

  it('a PRO on an Unverified Rev is allowed; on an Obsolete Rev it is refused', async () => {
    const pro = await raisePro(await makePlan('U', r1), await makeCard('U', r1));
    expect(pro.id).toBeTruthy();
    const [o] = await db
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
    const plan = await makePlan('O', o!.id);
    const card = await makeCard('O', o!.id);
    await expect(act(o!.id, 'obsolete', 'no')).rejects.toThrow('Reason is required');
    await act(o!.id, 'obsolete', 'customer withdrew it');
    expect((await revRow(o!.id)).releaseStatus).toBe('obsolete');
    await expect(raisePro(plan, card)).rejects.toThrow(
      `${P}X/9 is Obsolete — pick another Drawing Rev for Plan, PRO or Job Card.`,
    );
  });

  it('Verify refused when the drawing changed since it was opened (expectedDrawingFilePath)', async () => {
    const err = await act(r2, 'verify', undefined, path1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toBe('The drawing changed — open it again before verifying.');
    expect((await revRow(r2)).releaseStatus).toBe('unverified');
  });

  it('Verify stores the file hash and Verified On / By', async () => {
    await act(r2, 'verify', undefined, path2);
    const row = await revRow(r2);
    expect(row.releaseStatus).toBe('verified');
    expect(row.fileHash).toBe(sha(FILE2));
    expect(row.releasedBy).toBe(admin.id);
    expect(row.releasedAt).not.toBeNull();
    const look = await service.lookupItemRevision({ itemId, rev: '1' }, admin);
    expect(look.release?.latestReleasedLabel).toBe(`${P}X/2`);
    const detail = await service.getItemRevision(r2, admin);
    expect(detail.verifiedBy).toBe(admin.id);
    expect(detail.releaseStatus).toBe('verified');
  });

  it('two Verifies at the same moment → exactly one wins, the other is 409 (§20.2)', async () => {
    const r = (await newRev('3', path1))!.id;
    const res = await Promise.allSettled([act(r, 'verify'), act(r, 'verify')]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = res.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    expect(String((lost.reason as Error).message)).toMatch(/is Verified/);
    expect((await revRow(r)).releaseStatus).toBe('verified');
  });

  it('Replace on a Verified Rev with the SAME file (same hash) keeps it Verified', async () => {
    // path3 holds the same bytes as path2 (FILE2).
    await replaceVia(r2, path3);
    const row = await revRow(r2);
    expect(row.drawingFilePath).toBe(path3);
    expect(row.releaseStatus).toBe('verified');
    expect(row.fileHash).toBe(sha(FILE2));
  });

  it('Replace on a Verified Rev with a DIFFERENT file → Unverified, hash and Verified On / By cleared', async () => {
    await replaceVia(r2, path1, 'hole moved 2 mm');
    const row = await revRow(r2);
    expect(row.drawingFilePath).toBe(path1);
    expect(row.releaseStatus).toBe('unverified');
    expect(row.fileHash).toBeNull();
    expect(row.releasedAt).toBeNull();
    expect(row.releasedBy).toBeNull();
    const logs = await db
      .select({ changes: activityLog.changes })
      .from(activityLog)
      .where(eq(activityLog.entityId, r2));
    expect(
      logs.some((l) =>
        (l.changes ?? []).some(
          (c) => c.field === 'releaseStatus' && c.before === 'Verified' && c.after === 'Unverified',
        ),
      ),
    ).toBe(true);
  });

  it('Unverify needs a reason and moves Verified → Unverified', async () => {
    const r = (await newRev('5', path1))!.id;
    await act(r, 'verify');
    await expect(act(r, 'unverify')).rejects.toBeInstanceOf(ValidationError);
    await act(r, 'unverify', 'wrong scan verified');
    const row = await revRow(r);
    expect(row.releaseStatus).toBe('unverified');
    expect(row.releasedAt).toBeNull();
  });

  it('Approvals: an Unverified Rev WITH a PDF on an open SO line is "Drawing to verify"; gone once Verified', async () => {
    const r = (await newRev('6', path1))!.id;
    await makeSoLine('A6', itemId, r);
    let waiting = await getWaitingApprovals(admin);
    const row = waiting.rows.find((w) => w.kind === 'rev' && w.id === r);
    expect(row?.request).toBe('Drawing to verify');
    expect(row?.docHref).toBe(`/drawings/${r}`);
    await act(r, 'verify');
    waiting = await getWaitingApprovals(admin);
    expect(waiting.rows.some((w) => w.kind === 'rev' && w.id === r)).toBe(false);
  });

  it('a NEW Route Card needs the Rev in the register, with its PDF', async () => {
    const ops = [
      { operation: 'Turning', opType: 'process' as const, machineCodeText: 'CNC', cycleTimeMin: 5 },
    ];
    await expect(
      rcService.createRouteCard({ itemId, drawingRev: '77', ops } as never, admin),
    ).rejects.toThrow(
      `${P}X/77 is not in the Drawing Register. Add it there with its drawing PDF first.`,
    );
    await newRev('78', null);
    await expect(
      rcService.createRouteCard(
        { itemId, drawingRev: '78', drawingFilePath: path1, ops } as never,
        admin,
      ),
    ).rejects.toThrow(`No drawing file for ${P}X/78. Upload it in the Drawing Register first.`);
  });

  it('drawing history refuses UPDATE (append-only trigger)', async () => {
    await expect(
      db.execute(
        sql`UPDATE public.item_revision_drawings SET reason = 'x' WHERE item_revision_id = ${r2}::uuid`,
      ),
    ).rejects.toThrow(/history — rows are never changed/);
  });

  it('register list: status / PDF filters, open lines, Sort & Filter', async () => {
    const reg = await listDrawingRegister({ search: `${P}X`, limit: 25, offset: 0 }, admin);
    const one = reg.items.find((x) => x.id === r1);
    expect(one?.releaseStatus).toBe('unverified');
    expect(one?.hasFile).toBe(false);
    expect(one?.openLines).toBe(0);
    const verified = await listDrawingRegister(
      { search: `${P}X`, status: 'verified', limit: 25, offset: 0 },
      admin,
    );
    expect(verified.items.every((x) => x.releaseStatus === 'verified')).toBe(true);
    expect(verified.items.some((x) => x.drawingRev === '3')).toBe(true);
    const noPdf = await listDrawingRegister(
      { search: `${P}X`, pdf: 'no', limit: 25, offset: 0 },
      admin,
    );
    expect(noPdf.items.every((x) => !x.hasFile)).toBe(true);
    expect(noPdf.items.some((x) => x.id === r1)).toBe(true);
    // ADR-315 — SO No.: the order on that line, and the search finds the Rev by it.
    const six = reg.items.find((x) => x.drawingRev === '6')!;
    expect(six.orders).toHaveLength(1);
    const bySo = await listDrawingRegister(
      { search: six.orders[0]!.code, limit: 25, offset: 0 },
      admin,
    );
    expect(bySo.items.some((x) => x.id === six.id)).toBe(true);
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

  it('the BOM cascade on an Unverified child Rev still runs', async () => {
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
    expect((await revRow(childRev)).releaseStatus).toBe('unverified');
    const line = await makeSoLine('B', parentId, null, bom.id);
    const res = await withUserContext(admin, (tx) => cascadeBomToSoLine(tx, line, admin));
    expect(res.fired).toBe(true);
    expect(res.createdJobCardCodes).toHaveLength(1);
  });
});

describe('ADR-319 Upload drawing — first file of a Rev that has none', () => {
  it('no reason needed; file reaches the SO line; Rev stays Unverified; history says adopted', async () => {
    const rev = (await newRev('U9', null))!.id;
    const lineId = await makeSoLine('U9', itemId, rev);
    expect((await revRow(rev)).releaseStatus).toBe('unverified');
    await service.replaceDrawing(
      rev,
      {
        drawingFilePath: path2,
        reason: '',
        expectedUpdatedAt: (await revRow(rev)).updatedAt.toISOString(),
      },
      admin,
    );
    const after = await revRow(rev);
    expect(after.drawingFilePath).toBe(path2);
    expect(after.releaseStatus).toBe('unverified');
    const [line] = await db
      .select({ path: salesOrderLines.drawingFilePath })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, lineId));
    expect(line!.path).toBe(path2);
    const hist = await db
      .select({ action: itemRevisionDrawings.action, reason: itemRevisionDrawings.reason })
      .from(itemRevisionDrawings)
      .where(eq(itemRevisionDrawings.itemRevisionId, rev));
    expect(hist).toContainEqual({ action: 'adopted', reason: 'First drawing uploaded' });
  });

  it('a Rev that already has a file still needs a reason', async () => {
    const rev = (await newRev('U8', path1))!.id;
    await expect(
      withUserContext(admin, (tx) =>
        replaceItemRevisionDrawing(tx, admin, companyId, rev, {
          drawingFilePath: path3,
          reason: '',
        }),
      ),
    ).rejects.toThrow('Reason is required');
  });
});
