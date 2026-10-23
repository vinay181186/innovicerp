// Multi-Level BOM edit-approval (ADR-249 Step B2): the "BOM Lines" box text and
// its freshness, and the "Default" box. Pure, no database: the writers are
// mocked and the reads afterSnapshot makes are served by a tiny fake
// transaction. Run via `npx vitest run --config vitest.unit.config.ts`.

import { describe, expect, it, vi } from 'vitest';
import type { UpdateMlBomInput } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields, valuesEqual } from '../../lib/audit-trail';
import type { DocEditTarget } from '../document-edits/registry';

vi.mock('./writes', () => ({ updateMlBomTx: vi.fn() }));
vi.mock('./default-delete', () => ({ makeDefaultMlBomTx: vi.fn() }));
vi.mock('./guards', () => ({ lockMlBomTree: vi.fn() }));
vi.mock('./reads', () => ({ ML_BOM_NOT_FOUND: 'not found' }));

const { mlBomEditRegistryEntry: entry } = await import('./ml-bom-edit-registry');
const { canonQty, describeDefault, summarizeMlBomLines } = await import('./ml-bom-edit-summary');

const user: AuthContext = {
  id: 'u-1',
  email: 'design@innovic.test',
  companyId: 'c-1',
  role: 'manager',
  isActive: true,
};

const SHAFT = '11111111-1111-4111-8111-111111111111';
const BRG = '22222222-2222-4222-8222-222222222222';
const GRADE = '33333333-3333-4333-8333-333333333333';

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

/** A target as loadForDiff projects it: stored lines with stored text. */
function target(over: Record<string, unknown> = {}): DocEditTarget {
  return {
    doc: {
      remarks: 'first cut',
      isDefault: false,
      otherDefaultCode: 'IN-MLB-00002',
      lines: [
        {
          childCode: 'SHAFT-10',
          qtyPerSet: '2.000',
          bomType: 'manufacture',
          rmGrade: 'EN8',
          rmSize: null,
          remarks: null,
        },
        {
          childCode: 'BRG-6204',
          qtyPerSet: '4.000',
          bomType: 'purchase',
          rmGrade: null,
          rmSize: null,
          remarks: null,
        },
      ],
      ...over,
    },
    updatedAt: '2026-10-20T10:00:00.000Z',
    docCode: 'IN-MLB-00007',
    isLive: true,
  };
}

const proposed = (lines: UpdateMlBomInput['lines'], remarks?: string): UpdateMlBomInput => ({
  itemId: '44444444-4444-4444-8444-444444444444',
  lines,
  ...(remarks !== undefined ? { remarks } : {}),
});

/** The reads afterSnapshot makes, in order: item codes, then grade names. */
const lookups = (): DbTransaction =>
  fakeTx([
    [
      { id: SHAFT, code: 'SHAFT-10' },
      { id: BRG, code: 'BRG-6204' },
    ],
    [{ id: GRADE, name: 'EN8' }],
  ]);

const sameLines: UpdateMlBomInput['lines'] = [
  { childItemId: SHAFT, qtyPerSet: 2, bomType: 'manufacture', rawMaterialGradeId: GRADE },
  // RM typed on a Buy line is not stored (lines.ts keepsRawMaterial) → no change.
  { childItemId: BRG, qtyPerSet: 4, bomType: 'purchase', rawMaterialGradeText: 'ignored' },
];

async function changesFor(input: UpdateMlBomInput, t = target()) {
  const before = entry.beforeSnapshot(t);
  const after = await entry.afterSnapshot(lookups(), 'c-1', { op: 'revise', input }, user, t);
  return diffFields(before, after, entry.diffFields(t));
}

describe('summarizeMlBomLines', () => {
  it('reads child code × qty per line, with type and RM', () => {
    expect(
      summarizeMlBomLines([
        {
          childCode: 'SHAFT-10',
          qtyPerSet: '2.500',
          bomType: 'manufacture',
          rmGrade: 'EN8',
          rmSize: '25 DIA',
          remarks: ' turned ',
        },
        {
          childCode: 'BRG-6204',
          qtyPerSet: '4.000',
          bomType: 'purchase',
          rmGrade: 'x',
          rmSize: null,
          remarks: null,
        },
      ]),
    ).toBe('1. SHAFT-10 × 2.5 Manufacture [RM EN8 / 25 DIA] "turned"; 2. BRG-6204 × 4 Buy');
  });

  it('qty compares as the save rounds it', () => {
    expect(canonQty('2.000')).toBe('2');
    expect(canonQty(2)).toBe('2');
    expect(canonQty(0.1236)).toBe(String(Number((0.1236).toFixed(3)))); // same toFixed(3) as buildLineValues
  });
});

describe('BOM Lines box', () => {
  it('stored lines vs the same lines resubmitted → nothing to approve', async () => {
    expect(await changesFor(proposed(sameLines))).toEqual([]);
  });

  it('a qty change is ONE "BOM Lines" box with before → after text', async () => {
    const lines = [{ ...sameLines[0]!, qtyPerSet: 3 }, sameLines[1]!];
    const changes = await changesFor(proposed(lines));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: 'lines',
      label: 'BOM Lines',
      before: '1. SHAFT-10 × 2 Manufacture [RM EN8 / —]; 2. BRG-6204 × 4 Buy',
      after: '1. SHAFT-10 × 3 Manufacture [RM EN8 / —]; 2. BRG-6204 × 4 Buy',
    });
  });

  it('a line order swap is a change (the order is saved)', async () => {
    const changes = await changesFor(proposed([sameLines[1]!, sameLines[0]!]));
    expect(changes.map((c) => c.field)).toEqual(['lines']);
  });

  it('remarks are their own box; omitted remarks are not touched', async () => {
    expect(await changesFor(proposed(sameLines, 'second cut'))).toMatchObject([
      { field: 'remarks', before: 'first cut', after: 'second cut' },
    ]);
    expect(await changesFor(proposed(sameLines))).toEqual([]);
  });

  it('freshness: a stored-line change after the request reads as superseded', async () => {
    const lines = [{ ...sameLines[0]!, qtyPerSet: 3 }, sameLines[1]!];
    const [staged] = await changesFor(proposed(lines));
    // Unchanged document → the fresh "before" equals the staged one.
    const [freshSame] = await changesFor(proposed(lines));
    expect(valuesEqual(freshSame!.before, staged!.before)).toBe(true);
    // Someone changed the BRG qty meanwhile → the fresh "before" differs.
    const moved = target();
    (moved.doc['lines'] as Array<Record<string, unknown>>)[1]!['qtyPerSet'] = '6.000';
    const [freshMoved] = await changesFor(proposed(lines), moved);
    expect(valuesEqual(freshMoved!.before, staged!.before)).toBe(false);
  });
});

describe('Default box', () => {
  it('names the BOM it takes over from', async () => {
    const t = target();
    const after = await entry.afterSnapshot(fakeTx([]), 'c-1', { op: 'makeDefault' }, user, t);
    expect(diffFields(entry.beforeSnapshot(t), after, entry.diffFields(t))).toMatchObject([
      {
        field: 'isDefault',
        label: 'Default',
        before: 'No — IN-MLB-00002 is the Default',
        after: 'Yes',
      },
    ]);
  });

  it('already Default → nothing to approve', async () => {
    const t = target({ isDefault: true, otherDefaultCode: null });
    const after = await entry.afterSnapshot(fakeTx([]), 'c-1', { op: 'makeDefault' }, user, t);
    expect(diffFields(entry.beforeSnapshot(t), after, entry.diffFields(t))).toEqual([]);
  });

  it('a Default that moved to a third BOM is a different "before" (superseded)', () => {
    expect(describeDefault(false, 'IN-MLB-00002')).not.toBe(describeDefault(false, 'IN-MLB-00009'));
    expect(describeDefault(false, null)).toBe('No — no Default yet');
  });
});

describe('buildFilteredInput', () => {
  it('carries the revision note on the first apply only', () => {
    const p = { op: 'revise' as const, input: { ...proposed(sameLines), revisionNote: 'why' } };
    const first = entry.buildFilteredInput(p, new Set(['lines']), { firstApply: true });
    const later = entry.buildFilteredInput(p, new Set(['remarks']), { firstApply: false });
    expect(first).toMatchObject({ lines: true, remarks: false, revisionNote: 'why' });
    expect(later).toMatchObject({ lines: false, remarks: true, revisionNote: null });
    expect(entry.buildFilteredInput(p, new Set(), { firstApply: true })).toBeNull();
  });
});
