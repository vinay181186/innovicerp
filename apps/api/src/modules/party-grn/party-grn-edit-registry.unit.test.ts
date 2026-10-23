// ADR-249 Step B1 — a Party GRN's edit goes for approval whenever it is not
// cancelled, fully QC'd included. Pure, no database: the Party GRN service is
// mocked and the transaction is a fake query chain.
// Run via `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/with-user-context';

vi.mock('./service', () => ({
  PARTY_GRN_HEADER_FIELDS: [
    { key: 'grnDate', label: 'GRN Date' },
    { key: 'dcNo', label: 'Customer Challan No.' },
  ],
  isPendingQc: (l: { qcAt: unknown; acceptedQty: number; rejectedQty: number }) =>
    l.qcAt == null && l.acceptedQty === 0 && l.rejectedQty === 0,
  updatePartyGrnTx: vi.fn(() => Promise.resolve({})),
}));

const { partyGrnEditRegistryEntry: entry, partyGrnIsLive } =
  await import('./party-grn-edit-registry');

function fakeTx(results: unknown[][]): DbTransaction {
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
  return { select: () => chain() } as unknown as DbTransaction;
}

const head = {
  id: 'p-1',
  code: 'IN-PGRN-0001',
  grnDate: '2026-10-01',
  dcNo: 'CH-1',
  remarks: null,
  receivedByText: null,
  updatedAt: '2026-10-02T00:00:00Z',
  deletedAt: null,
};
const line = (id: string, lineNo: number, qcd: boolean) => ({
  id,
  lineNo,
  receivedQty: 10,
  remarks: null,
  qcAt: qcd ? '2026-10-02T00:00:00Z' : null,
  acceptedQty: qcd ? 10 : 0,
  rejectedQty: 0,
});

describe('partyGrnIsLive', () => {
  it('a Party GRN that is not cancelled is live', () => {
    expect(partyGrnIsLive({ deletedAt: null })).toBe(true);
  });
  it('a cancelled (soft-deleted) Party GRN is not live', () => {
    expect(partyGrnIsLive({ deletedAt: new Date() })).toBe(false);
  });
});

describe('partyGrnEditRegistryEntry.loadForDiff — live rule', () => {
  it('a fully QC-d Party GRN is live, with no line keys (header only)', async () => {
    const tx = fakeTx([[head], [line('l-1', 1, true), line('l-2', 2, true)]]);
    const target = await entry.loadForDiff(tx, 'c-1', 'p-1');
    expect(target?.isLive).toBe(true);
    expect(target?.doc['lines']).toEqual([]);
    const keys = entry.diffFields(target!, {}).map((f) => f.key);
    expect(keys).toEqual(['grnDate', 'dcNo']);
  });
  it('a Party GRN with a waiting line is live and keeps only that line in the diff', async () => {
    const tx = fakeTx([[head], [line('l-1', 1, true), line('l-2', 2, false)]]);
    const target = await entry.loadForDiff(tx, 'c-1', 'p-1');
    expect(target?.isLive).toBe(true);
    const keys = entry.diffFields(target!, {}).map((f) => f.key);
    expect(keys).toContain('line:l-2:qty');
    expect(keys).not.toContain('line:l-1:qty');
  });
  it('a cancelled Party GRN is not loaded at all', async () => {
    const tx = fakeTx([[]]);
    expect(await entry.loadForDiff(tx, 'c-1', 'p-1')).toBeNull();
  });
});
