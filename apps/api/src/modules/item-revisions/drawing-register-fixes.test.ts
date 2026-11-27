// ADR-323 — Drawing Register fixes. Positive asserts on TEST:
//   1. lookup names the item's latest VERIFIED Rev only when it is newer;
//   2. Verify needs a file; Obsolete → Replace drawing refused, Verify refused;
//   3. register search with "_" in an item code matches it literally;
//   4. POST /item-revisions (createDrawingRev): Unverified (also with a PDF),
//      note stored, 409 on a second add, Buy item refused;
//   5. SO / JWSO lines take no drawing file: a sent file is ignored, the Rev
//      stays without one; a buy item has no Rev;
//   6. a line Drawing No. fills a blank register Drawing No., never overwrites.
// Runs on TEST only, on its own (no global setup): prefix TDRF-.

import { type RevStatusAction } from '@innovic/shared';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, itemRevisionDrawings, itemRevisions, items, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { replaceItemRevisionDrawing } from '../../lib/item-revision';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { resolveLineRevision } from './line-rev';
import { createDrawingRev, listDrawingRegister } from './register';
import { revStatusAction } from './release';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TDRF-';
const BUCKET = 'qc-docs';

let admin: AuthContext;
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
  const revs = await db
    .select({ id: itemRevisions.id })
    .from(itemRevisions)
    .where(inArray(itemRevisions.itemId, ids));
  const revIds = revs.map((r) => r.id);
  if (revIds.length > 0) {
    await db.delete(activityLog).where(inArray(activityLog.entityId, revIds));
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

async function act(id: string, action: RevStatusAction, note?: string): Promise<void> {
  const r = await revRow(id);
  await revStatusAction(id, action, { expectedUpdatedAt: r.updatedAt.toISOString(), note }, admin);
}

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
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

describe('ADR-323 Drawing Register fixes', () => {
  it('1. lookup names the latest Verified Rev only when it is newer', async () => {
    const item = await mkItem(`${P}ORD`);
    const r3 = await oldRev(item, '3', path1);
    const r2 = await oldRev(item, '2', path2);
    await act(r3, 'verify');
    await act(r2, 'verify');
    expect((await revRow(r3)).releaseStatus).toBe('verified');
    expect((await revRow(r2)).releaseStatus).toBe('verified');
    expect(
      (await service.lookupItemRevision({ itemId: item, rev: '2' }, admin)).release
        ?.latestReleasedLabel,
    ).toBe(`${P}ORD/3`);
    await createDrawingRev(
      { itemId: item, rev: '4', drawingNo: null, drawingFilePath: null, changeNote: null },
      admin,
    );
    const four = await service.lookupItemRevision({ itemId: item, rev: '4' }, admin);
    expect(four.release?.releaseStatus).toBe('unverified');
    expect(four.release?.latestReleasedLabel).toBeNull();
  });

  it('2. Verify with no file → refused; Obsolete → Replace drawing and Verify refused', async () => {
    const item = await mkItem(`${P}REP`);
    const bare = await oldRev(item, '1', null);
    await expect(act(bare, 'verify')).rejects.toThrow('Upload the drawing PDF before verifying it');
    await act(bare, 'obsolete', 'customer withdrew it');
    await expect(
      withUserContext(admin, (tx) =>
        replaceItemRevisionDrawing(tx, admin, companyId, bare, {
          drawingFilePath: path1,
          reason: 'wrong file attached',
        }),
      ),
    ).rejects.toThrow(`${P}REP/1 is Obsolete — add a new Drawing Rev instead`);
  });

  it('3. register search: "_" in an item code matches literally', async () => {
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

  it('4. createDrawingRev: with a file → Unverified + note + source register; second add 409; Buy item refused', async () => {
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
    expect(row.releaseStatus).toBe('unverified');
    expect(row.sourceType).toBe('register');
    expect(row.changeNote).toBe('Hole moved 2 mm');
    expect(row.drawingFilePath).toBe(path1);
    const again = createDrawingRev(
      { itemId: item, rev: '2', drawingNo: null, drawingFilePath: null, changeNote: null },
      admin,
    );
    await expect(again).rejects.toBeInstanceOf(ConflictError);
    await expect(again).rejects.toThrow(`${P}NEW/2 already exists (Unverified)`);
    const buy = await mkItem(`${P}BUY`, 'buy');
    await expect(
      createDrawingRev(
        { itemId: buy, rev: '1', drawingNo: null, drawingFilePath: null, changeNote: null },
        admin,
      ),
    ).rejects.toThrow(/not a make item/);
  });

  const newLine = (
    itemId: string,
    rev: string,
    file: string | null,
    kind: 'so' | 'jw' = 'so',
    drawingNo: string | null = null,
  ) =>
    withUserContext(admin, (tx) =>
      resolveLineRevision(tx, admin, companyId, {
        kind,
        orderId: '00000000-0000-0000-0000-000000000000',
        docCode: `${P}${kind === 'so' ? 'SO' : 'JW'}-323`,
        lineNo: 1,
        itemId,
        rev,
        sentFile: file,
        sentDrawingNo: drawingNo,
        stored: null,
      }),
    );

  it('5. a new SO / JWSO line ignores a sent drawing file; the Rev stays Unverified with none', async () => {
    const make = await mkItem(`${P}S323`);
    const res = await newLine(make, '1', path1);
    expect(res.itemRevisionId).not.toBeNull();
    expect(res.drawingFilePath).toBeNull();
    const row = await revRow(res.itemRevisionId!);
    expect(row.releaseStatus).toBe('unverified');
    expect(row.drawingFilePath).toBeNull();
    const jw = await newLine(make, '2', path2, 'jw');
    expect((await revRow(jw.itemRevisionId!)).drawingFilePath).toBeNull();
    const buy = await mkItem(`${P}B323`, 'buy');
    expect((await newLine(buy, '1', null, 'jw')).itemRevisionId).toBeNull();
  });

  it('6. a line Drawing No. fills a blank register Drawing No., never overwrites one', async () => {
    const make = await mkItem(`${P}D323`);
    const blank = await oldRev(make, '1', null);
    await newLine(make, '1', null, 'so', 'DRG-1');
    expect((await revRow(blank)).drawingNo).toBe('DRG-1');
    await newLine(make, '1', null, 'jw', 'DRG-OTHER');
    expect((await revRow(blank)).drawingNo).toBe('DRG-1');
  });
});
