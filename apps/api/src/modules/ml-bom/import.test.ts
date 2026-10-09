// Multi-Level BOM Excel import tests (ADR-225 phase 2). NOTE: like every api
// test here this writes to the database DATABASE_URL points at — do not run
// against production.

import { and, eq, inArray, isNotNull, like } from 'drizzle-orm';
import type { MlBomImportRow } from '@innovic/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, items, mlBoms, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { importMlBoms } from './import';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TMLBI-';
const CODES = ['TOP', 'SUB', 'NUT', 'KG', 'LA', 'LB', 'XA', 'XB', 'REV', 'BUYP', 'BOMC', 'OK1'];

let admin: AuthContext;
const itemId: Record<string, string> = {};

let rowSeq = 2;
const row = (
  bom: string,
  child: string,
  qty: string,
  lineType: string,
  extra: Partial<MlBomImportRow> = {},
): MlBomImportRow => ({
  rowNum: rowSeq++,
  bomItemCode: bom,
  childItemCode: child,
  qtyPerSet: qty,
  lineType,
  ...extra,
});

const run = (rows: MlBomImportRow[], dryRun = true) =>
  importMlBoms({ dryRun, fileName: 'test.xlsx', rows }, admin);

const messages = (r: Awaited<ReturnType<typeof run>>, rowNum: number): string[] =>
  r.rows.find((x) => x.rowNum === rowNum)?.messages ?? [];

async function cleanup(): Promise<void> {
  const ids = (
    await db
      .select({ id: items.id })
      .from(items)
      .where(like(items.code, `${P}%`))
  ).map((r) => r.id);
  if (ids.length > 0) await db.delete(mlBoms).where(inArray(mlBoms.itemId, ids));
  await db.delete(items).where(like(items.code, `${P}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await cleanup();
  const inserted = await db
    .insert(items)
    .values(
      CODES.map((c) => ({
        companyId: u.companyId!,
        code: `${P}${c}`,
        name: `ML BOM import test ${c}`,
        revision: 'A',
        uom: (c === 'KG' ? 'KGS' : 'NOS') as 'KGS' | 'NOS',
        itemType: 'component' as const,
        createdBy: u.id,
        updatedBy: u.id,
      })),
    )
    .returning({ id: items.id, code: items.code });
  for (const r of inserted) itemId[r.code.slice(P.length)] = r.id;
});

afterAll(cleanup);

describe('ml-bom import — row checks', () => {
  it('unknown item is refused, naming the code; case and spaces are ignored', async () => {
    const a = row(`  ${P}top `.toLowerCase(), `${P}NOPE`, '1', 'Buy');
    const r = await run([a]);
    expect(r.ok).toBe(false);
    expect(messages(r, a.rowNum)).toContain(`Item ${P}NOPE is not in Item Master`);
    expect(messages(r, a.rowNum).some((m) => m.includes(`${P}top`))).toBe(false);
  });

  it('same child twice under one BOM: an error on BOTH rows naming the other', async () => {
    const a = row(`${P}TOP`, `${P}NUT`, '1', 'Buy');
    const b = row(`${P}TOP`, `${P}NUT`, '2', 'purchase');
    const r = await run([a, b]);
    expect(r.ok).toBe(false);
    expect(messages(r, a.rowNum).join(' ')).toContain(`also on row ${b.rowNum}`);
    expect(messages(r, b.rowNum).join(' ')).toContain(`also on row ${a.rowNum}`);
  });

  it('whole-number unit refuses a fraction; Line Type and blanks are named', async () => {
    const a = row(`${P}TOP`, `${P}NUT`, '0.5', 'Make');
    const b = row(`${P}TOP`, `${P}SUB`, '', 'Assemble');
    const c = row(`${P}TOP`, `${P}KG`, '0.25', 'Buy');
    const r = await run([a, b, c]);
    expect(messages(r, a.rowNum).join(' ')).toMatch(/must be a whole number/);
    expect(messages(r, b.rowNum)).toEqual(
      expect.arrayContaining([
        'Qty per Set is blank',
        'Line Type must be Manufacture, Buy or Outsource',
      ]),
    );
    expect(r.rows.find((x) => x.rowNum === c.rowNum)?.status).toBe('ok');
  });
});

describe('ml-bom import — file checks', () => {
  it('a loop inside the file is a file error and nothing is saved', async () => {
    const r = await run(
      [row(`${P}LA`, `${P}LB`, '1', 'Manufacture'), row(`${P}LB`, `${P}LA`, '1', 'Manufacture')],
      false,
    );
    expect(r.ok).toBe(false);
    expect(r.saved).toBe(false);
    expect(r.fileErrors.join(' ')).toMatch(/^Loop: TMLBI-L[AB] → TMLBI-L[AB] → TMLBI-L[AB]/);
    const saved = await db
      .select({ id: mlBoms.id })
      .from(mlBoms)
      .where(inArray(mlBoms.itemId, [itemId['LA']!, itemId['LB']!]));
    expect(saved).toHaveLength(0);
  });

  it('a loop through an existing live BOM is caught', async () => {
    await service.createMlBom(
      {
        itemId: itemId['XA']!,
        lines: [{ childItemId: itemId['XB']!, qtyPerSet: 1, bomType: 'manufacture' }],
      },
      admin,
    );
    const r = await run([row(`${P}XB`, `${P}XA`, '1', 'Manufacture')]);
    expect(r.ok).toBe(false);
    expect(r.fileErrors.join(' ')).toContain(`Loop: ${P}XB → ${P}XA → ${P}XB`);
  });

  it('Buy over an item that has a BOM: warning, the BOM is not expanded', async () => {
    await service.createMlBom(
      {
        itemId: itemId['BOMC']!,
        lines: [{ childItemId: itemId['NUT']!, qtyPerSet: 2, bomType: 'purchase' }],
      },
      admin,
    );
    const a = row(`${P}BUYP`, `${P}BOMC`, '3', 'Buy', { rawMaterialGrade: 'EN8' });
    const r = await run([a]);
    expect(r.ok).toBe(true);
    expect(messages(r, a.rowNum)).toEqual(
      expect.arrayContaining([
        `${P}BOMC has its own BOM — ignored because the line says Buy`,
        'RM Grade / RM Size ignored on a Buy line',
      ]),
    );
    expect(r.tree.filter((t) => t.topItemCode === `${P}BUYP`)).toHaveLength(2);
  });
});

describe('ml-bom import — save', () => {
  it('revises an existing item: warning on the preview, BOM Rev N+1 on save', async () => {
    const existing = await service.createMlBom(
      {
        itemId: itemId['REV']!,
        lines: [{ childItemId: itemId['NUT']!, qtyPerSet: 1, bomType: 'purchase' }],
      },
      admin,
    );
    const rows = [row(`${P}REV`, `${P}NUT`, '4', 'Buy')];
    const preview = await run(rows);
    expect(messages(preview, rows[0]!.rowNum)).toContain(
      `${P}REV already has ${existing.code} — import makes BOM Rev 2`,
    );
    expect(preview.boms[0]).toMatchObject({ action: 'revise', code: existing.code, revision: 2 });

    const done = await run(rows, false);
    expect(done.saved).toBe(true);
    const after = await service.getMlBom(existing.id, admin);
    expect(after.revision).toBe(2);
    expect(after.lines[0]!.qtyPerSet).toBe('4.000');
    expect(after.revisions.find((v) => v.revision === 2)?.notes).toBe('Imported from test.xlsx');
    // ADR-197: the same per-line before → after History rows a screen edit writes.
    const lineRows = await db
      .select({ lineRef: activityLog.lineRef })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entity, 'MlBom'),
          eq(activityLog.entityId, existing.id),
          isNotNull(activityLog.lineRef),
        ),
      );
    expect(lineRows.length).toBeGreaterThan(0);
  });

  it('creates bottom-up and links the sub-assembly; exploded qty multiplies', async () => {
    const r = await run(
      [row(`${P}TOP`, `${P}SUB`, '2', 'Manufacture'), row(`${P}SUB`, `${P}KG`, '1.5', 'Buy')],
      false,
    );
    expect(r.saved).toBe(true);
    expect(r.boms.every((b) => b.code?.startsWith('IN-MLB-'))).toBe(true);
    expect(r.tree.find((t) => t.itemCode === `${P}KG`)?.explodedQty).toBe('3.000');
    const top = (await service.listMlBoms({ search: `${P}TOP`, limit: 25, offset: 0 }, admin))
      .items[0]!;
    const detail = await service.getMlBom(top.id, admin);
    expect(detail.lines[0]!.childMlBomId).not.toBeNull();
  });

  it('all or nothing: one bad row and no BOM of the file is saved', async () => {
    const r = await run(
      [row(`${P}OK1`, `${P}NUT`, '1', 'Buy'), row(`${P}OK1`, `${P}NOPE2`, '1', 'Buy')],
      false,
    );
    expect(r.ok).toBe(false);
    expect(r.saved).toBe(false);
    const saved = await db
      .select({ id: mlBoms.id })
      .from(mlBoms)
      .where(eq(mlBoms.itemId, itemId['OK1']!));
    expect(saved).toHaveLength(0);
  });
});
