// Edit-approval on a BOM: the requester's Revision Note rides WITH the approved
// change and becomes the note on the revision the approval writes (it used to be
// replaced by null). Pure, no database: the BOM writer is mocked and the two
// reads applyEdit makes are served by a tiny fake transaction. Run it via
// `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it, vi } from 'vitest';
import type { UpdateBomMasterInput } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';

const writer = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('./service', () => ({
  updateBomMasterTx: vi.fn((_tx: unknown, _id: string, input: unknown) => {
    writer.calls.push(input);
    return Promise.resolve({});
  }),
}));

const { bomEditRegistryEntry: entry } = await import('./bom-edit-registry');

const user: AuthContext = {
  id: 'u-1',
  email: 'design@innovic.test',
  companyId: 'c-1',
  role: 'manager',
  isActive: true,
};

/** Every select resolves to the next queued result, whatever the chain. */
function fakeTx(results: unknown[][]): DbTransaction {
  const select = (): unknown => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'leftJoin', 'orderBy', 'limit', 'for']) b[m] = () => b;
    b['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(results.shift() ?? []).then(res, rej);
    return b;
  };
  return { select } as unknown as DbTransaction;
}

const header = {
  bomNo: 'BOM-0001',
  bomName: 'Pump set',
  parentItemId: 'p-1',
  status: 'active',
};
const line = {
  childItemId: 'c-1',
  qtyPerSet: '2.000',
  bomType: 'manufacture',
  rawMaterialGradeId: null,
  rawMaterialGradeText: null,
  rawMaterialSizeId: null,
  rawMaterialSizeText: null,
};
const proposed = {
  ...header,
  lines: [{ childItemId: 'c-1', qtyPerSet: 3, bomType: 'manufacture' }],
  revisionNote: 'Customer asked for 3 per set',
} as unknown as UpdateBomMasterInput;

describe('BOM edit-approval — Revision Note', () => {
  it('is carried with the approved change and written on the revision', async () => {
    writer.calls.length = 0;
    const filtered = entry.buildFilteredInput(proposed, new Set(['line:c-1:qty']));
    await entry.applyEdit(fakeTx([[header], [line]]), 'c-1', 'bom-1', filtered, 'tok', user);
    const sent = writer.calls[0] as UpdateBomMasterInput;
    expect(sent.revisionNote).toBe('Customer asked for 3 per set');
    expect(sent.lines[0]?.qtyPerSet).toBe(3);
  });

  it('a LATER decide call that applies more does not repeat the note', async () => {
    writer.calls.length = 0;
    const filtered = entry.buildFilteredInput(proposed, new Set(['line:c-1:qty']), {
      firstApply: false,
    });
    await entry.applyEdit(fakeTx([[header], [line]]), 'c-1', 'bom-1', filtered, 'tok', user);
    expect((writer.calls[0] as UpdateBomMasterInput).revisionNote).toBeNull();
  });

  it('blank stays blank (the writer then writes its own diff note)', async () => {
    writer.calls.length = 0;
    const withoutNote: UpdateBomMasterInput = { ...proposed };
    delete withoutNote.revisionNote;
    const filtered = entry.buildFilteredInput(withoutNote, new Set(['line:c-1:qty']));
    await entry.applyEdit(fakeTx([[header], [line]]), 'c-1', 'bom-1', filtered, 'tok', user);
    expect((writer.calls[0] as UpdateBomMasterInput).revisionNote).toBeNull();
  });
});
