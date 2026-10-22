// Edit-approval on a live Job Card: its raw material is three approvable boxes —
// RM Grade, RM Size, and RM Item (with its qty per piece) — a box appears only for
// a real change to what is stored, and only an APPROVED box reaches
// the writer. Pure, no database: the JC service is mocked down to what the
// registry entry imports, and each read is served by a tiny fake transaction.
// Run it via `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it, vi } from 'vitest';
import type { JobCardWriteInput } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields } from '../../lib/audit-trail';
import type { DocEditTarget } from '../document-edits/registry';

const writer = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('./service', () => ({
  JC_EDIT_FIELDS: [
    { key: 'jcDate', label: 'JC Date' },
    { key: 'itemCode', label: 'Item Code' },
    { key: 'orderQty', label: 'JC Qty' },
    { key: 'priority', label: 'Priority' },
    { key: 'dueDate', label: 'Due Date' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'drawingFilePath', label: 'Drawing' },
  ],
  jcOpEditable: () => true,
  jcOpRemovable: () => true,
  loadJcOpsForEdit: vi.fn(() => Promise.resolve([])),
  updateJobCardTx: vi.fn((_tx: unknown, _id: string, input: unknown) => {
    writer.calls.push(input);
    return Promise.resolve(null);
  }),
}));
vi.mock('../../lib/access', () => ({ canSeeFormPrice: vi.fn(() => Promise.resolve(true)) }));

const { jobCardEditRegistryEntry: entry } = await import('./jobcard-edit-registry');

const user: AuthContext = {
  id: 'u-1',
  email: 'planner@innovic.test',
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

const target: DocEditTarget = {
  doc: {
    jcDate: '2026-10-01',
    itemCode: 'SHAFT-01',
    orderQty: 10,
    priority: 'normal',
    dueDate: null,
    remarks: null,
    drawingFilePath: null,
    rawMaterialGradeId: 'g-1',
    rawMaterialGradeText: 'EN8',
    rawMaterialSizeId: null,
    rawMaterialSizeText: 'Dia 40',
    rawMaterialItemId: 'i-1',
    rawMaterialItemCode: 'RM-EN8-40',
    rmQtyPerPiece: 0.5,
    ops: [],
    terminalQcOpId: null,
  },
  updatedAt: '2026-10-01T00:00:00.000Z',
  docCode: 'IN-JC-00001',
  isLive: true,
};

const header: JobCardWriteInput = {
  jcDate: '2026-10-01',
  itemCode: 'SHAFT-01',
  orderQty: 10,
  priority: 'normal',
  dueDate: null,
  drawingFilePath: null,
  remarks: null,
  sourceSoLineId: null,
  sourceJwLineId: null,
  // The card's current raw material, sent back unchanged (the JC screens always
  // send both sides).
  rawMaterialGradeId: 'g-1',
  rawMaterialGradeText: 'EN8',
  rawMaterialSizeId: null,
  rawMaterialSizeText: 'Dia 40',
  qcDocs: [],
} as unknown as JobCardWriteInput;

async function changesFor(input: JobCardWriteInput, reads: unknown[][] = [], on = target) {
  const after = await entry.afterSnapshot(fakeTx(reads), 'c-1', input, user, on);
  return diffFields(entry.beforeSnapshot(on), after, entry.diffFields(on, input));
}

describe('JC edit-approval — RM Grade / RM Size boxes', () => {
  it('a different grade from the master shows by NAME, labelled RM Grade', async () => {
    const input = { ...header, rawMaterialGradeId: 'g-2', rawMaterialGradeText: null };
    // The one read: the grade master's name for g-2.
    expect(await changesFor(input, [[{ name: 'EN19' }]])).toEqual([
      { field: 'rawMaterialGrade', label: 'RM Grade', before: 'EN8', after: 'EN19' },
    ]);
  });

  it('the same grade id is no box, even when the master was renamed since', async () => {
    // No read is queued: an unchanged id is decided without asking the master.
    const input = { ...header, rawMaterialGradeId: 'g-1', rawMaterialGradeText: 'EN-8 (new name)' };
    expect(await changesFor(input)).toEqual([]);
  });

  it('the same grade id on a legacy card with a blank snapshot is no box', async () => {
    const legacy = { ...target, doc: { ...target.doc, rawMaterialGradeText: null } };
    const input = { ...header, rawMaterialGradeId: 'g-1', rawMaterialGradeText: null };
    expect(await changesFor(input, [], legacy)).toEqual([]);
  });

  it('a typed size is compared as text', async () => {
    const same = { ...header, rawMaterialSizeId: null, rawMaterialSizeText: ' Dia 40 ' };
    expect(await changesFor(same)).toEqual([]);
    const moved = { ...header, rawMaterialSizeId: null, rawMaterialSizeText: 'Dia 45' };
    expect((await changesFor(moved)).map((c) => [c.label, c.after])).toEqual([
      ['RM Size', 'Dia 45'],
    ]);
  });

  it('an OMITTED grade is a clear, exactly as the direct writer reads it', async () => {
    const input = { ...header } as Record<string, unknown>;
    delete input['rawMaterialGradeId'];
    delete input['rawMaterialGradeText'];
    expect(
      (await changesFor(input as unknown as JobCardWriteInput)).map((c) => [c.label, c.after]),
    ).toEqual([['RM Grade', null]]);
  });

  it('unlinking a grade that keeps its words still shows, never "EN8 → EN8"', async () => {
    const input = { ...header, rawMaterialGradeId: null, rawMaterialGradeText: 'EN8' };
    expect((await changesFor(input)).map((c) => [c.before, c.after])).toEqual([
      ['EN8', 'EN8 (typed)'],
    ]);
  });
});

describe('JC edit-approval — RM Item is ONE box with its qty per piece', () => {
  it('item and qty changed together read "code × qty"', async () => {
    const input = { ...header, rawMaterialItemId: 'i-9', rmQtyPerPiece: 0.75 };
    expect(await changesFor(input, [[{ code: 'RM-EN19-45' }]])).toEqual([
      {
        field: 'rawMaterialItem',
        label: 'RM Item',
        before: 'RM-EN8-40 × 0.5',
        after: 'RM-EN19-45 × 0.75',
      },
    ]);
  });

  it('a qty-only change keeps the stored item in the same box', async () => {
    const input = { ...header, rmQtyPerPiece: 0.6 };
    expect((await changesFor(input)).map((c) => c.after)).toEqual(['RM-EN8-40 × 0.6']);
  });
});

describe('JC edit-approval — applyEdit sends only approved raw material', () => {
  const head = {
    jcDate: '2026-10-01',
    orderQty: 10,
    priority: 'normal',
    dueDate: null,
    drawingFilePath: null,
    remarks: null,
    sourceSoLineId: null,
    sourceJwLineId: null,
    rawMaterialGradeId: 'g-1',
    rawMaterialGradeText: 'EN8',
    rawMaterialSizeId: null,
    rawMaterialSizeText: 'Dia 40',
    rawMaterialItemId: 'i-1',
    rmQtyPerPiece: 0.5,
    itemCode: 'SHAFT-01',
  };
  const proposed = {
    ...header,
    rawMaterialGradeId: 'g-2',
    rawMaterialGradeText: 'EN19',
    rawMaterialItemId: 'i-9',
    rmQtyPerPiece: 0.75,
  };

  it('approved RM Grade is written; the unapproved RM item pair is left out', async () => {
    writer.calls.length = 0;
    const filtered = entry.buildFilteredInput(proposed, new Set(['rawMaterialGrade']));
    await entry.applyEdit(fakeTx([[head]]), 'c-1', 'jc-1', filtered, null, user);
    const sent = writer.calls[0] as Record<string, unknown>;
    expect(sent['rawMaterialGradeId']).toBe('g-2');
    expect(sent['rawMaterialGradeText']).toBe('EN19');
    expect(sent['rawMaterialSizeText']).toBe('Dia 40');
    expect('rawMaterialItemId' in sent).toBe(false);
    expect('rmQtyPerPiece' in sent).toBe(false);
  });

  it('an approved RM Item box writes the item AND its qty together', async () => {
    writer.calls.length = 0;
    const filtered = entry.buildFilteredInput(proposed, new Set(['rawMaterialItem']));
    await entry.applyEdit(fakeTx([[head]]), 'c-1', 'jc-1', filtered, null, user);
    const sent = writer.calls[0] as Record<string, unknown>;
    expect(sent['rawMaterialItemId']).toBe('i-9');
    expect(sent['rmQtyPerPiece']).toBe(0.75);
    expect(sent['rawMaterialGradeId']).toBe('g-1');
  });

  it('a qty-only request keeps the stored item', async () => {
    writer.calls.length = 0;
    const filtered = entry.buildFilteredInput(
      { ...header, rmQtyPerPiece: 0.6 },
      new Set(['rawMaterialItem']),
    );
    await entry.applyEdit(fakeTx([[head]]), 'c-1', 'jc-1', filtered, null, user);
    const sent = writer.calls[0] as Record<string, unknown>;
    expect(sent['rawMaterialItemId']).toBe('i-1');
    expect(sent['rmQtyPerPiece']).toBe(0.6);
  });
});

describe('JC edit-approval — an added operation that carries a price', () => {
  const ops = (cost: number) => [
    { operation: 'Plating', opType: 'outsource', outsourceVendorCode: 'V1', outsourceCost: cost },
  ];

  it('an op:add with an outsource cost needs price sight to approve', () => {
    expect(entry.carriesPrice?.('op:add:0', { ...header, ops: ops(25) })).toBe(true);
  });

  it('an op:add with no cost, or any other box, does not', () => {
    expect(entry.carriesPrice?.('op:add:0', { ...header, ops: ops(0) })).toBe(false);
    expect(entry.carriesPrice?.('rawMaterialGrade', { ...header, ops: ops(25) })).toBe(false);
  });
});
