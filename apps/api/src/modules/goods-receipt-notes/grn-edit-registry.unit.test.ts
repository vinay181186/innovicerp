// ADR-249 Step B1 — a GRN's edit goes for approval whenever the GRN is not
// deleted, fully QC-inspected included. Pure, no database: the GRN service is
// mocked and the transaction is a fake query chain.
// Run via `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/with-user-context';

vi.mock('./service', () => ({
  GRN_HEADER_FIELDS: [
    { key: 'grnDate', label: 'GRN Date' },
    { key: 'remarks', label: 'Remarks' },
  ],
  readGrnAuditSnapshot: vi.fn(() =>
    Promise.resolve({ header: { grnDate: '2026-10-01', remarks: null } }),
  ),
  updateGoodsReceiptNoteTx: vi.fn(() => Promise.resolve({})),
}));

const { grnEditRegistryEntry: entry, grnIsLive } = await import('./grn-edit-registry');

/** Each `select()` starts a chain that resolves to the next queued result. */
function fakeTx(results: unknown[][]): { tx: DbTransaction; selects: () => number } {
  let i = 0;
  const chain = (): unknown => {
    const rows = results[i++] ?? [];
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'orderBy', 'innerJoin', 'leftJoin']) {
      c[m] = () => c;
    }
    c['for'] = () => Promise.resolve(rows);
    c['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej);
    return c;
  };
  return { tx: { select: () => chain() } as unknown as DbTransaction, selects: () => i };
}

describe('grnIsLive', () => {
  it('a GRN that is not deleted is live', () => {
    expect(grnIsLive({ deletedAt: null })).toBe(true);
  });
  it('a deleted GRN is not live', () => {
    expect(grnIsLive({ deletedAt: new Date() })).toBe(false);
  });
});

describe('grnEditRegistryEntry.loadForDiff — live rule', () => {
  it('a fully QC-inspected GRN is live (no line read decides it any more)', async () => {
    const { tx, selects } = fakeTx([
      [{ id: 'g-1', code: 'GRN-0001', updatedAt: '2026-10-02T00:00:00Z', deletedAt: null }],
    ]);
    const target = await entry.loadForDiff(tx, 'c-1', 'g-1');
    expect(target?.isLive).toBe(true);
    expect(target?.docCode).toBe('GRN-0001');
    // Only the header row is read — the old "a line still waits for QC" query is gone.
    expect(selects()).toBe(1);
  });
  it('a GRN that is not found (deleted / other company) gives no target', async () => {
    const { tx } = fakeTx([[]]);
    expect(await entry.loadForDiff(tx, 'c-1', 'g-x')).toBeNull();
  });
});
