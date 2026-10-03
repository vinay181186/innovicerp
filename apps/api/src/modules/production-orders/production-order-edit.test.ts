// Edit-approval HEADER edit for Production Orders (ADR-202 Phase 3).
//
// Pure unit tests — no database. They drive the branch logic of
// updateProductionOrderTx and the registry entry with a tiny fake transaction,
// so they run with `npx vitest run` and never touch the (production) DB.

import { describe, expect, it } from 'vitest';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields } from '../../lib/audit-trail';
import { ConflictError, ValidationError } from '../../lib/errors';
import { productionOrderEditRegistryEntry as entry } from './production-order-edit-registry';
import { PRODUCTION_ORDER_EDIT_FIELDS, updateProductionOrderTx } from './service';

const user: AuthContext = {
  id: 'user-1',
  email: 'tester@innovic.test',
  companyId: 'company-1',
  role: 'admin',
  isActive: true,
};

/** A fake transaction whose only supported operation is the FOR UPDATE / limit
 *  select used to read (and lock) the Production Order row. Enough for the
 *  refusal branches, which throw before anything is written, and for the
 *  registry's loadForDiff. */
function selectOnlyTx(rows: unknown[]): DbTransaction {
  const builder: Record<string, unknown> = {};
  const self = (): Record<string, unknown> => builder;
  builder['from'] = self;
  builder['where'] = self;
  builder['leftJoin'] = self;
  builder['orderBy'] = self;
  builder['limit'] = self;
  builder['for'] = (): Promise<unknown[]> => Promise.resolve(rows);
  // Awaiting the builder directly (a select ending in .limit(1)) also resolves.
  builder['then'] = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown): unknown =>
    Promise.resolve(rows).then(resolve, reject);
  return { select: () => builder } as unknown as DbTransaction;
}

const openRow = {
  id: 'po-1',
  companyId: 'company-1',
  code: 'IN-PRO-00001',
  status: 'open',
  orderQty: 20,
  remarks: 'first cut',
  targetDate: '2026-01-10',
  actualSize: '25mm',
  rawMaterialAvailable: true,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('updateProductionOrderTx — qty is not editable', () => {
  it('refuses a payload that changes order_qty', async () => {
    const tx = selectOnlyTx([openRow]);
    await expect(
      updateProductionOrderTx(tx, 'po-1', { orderQty: 25 }, user),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      updateProductionOrderTx(tx, 'po-1', { orderQty: 25 }, user),
    ).rejects.toThrow('Change the Production Order quantity with Short Close, not edit.');
  });

  it('does not refuse when order_qty equals the stored value (no change)', async () => {
    const tx = selectOnlyTx([openRow]);
    // Passes the qty gate; it then fails on the unsupported tx.update of this
    // minimal fake tx — i.e. NOT a ConflictError about Short Close.
    await expect(
      updateProductionOrderTx(tx, 'po-1', { orderQty: 20, remarks: 'r' }, user),
    ).rejects.not.toThrow('Change the Production Order quantity with Short Close, not edit.');
  });
});

describe('updateProductionOrderTx — a stopped order is frozen', () => {
  it('refuses an edit on a closed order', async () => {
    const tx = selectOnlyTx([{ ...openRow, status: 'closed' }]);
    await expect(
      updateProductionOrderTx(tx, 'po-1', { remarks: 'x' }, user),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses an edit on a short-closed order', async () => {
    const tx = selectOnlyTx([{ ...openRow, status: 'short_closed' }]);
    await expect(
      updateProductionOrderTx(tx, 'po-1', { remarks: 'x' }, user),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('is NotFound when the row is gone', async () => {
    const tx = selectOnlyTx([]);
    await expect(updateProductionOrderTx(tx, 'po-1', { remarks: 'x' }, user)).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('productionOrderEditRegistryEntry.isLive', () => {
  it('is live for open and partially_closed, frozen for closed and short_closed', async () => {
    for (const [status, live] of [
      ['open', true],
      ['partially_closed', true],
      ['closed', false],
      ['short_closed', false],
    ] as const) {
      const target = await entry.loadForDiff(
        selectOnlyTx([{ ...openRow, status }]),
        'company-1',
        'po-1',
      );
      expect(target?.isLive).toBe(live);
    }
  });

  it('returns null when the order is not found', async () => {
    const target = await entry.loadForDiff(selectOnlyTx([]), 'company-1', 'po-1');
    expect(target).toBeNull();
  });
});

describe('productionOrderEditRegistryEntry — a header edit applies', () => {
  const target = { doc: openRow, updatedAt: openRow.updatedAt, docCode: openRow.code, isLive: true };

  it('snapshots only the four editable header fields', () => {
    expect(entry.beforeSnapshot(target)).toEqual({
      remarks: 'first cut',
      targetDate: '2026-01-10',
      actualSize: '25mm',
      rawMaterialAvailable: true,
    });
  });

  it('builds an after-snapshot and a change list for a header edit', async () => {
    const before = entry.beforeSnapshot(target);
    const after = await entry.afterSnapshot(
      {} as DbTransaction,
      'company-1',
      { remarks: 'reworked', targetDate: '2026-02-20', rawMaterialAvailable: false },
      user,
    );
    // Only the sent fields appear; actualSize (untouched) is omitted.
    expect(after).toEqual({
      remarks: 'reworked',
      targetDate: '2026-02-20',
      rawMaterialAvailable: false,
    });
    const changes = diffFields(before, after, PRODUCTION_ORDER_EDIT_FIELDS);
    const fields = changes.map((c) => c.field).sort();
    expect(fields).toEqual(['rawMaterialAvailable', 'remarks', 'targetDate']);
  });

  it('filters a proposed payload down to the approved fields only', () => {
    const payload = {
      remarks: 'reworked',
      targetDate: '2026-02-20',
      actualSize: '30mm',
      rawMaterialAvailable: false,
      orderQty: 99,
      reason: 'customer slipped the date',
    };
    const filtered = entry.buildFilteredInput(payload, new Set(['remarks', 'targetDate'])) as Record<
      string,
      unknown
    >;
    expect(filtered).toEqual({ remarks: 'reworked', targetDate: '2026-02-20' });
    // order_qty is never an approvable field, so it can never ride through.
    expect(filtered['orderQty']).toBeUndefined();
    expect(entry.buildFilteredInput(payload, new Set())).toBeNull();
  });
});
