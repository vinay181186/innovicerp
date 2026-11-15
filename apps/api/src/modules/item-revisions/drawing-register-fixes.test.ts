// ADR-290 — Drawing Register code-review fixes. Positive asserts on TEST:
//   1. at most one Released per item: release 3 then 2 → 2 superseded at once;
//      labels that cannot be compared → the newest release wins;
//   2. "Verify & Release" of an old (unverified) record stamps approved and
//      the change note; with no file it is refused;
//   3. Replace drawing: unverified + file + open SO line → a correction;
//      unverified with no file → direct; obsolete → refused;
//   4. register search with "_" in an item code matches it literally;
//   5. POST /item-revisions (createDrawingRev): draft, note stored, 409 on a
//      second add, Buy item refused;
//   6. lookup names the latest released Rev only when it is newer;
//   7. a correction decision is logged APPROVE / REJECT on DrawingCorrection;
//      the requester may withdraw (reject) but never approve their own;
//      and reaches the requester and the Rev's creator (note rule).
// Runs on TEST only, on its own (no global setup): prefix TDRF-.

import { eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  drawingCorrections,
  itemRevisionDrawings,
  itemRevisions,
  items,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, ValidationError } from '../../lib/errors';
import { replaceItemRevisionDrawing } from '../../lib/item-revision';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { NOTE_RULES, ruleCond } from '../dashboard/personal/note-rules';
import { decideDrawingCorrection } from './corrections';
import { createDrawingRev, listDrawingRegister } from './register';
import { revStatusAction } from './release';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TDRF-';
const BUCKET = 'qc-docs';

let admin: AuthContext;
let otherUserId: string;
let companyId: string;
let path1: string;
let path2: string;

async function cleanup(): Promise<void> {
  const its = await db
    .select({ id: items.id })
    .from(items)
    .where(like(items.code, `${P}%`));
  const ids = its.map((i) => i.id);
  if (ids.length === 0) return;
  await db.delete(salesOrders).where(like(salesOrders.code, `${P}%`));
  const revs = await db
    .select({ id: itemRevisions.id })
    .from(itemRevisions)
    .where(inArray(itemRevisions.itemId, ids));
  const revIds = revs.map((r) => r.id);
  if (revIds.length > 0) {
    const cs = await db
      .select({ id: drawingCorrections.id })
      .from(drawingCorrections)
      .where(inArray(drawingCorrections.itemRevisionId, revIds));
    const logIds = [...revIds, ...cs.map((c) => c.id)];
    await db.delete(drawingCorrections).where(inArray(drawingCorrections.itemRevisionId, revIds));
    await db.delete(activityLog).where(inArray(activityLog.entityId, logIds));
    await db
      .delete(itemRevisionDrawings)
      .where(inArray(itemRevisionDrawings.itemRevisionId, revIds));
    await db.delete(itemRevisions).where(inArray(itemRevisions.id, revIds));
  }
  await db.delete(items).where(inArray(items.id, ids));
}

async function mkItem(code: string, type: 'make' | 'buy' = 'make'): Promise<string> {
  const [r] = await db
    .insert(items)
    .values({
      companyId,
      code,
      name: 'Drawing Register fixes test part',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      procurementType: type,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  return r!.id;
}

/** An old record (unverified), optionally with a file. */
async function oldRev(itemId: string, rev: string, file: string | null): Promise<string> {
  const [r] = await db
    .insert(itemRevisions)
    .values({
      companyId,
      itemId,
      rev,
      drawingFilePath: file,
      sourceType: 'legacy',
      sourceRef: P,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: itemRevisions.id });
  return r!.id;
}

const revRow = async (id: string) =>
  (await db.select().from(itemRevisions).where(eq(itemRevisions.id, id)))[0]!;

async function act(
  id: string,
  action: 'submit' | 'approve' | 'reject' | 'release' | 'obsolete',
  note?: string,
): Promise<void> {
  const r = await revRow(id);
  await revStatusAction(id, action, { expectedUpdatedAt: r.updatedAt.toISOString(), note }, admin);
}

async function openSoLine(key: string, itemId: string, revId: string): Promise<void> {
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
  await db.insert(salesOrderLines).values({
    companyId,
    salesOrderId: so!.id,
    lineNo: 1,
    itemId,
    partName: 'part',
    orderQty: 5,
    rate: '0',
    status: 'open',
    itemRevisionId: revId,
    createdBy: admin.id,
    updatedBy: admin.id,
  });
}

const replace = (id: string, file: string, reason = 'wrong file attached') =>
  withUserContext(admin, (tx) =>
    replaceItemRevisionDrawing(tx, admin, companyId, id, { drawingFilePath: file, reason }),
  );

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  const other = (await db.execute(sql`
    SELECT id FROM public.users WHERE company_id = ${companyId}::uuid AND id <> ${admin.id}::uuid
     LIMIT 1`)) as unknown as Array<{ id: string }>;
  if (!other[0]) throw new Error('Need a second user in the company');
  otherUserId = other[0].id;
  await cleanup();
  const stamp = Date.now();
  path1 = `${companyId}/drawings/${P}one-${stamp}.pdf`;
  path2 = `${companyId}/drawings/${P}two-${stamp}.pdf`;
  for (const [p, b] of [
    [path1, Buffer.from(`fix one ${'x'.repeat(40)}`)],
    [path2, Buffer.from(`fix two ${'y'.repeat(40)}`)],
  ] as const) {
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(p, b, { contentType: 'application/pdf' });
    if (error) throw error;
  }
}, 120_000);

afterAll(async () => {
  await cleanup();
  await supabaseAdmin.storage.from(BUCKET).remove([path1, path2]);
}, 120_000);

describe('ADR-290 Drawing Register fixes', () => {
  it('1. release 3 then release 2 → 2 superseded at once; only one Released', async () => {
    const item = await mkItem(`${P}ORD`);
    const r3 = await oldRev(item, '3', path1);
    const r2 = await oldRev(item, '2', path2);
    await act(r3, 'release');
    await act(r2, 'release');
    expect((await revRow(r3)).releaseStatus).toBe('released');
    const two = await revRow(r2);
    expect(two.releaseStatus).toBe('superseded');
    expect(two.supersededAt).not.toBeNull();
    // 6. lookup: Rev 2 (superseded) names Rev 3; a newer Rev 4 gets no note.
    expect((await service.lookupItemRevision({ itemId: item, rev: '2' }, admin)).release
      ?.latestReleasedLabel).toBe(`${P}ORD/3`);
    await createDrawingRev(
      { itemId: item, rev: '4', drawingNo: null, drawingFilePath: null, changeNote: null },
      admin,
    );
    const four = await service.lookupItemRevision({ itemId: item, rev: '4' }, admin);
    expect(four.release?.releaseStatus).toBe('draft');
    expect(four.release?.latestReleasedLabel).toBeNull();
  });

  it('1. labels that cannot be compared → the newest release wins', async () => {
    const item = await mkItem(`${P}MIX`);
    const ra = await oldRev(item, 'A', path1);
    const r1 = await oldRev(item, '1', path2);
    await act(ra, 'release');
    await act(r1, 'release');
    expect((await revRow(r1)).releaseStatus).toBe('released');
    expect((await revRow(ra)).releaseStatus).toBe('superseded');
  });

  it('2. Verify & Release of an old record stamps approved + note; no file → refused', async () => {
    const item = await mkItem(`${P}VER`);
    const r = await oldRev(item, '1', path1);
    await act(r, 'release');
    const row = await revRow(r);
    expect(row.releaseStatus).toBe('released');
    expect(row.approvedBy).toBe(admin.id);
    expect(row.approvedAt?.getTime()).toBe(row.releasedAt?.getTime());
    expect(row.changeNote).toBe('Verified from old record');
    const log = await db
      .select({ detail: activityLog.detail })
      .from(activityLog)
      .where(eq(activityLog.entityId, r));
    expect(log.some((l) => /Verified & released/.test(l.detail ?? ''))).toBe(true);
    const bare = await oldRev(item, '2', null);
    await expect(act(bare, 'release')).rejects.toThrow('Upload the drawing before releasing it');
  });

  it('3. Replace drawing: unverified in use → correction; no file → direct; obsolete → refused', async () => {
    const item = await mkItem(`${P}REP`);
    const used = await oldRev(item, '1', path1);
    await openSoLine('REP', item, used);
    const res = await replace(used, path2);
    expect(res.correctionId).toBeTruthy();
    expect((await revRow(used)).drawingFilePath).toBe(path1);

    const empty = await oldRev(item, '2', null);
    const direct = await replace(empty, path2, 'first drawing file');
    expect(direct.correctionId).toBeNull();
    expect((await revRow(empty)).drawingFilePath).toBe(path2);

    await act(empty, 'obsolete', 'customer withdrew it');
    await expect(replace(empty, path1)).rejects.toThrow(
      `${P}REP/2 is Obsolete — add a new Drawing Rev instead`,
    );
  });

  it('4. register search: "_" in an item code matches literally', async () => {
    const under = await mkItem(`${P}U_1`);
    const lookAlike = await mkItem(`${P}UX1`);
    await oldRev(under, '1', null);
    await oldRev(lookAlike, '1', null);
    const reg = await listDrawingRegister({ search: `${P}U_1`, limit: 25, offset: 0 }, admin);
    expect(reg.items.map((r) => r.itemCode)).toEqual([`${P}U_1`]);
    expect(reg.total).toBe(1);
    // A filter on a count column still counts right (COUNTS joined for it).
    const f = await listDrawingRegister(
      {
        search: `${P}U`,
        sf: JSON.stringify({ filters: [{ field: 'openLines', kind: 'num', op: 'eq', a: 0 }] }),
        limit: 25,
        offset: 0,
      },
      admin,
    );
    expect(f.total).toBe(2);
  });

  it('5. createDrawingRev: draft + note + source register; second add 409; Buy item refused', async () => {
    const item = await mkItem(`${P}NEW`);
    const id = await createDrawingRev(
      {
        itemId: item,
        rev: '2',
        drawingNo: 'DRG-77',
        drawingFilePath: path1,
        changeNote: 'Hole moved 2 mm',
      },
      admin,
    );
    const row = await revRow(id);
    expect(row.releaseStatus).toBe('draft');
    expect(row.sourceType).toBe('register');
    expect(row.changeNote).toBe('Hole moved 2 mm');
    expect(row.drawingFilePath).toBe(path1);
    const again = createDrawingRev(
      { itemId: item, rev: '2', drawingNo: null, drawingFilePath: null, changeNote: null },
      admin,
    );
    await expect(again).rejects.toBeInstanceOf(ConflictError);
    await expect(again).rejects.toThrow(`${P}NEW/2 already exists (Not released)`);
    const buy = await mkItem(`${P}BUY`, 'buy');
    await expect(
      createDrawingRev(
        { itemId: buy, rev: '1', drawingNo: null, drawingFilePath: null, changeNote: null },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('7. correction decision: REJECT on DrawingCorrection, heard by requester and Rev creator', async () => {
    const item = await mkItem(`${P}COR`);
    const r = await oldRev(item, '1', path1);
    await act(r, 'release');
    // The Rev was created by someone else; admin asks for the correction.
    await db.update(itemRevisions).set({ createdBy: otherUserId }).where(eq(itemRevisions.id, r));
    const res = await replace(r, path2);
    await decideDrawingCorrection(res.correctionId!, { decision: 'reject', note: 'not needed' }, admin);
    const rows = await db
      .select({ action: activityLog.action, entity: activityLog.entity })
      .from(activityLog)
      .where(eq(activityLog.entityId, res.correctionId!));
    expect(rows).toEqual([{ action: 'REJECT', entity: 'DrawingCorrection' }]);
    const rule = NOTE_RULES.find((x) => x.entity === 'DrawingCorrection' && x.action === 'REJECT')!;
    const hears = async (me: string): Promise<boolean> => {
      const got = (await db.execute(sql`
        SELECT 1 FROM public.activity_log a
         WHERE a.entity_id = ${res.correctionId!}::uuid AND ${ruleCond(rule, companyId, me)}`)) as unknown as unknown[];
      return got.length > 0;
    };
    expect(await hears(admin.id)).toBe(true);
    expect(await hears(otherUserId)).toBe(true);
    expect(await hears('00000000-0000-0000-0000-000000000001')).toBe(false);
  });

  it('7. correction approve: APPROVE on DrawingCorrection, new file in use', async () => {
    const item = await mkItem(`${P}COA`);
    const r = await oldRev(item, '1', path1);
    await act(r, 'release');
    const res = await replace(r, path2);
    // ADR-290 — the requester cannot approve their own correction.
    const own = decideDrawingCorrection(res.correctionId!, { decision: 'approve' }, admin);
    await expect(own).rejects.toBeInstanceOf(AuthorizationError);
    await expect(own).rejects.toThrow(
      'You asked for this correction — another person with the Drawing Release button must approve it.',
    );
    const still = (
      await db
        .select({ status: drawingCorrections.status })
        .from(drawingCorrections)
        .where(eq(drawingCorrections.id, res.correctionId!))
    )[0]!;
    expect(still.status).toBe('pending');
    expect((await revRow(r)).drawingFilePath).toBe(path1);
    // Requested by someone else → admin may approve.
    await db
      .update(drawingCorrections)
      .set({ requestedBy: otherUserId })
      .where(eq(drawingCorrections.id, res.correctionId!));
    await decideDrawingCorrection(res.correctionId!, { decision: 'approve' }, admin);
    expect((await revRow(r)).drawingFilePath).toBe(path2);
    const rows = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.entityId, res.correctionId!));
    expect(rows.map((x) => x.action)).toEqual(['APPROVE']);
  });
});
