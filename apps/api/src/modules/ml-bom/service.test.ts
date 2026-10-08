// Multi-Level BOM service tests (ADR-225 Phase 1). Mirrors
// bom-master/service.test.ts. NOTE: like every api test here this writes to
// the database DATABASE_URL points at — do not run against production.

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, mlBoms, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AppError, ConflictError, ValidationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TMLB-';

let admin: AuthContext;
const itemId: Record<string, string> = {};

/** 12-deep chain D00..D12 for the depth test, plus named parts. */
const CHAIN = Array.from({ length: 13 }, (_, i) => `D${String(i).padStart(2, '0')}`);
const NAMED = ['PS', 'MA', 'HSG', 'BRG', 'LOOPA', 'LOOPB', 'RACE', 'KG', 'DEL'];

const line = (code: string, qty: number, bomType: 'manufacture' | 'purchase' | 'outsource') => ({
  childItemId: itemId[code]!,
  qtyPerSet: qty,
  bomType,
});

async function cleanup(): Promise<void> {
  const ids = (
    await db
      .select({ id: items.id })
      .from(items)
      .where(like(items.code, `${TEST_PREFIX}%`))
  ).map((r) => r.id);
  if (ids.length > 0) {
    // One statement: the composite sub-assembly FK is checked at its end, so
    // BOMs linking each other go together. Lines + revisions cascade.
    await db.delete(mlBoms).where(inArray(mlBoms.itemId, ids));
  }
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await cleanup();
  const codes = [...NAMED, ...CHAIN];
  const inserted = await db
    .insert(items)
    .values(
      codes.map((c) => ({
        companyId: u.companyId!,
        code: `${TEST_PREFIX}${c}`,
        name: `ML BOM test ${c}`,
        revision: 'A',
        uom: (c === 'KG' ? 'KGS' : 'NOS') as 'KGS' | 'NOS',
        itemType: 'component' as const,
        createdBy: u.id,
        updatedBy: u.id,
      })),
    )
    .returning({ id: items.id, code: items.code });
  for (const r of inserted) itemId[r.code.slice(TEST_PREFIX.length)] = r.id;
});

afterAll(cleanup);

describe('ml-bom create + links', () => {
  it('numbers IN-MLB-#####, first BOM of an item is Default, revision 1', async () => {
    const b = await service.createMlBom(
      { itemId: itemId['HSG']!, lines: [line('BRG', 2, 'purchase')] },
      admin,
    );
    expect(b.code).toMatch(/^IN-MLB-\d{5}$/);
    expect(b.isDefault).toBe(true);
    expect(b.revision).toBe(1);
    expect(b.revisions).toHaveLength(1);
    expect(b.lines[0]!.childMlBomId).toBeNull();
  });

  it('second BOM of the same item is not Default; asking for Default is refused', async () => {
    const b = await service.createMlBom(
      { itemId: itemId['HSG']!, lines: [line('BRG', 4, 'purchase')] },
      admin,
    );
    expect(b.isDefault).toBe(false);
    await expect(
      service.createMlBom(
        { itemId: itemId['HSG']!, isDefault: true, lines: [line('BRG', 1, 'purchase')] },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('a manufacture line links the child Default; Buy / Outsource lines do not', async () => {
    const ma = await service.createMlBom(
      { itemId: itemId['MA']!, lines: [line('HSG', 1, 'manufacture'), line('BRG', 2, 'purchase')] },
      admin,
    );
    const hsgLine = ma.lines.find((l) => l.childItemId === itemId['HSG']);
    expect(hsgLine?.childMlBomId).not.toBeNull();
    expect(hsgLine?.childMlBomCode).toMatch(/^IN-MLB-/);

    const ps = await service.createMlBom(
      { itemId: itemId['PS']!, lines: [line('MA', 2, 'manufacture'), line('HSG', 1, 'outsource')] },
      admin,
    );
    expect(ps.lines.find((l) => l.childItemId === itemId['MA'])?.childMlBomId).toBe(ma.id);
    expect(ps.lines.find((l) => l.childItemId === itemId['HSG'])?.childMlBomId).toBeNull();
  });

  it('a new Default links the manufacture lines that were waiting for it', async () => {
    const parent = await service.createMlBom(
      { itemId: itemId['RACE']!, lines: [line('DEL', 1, 'manufacture')] },
      admin,
    );
    expect(parent.lines[0]!.childMlBomId).toBeNull();
    const child = await service.createMlBom(
      { itemId: itemId['DEL']!, lines: [line('BRG', 1, 'purchase')] },
      admin,
    );
    const again = await service.getMlBom(parent.id, admin);
    expect(again.lines[0]!.childMlBomId).toBe(child.id);
    expect((await service.getMlBom(child.id, admin)).usedIn.map((u) => u.mlBomId)).toContain(
      parent.id,
    );
  });

  it('whole-number unit refuses a fraction (qtyUomProblem, as BOM Master)', async () => {
    await expect(
      service.createMlBom({ itemId: itemId['KG']!, lines: [line('BRG', 0.5, 'purchase')] }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ml-bom tree', () => {
  it('multiplies Qty per Set down the chain and explodes leaves by item + type', async () => {
    const ps = (
      await service.listMlBoms({ search: `${TEST_PREFIX}PS`, limit: 25, offset: 0 }, admin)
    ).items[0]!;
    expect(ps.levels).toBe(3); // PS → MA → HSG → BRG
    const tree = await service.getMlBomTree(ps.id, { qty: 3 }, admin);
    expect(tree.nodes[0]).toMatchObject({
      depth: 0,
      bomType: null,
      qtyPerSet: null,
      mlBomId: ps.id,
    });
    expect(tree.levels).toBe(3);
    // BRG as Buy: under MA (3×2×2 = 12) and under MA→HSG (3×2×1×2 = 12) → 24.
    const brg = tree.exploded.find((e) => e.itemId === itemId['BRG'] && e.bomType === 'purchase');
    expect(brg?.explodedQty).toBe('24.000');
    // HSG outsourced directly on PS is a leaf (3×1); the manufactured HSG is not.
    const hsgOut = tree.exploded.find(
      (e) => e.itemId === itemId['HSG'] && e.bomType === 'outsource',
    );
    expect(hsgOut?.explodedQty).toBe('3.000');
    expect(
      tree.exploded.some((e) => e.itemId === itemId['HSG'] && e.bomType === 'manufacture'),
    ).toBe(false);
  });
});

describe('ml-bom guards', () => {
  it('refuses a loop A → B → A', async () => {
    await service.createMlBom(
      { itemId: itemId['LOOPA']!, lines: [line('LOOPB', 1, 'manufacture')] },
      admin,
    );
    const err = await service
      .createMlBom({ itemId: itemId['LOOPB']!, lines: [line('LOOPA', 1, 'manufacture')] }, admin)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toMatch(/^Loop: TMLB-LOOPB → TMLB-LOOPA → TMLB-LOOPB/);
  });

  it('refuses a tree deeper than 10 levels', async () => {
    // Bottom-up: BOM of D_k has one manufacture line D_k+1. D11's BOM is 1 level.
    for (let k = 11; k >= 2; k--) {
      await service.createMlBom(
        { itemId: itemId[CHAIN[k]!]!, lines: [line(CHAIN[k + 1]!, 1, 'manufacture')] },
        admin,
      );
    }
    // D01 → D02 … D12 = 11 levels.
    await expect(
      service.createMlBom(
        { itemId: itemId[CHAIN[1]!]!, lines: [line(CHAIN[2]!, 1, 'manufacture')] },
        admin,
      ),
    ).rejects.toThrow(/more than 10 levels/);
  });

  it('two concurrent Default creates for one item: exactly one wins', async () => {
    const make = () =>
      service.createMlBom(
        { itemId: itemId['D00']!, isDefault: true, lines: [line('BRG', 1, 'purchase')] },
        admin,
      );
    const results = await Promise.allSettled([make(), make()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    const defaults = await db
      .select({ id: mlBoms.id })
      .from(mlBoms)
      .where(eq(mlBoms.itemId, itemId['D00']!));
    expect(defaults).toHaveLength(1);
  });

  it('update with a stale updatedAt is refused 409', async () => {
    const b = await service.createMlBom(
      { itemId: itemId['KG']!, lines: [line('BRG', 1, 'purchase')] },
      admin,
    );
    const input = {
      itemId: b.itemId,
      lines: [line('BRG', 2, 'purchase')],
      expectedUpdatedAt: b.updatedAt,
    };
    const saved = await service.updateMlBom(b.id, input, admin);
    expect(saved.revision).toBe(2);
    const err = await service.updateMlBom(b.id, input, admin).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
  });

  it('delete while used is refused; make-default re-points the users', async () => {
    const hsg = await service.listMlBoms(
      { search: `${TEST_PREFIX}HSG`, limit: 25, offset: 0 },
      admin,
    );
    const def = hsg.items.find((b) => b.isDefault && b.itemId === itemId['HSG'])!;
    const other = hsg.items.find((b) => !b.isDefault && b.itemId === itemId['HSG'])!;
    await expect(service.softDeleteMlBom(def.id, admin)).rejects.toBeInstanceOf(ConflictError);

    const moved = await service.makeDefaultMlBom(
      other.id,
      { expectedUpdatedAt: other.updatedAt },
      admin,
    );
    expect(moved.isDefault).toBe(true);
    expect(moved.usedIn.length).toBeGreaterThan(0);
    expect((await service.getMlBom(def.id, admin)).isDefault).toBe(false);
    // The old Default is free now.
    const gone = await service.softDeleteMlBom(def.id, admin);
    expect(gone.deletedAt).not.toBeNull();
  });
});
