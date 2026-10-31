// Route Card edit-approval (ADR-249 Step B2): the "Operations" box summary and
// its freshness check. Pure, no database — the writer and the plans pre-lock
// are mocked and every read is served by a tiny fake transaction. Run it via
// `npx vitest run --config vitest.unit.config.ts`.

import { describe, expect, it, vi } from 'vitest';
import type { UpdateRouteCardInput } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields, valuesEqual } from '../../lib/audit-trail';
import {
  routingNotSentReason,
  routingSummary,
  type RoutingSummaryOp,
} from './route-card-edit-common';

const writer = vi.hoisted(() => ({ calls: [] as unknown[][], sourceCalls: [] as unknown[][] }));
vi.mock('./service', () => ({
  updateRouteCardTx: vi.fn((...args: unknown[]) => {
    writer.calls.push(args);
    return Promise.resolve({});
  }),
  overwriteRouteCardFromSource: vi.fn((...args: unknown[]) => {
    writer.sourceCalls.push(args);
    return Promise.resolve(null);
  }),
  labelOf: (map: Record<string, string>) => (v: unknown) =>
    v === null || v === undefined || v === '' ? null : (map[String(v)] ?? String(v)),
  PLAN_TYPE_LABEL: { manufacture: 'Manufacture', full_outsource: 'Full Outsource' },
  // The same ADR-218 test as service.ts rmHalvesToFill (blank card half +
  // non-blank incoming; the RM item as a pair).
  rmHalvesToFill: (
    card: Record<string, unknown>,
    inc: Record<string, unknown>,
  ): { grade: boolean; size: boolean; rmItem: boolean } => {
    const blank = (v: unknown): boolean => v == null || String(v).trim() === '';
    return {
      grade: blank(card['rawMaterialGradeText']) && !blank(inc['rawMaterialGradeText']),
      size: blank(card['rawMaterialSizeText']) && !blank(inc['rawMaterialSizeText']),
      rmItem:
        card['rawMaterialItemId'] == null &&
        card['rmQtyPerPiece'] == null &&
        Boolean(inc['rawMaterialItemId']) &&
        inc['rmQtyPerPiece'] != null,
    };
  },
}));
const preLock = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../plans/rm-backfill', () => ({
  lockBackfillCandidates: vi.fn(() => {
    preLock.calls += 1;
    return Promise.resolve();
  }),
}));

const { routeCardEditRegistryEntry: entry } = await import('./route-card-edit-registry');
const { stagingFromSourceDoc } = await import('./route-card-edit-common');

const user: AuthContext = {
  id: 'u-1',
  email: 'planning@innovic.test',
  companyId: 'co-1',
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

const card = {
  id: 'rc-1',
  companyId: 'co-1',
  code: 'IN-RC-00005',
  itemId: 'it-1',
  currentRevision: 2,
  rawMaterialGradeId: null,
  rawMaterialGradeText: 'EN24',
  rawMaterialSizeId: null,
  rawMaterialSizeText: 'DIA 32',
  rawMaterialItemId: null,
  rmQtyPerPiece: null,
  notes: null,
  planType: 'manufacture',
  updatedAt: new Date('2026-10-20T10:00:00Z'),
};
const opRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'op-1',
  opSeq: 1,
  machineId: 'm-1',
  machineCodeText: null,
  operation: 'Turning',
  opType: 'process',
  cycleTimeMin: '5.00',
  program: null,
  toolNo: 'T3',
  toolDetails: null,
  remarks: null,
  qcRequired: false,
  ospVendorId: null,
  ospVendorCodeText: null,
  ospLeadDays: null,
  ...over,
});

/** The reads loadForDiff makes, in order: pre-read, card row, ops, item
 *  codes, machine codes (no vendor ids → no vendor query). */
function loadReads(ops: Record<string, unknown>[]): unknown[][] {
  return [[{ itemId: 'it-1' }], [card], ops, [{ id: 'm-1', code: 'CNC-1' }]];
}

const proposal = {
  code: card.code,
  itemId: 'it-1',
  rawMaterialGradeText: 'EN24',
  rawMaterialSizeText: 'DIA 32',
  planType: 'manufacture',
  notes: null,
  ops: [
    {
      machineId: 'm-1',
      operation: 'Turning',
      opType: 'process',
      cycleTimeMin: 5,
      toolNo: 'T3',
      qcRequired: false,
    },
    {
      machineId: 'm-1',
      operation: 'Facing',
      opType: 'process',
      cycleTimeMin: 2.5,
      qcRequired: false,
    },
  ],
  revisionNote: null,
} as unknown as UpdateRouteCardInput;

describe('Route Card routing summary', () => {
  const op: RoutingSummaryOp = {
    opSeq: 1,
    operation: 'Turning',
    opType: 'process',
    machineCode: 'CNC-1',
    ospVendorCode: null,
    cycleTimeMin: '5.00',
    ospLeadDays: null,
    program: null,
    toolNo: null,
    toolDetails: null,
    remarks: null,
    qcRequired: false,
  };
  const rm = {
    rawMaterialGradeText: 'EN24',
    rawMaterialSizeText: 'DIA 32',
    rawMaterialItemCode: null,
    rmQtyPerPiece: null,
  };

  it('reads as op no., name, kind, machine and cycle time, then the RM', () => {
    expect(routingSummary([op], rm)).toBe(
      '10 Turning (In-house, CNC-1, 5 min) | RM: EN24 / DIA 32',
    );
  });

  it('names an OSP step by its vendor and lead days, and the RM item pair', () => {
    const osp: RoutingSummaryOp = {
      ...op,
      opSeq: 2,
      operation: 'Plating',
      opType: 'outsource',
      machineCode: null,
      ospVendorCode: 'V-ZN',
      cycleTimeMin: 0,
      ospLeadDays: 3,
    };
    expect(
      routingSummary([osp, op], { ...rm, rawMaterialItemCode: 'RM-EN24', rmQtyPerPiece: '1.5000' }),
    ).toBe(
      '10 Turning (In-house, CNC-1, 5 min) · 20 Plating (OSP, V-ZN, 0 min, lead 3d)' +
        ' | RM: EN24 / DIA 32, RM Item RM-EN24 × 1.5 per piece',
    );
  });

  it('is canonical: "5.00" stored and 5 proposed are the same value', () => {
    expect(routingSummary([op], rm)).toBe(routingSummary([{ ...op, cycleTimeMin: 5 }], rm));
  });

  it('never truncates a long remark (drift past char 40 must still show)', () => {
    const long = 'x'.repeat(60);
    expect(routingSummary([{ ...op, remarks: `${long}A` }], rm)).not.toBe(
      routingSummary([{ ...op, remarks: `${long}B` }], rm),
    );
  });

  it('every stored field moves the text (tool, program, QC, remarks, RM)', () => {
    const base = routingSummary([op], rm);
    for (const drift of [
      { toolNo: 'T9' },
      { program: 'P1' },
      { toolDetails: 'insert' },
      { remarks: 'deburr' },
      { qcRequired: true },
      { machineCode: 'CNC-2' },
      { cycleTimeMin: 6 },
    ]) {
      expect(routingSummary([{ ...op, ...drift }], rm)).not.toBe(base);
    }
    expect(routingSummary([op], { ...rm, rawMaterialSizeText: 'DIA 36' })).not.toBe(base);
  });
});

describe('Route Card edit-approval — Operations box freshness', () => {
  it('stages ONE Operations box for a routing change, header untouched', async () => {
    const target = (await entry.loadForDiff(fakeTx(loadReads([opRow()])), 'co-1', 'rc-1'))!;
    const before = entry.beforeSnapshot(target);
    const after = await entry.afterSnapshot(
      fakeTx([[{ id: 'm-1', code: 'CNC-1' }]]),
      'co-1',
      proposal,
      user,
      target,
    );
    const changes = diffFields(before, after, entry.diffFields(target, proposal));
    expect(changes.map((c) => c.label)).toEqual(['Operations']);
    expect(changes[0]!.before).toBe(
      '10 Turning (In-house, CNC-1, 5 min, Tool T3) | RM: EN24 / DIA 32',
    );
    expect(changes[0]!.after).toBe(
      '10 Turning (In-house, CNC-1, 5 min, Tool T3) · 20 Facing (In-house, CNC-1, 2.5 min) | RM: EN24 / DIA 32',
    );
  });

  it('a stored op that drifted after the request no longer matches → superseded', async () => {
    const atRequest = entry.beforeSnapshot(
      (await entry.loadForDiff(fakeTx(loadReads([opRow()])), 'co-1', 'rc-1'))!,
    );
    const unchanged = entry.beforeSnapshot(
      (await entry.loadForDiff(fakeTx(loadReads([opRow()])), 'co-1', 'rc-1'))!,
    );
    const drifted = entry.beforeSnapshot(
      (await entry.loadForDiff(fakeTx(loadReads([opRow({ toolNo: 'T4' })])), 'co-1', 'rc-1'))!,
    );
    // The engine's own freshness test (decideDocumentEdit).
    expect(valuesEqual(unchanged['operations'], atRequest['operations'])).toBe(true);
    expect(valuesEqual(drifted['operations'], atRequest['operations'])).toBe(false);
  });

  it('takes the plans pre-lock, except when staged from a JC / plan transaction', async () => {
    preLock.calls = 0;
    await entry.loadForDiff(fakeTx(loadReads([opRow()])), 'co-1', 'rc-1');
    expect(preLock.calls).toBe(1);
    await stagingFromSourceDoc.run(true, () =>
      entry.loadForDiff(fakeTx(loadReads([opRow()])), 'co-1', 'rc-1'),
    );
    expect(preLock.calls).toBe(1);
  });
});

describe('Route Card edit-approval — apply', () => {
  it('nothing approved → nothing to apply', () => {
    expect(entry.buildFilteredInput(proposal, new Set())).toBeNull();
  });

  it('form edit, Operations approved → the proposed ops + RM go through the form writer', async () => {
    writer.calls.length = 0;
    writer.sourceCalls.length = 0;
    const filtered = entry.buildFilteredInput(proposal, new Set(['operations']));
    await entry.applyEdit(fakeTx([[card]]), 'co-1', 'rc-1', filtered, 'tok', user);
    const [, id, sent] = writer.calls[0]!;
    expect(id).toBe('rc-1');
    expect((sent as UpdateRouteCardInput).ops).toHaveLength(2);
    expect((sent as UpdateRouteCardInput).rawMaterialGradeText).toBe('EN24');
    expect((sent as UpdateRouteCardInput).expectedUpdatedAt).toBe('tok');
    expect(writer.sourceCalls).toHaveLength(0);
  });

  it('JC / plan proposal → replayed through the GATE-OFF writer, not the form writer', async () => {
    writer.calls.length = 0;
    writer.sourceCalls.length = 0;
    for (const fillRm of [true, false]) {
      const filtered = entry.buildFilteredInput(
        { ...proposal, sourceCode: 'IN-JC-26-00012', fillRm },
        new Set(['operations']),
      );
      await entry.applyEdit(fakeTx([[card]]), 'co-1', 'rc-1', filtered, 'tok', user);
    }
    expect(writer.calls).toHaveLength(0);
    const [first, second] = writer.sourceCalls;
    const [, companyId, sentCard, ops, rm, , sourceCode, canWrite] = first!;
    expect(companyId).toBe('co-1');
    expect((sentCard as { id: string }).id).toBe('rc-1');
    expect(ops).toHaveLength(2);
    expect((rm as { rawMaterialGradeText: string }).rawMaterialGradeText).toBe('EN24');
    expect(sourceCode).toBe('IN-JC-26-00012');
    // The blank-RM fill follows the PROPOSER's right, frozen at request time.
    expect(await (canWrite as () => Promise<boolean>)()).toBe(true);
    expect(await (second![7] as () => Promise<boolean>)()).toBe(false);
  });

  it('JC / plan proposal with Operations rejected → nothing written', async () => {
    writer.calls.length = 0;
    writer.sourceCalls.length = 0;
    // Only a header box approved (cannot arise from a JC — its header is the
    // card's own — but must still never reach a writer).
    const filtered = entry.buildFilteredInput(
      { ...proposal, sourceCode: 'IN-JC-26-00012' },
      new Set(['notes']),
    );
    await entry.applyEdit(fakeTx([[card]]), 'co-1', 'rc-1', filtered, 'tok', user);
    expect(writer.calls).toHaveLength(0);
    expect(writer.sourceCalls).toHaveLength(0);
  });

  it('only a header box approved → the STORED routing is resubmitted unchanged', async () => {
    writer.calls.length = 0;
    const filtered = entry.buildFilteredInput(
      { ...proposal, notes: 'Use coolant' },
      new Set(['notes']),
    );
    await entry.applyEdit(fakeTx([[card], [opRow()]]), 'co-1', 'rc-1', filtered, 'tok', user);
    const sent = writer.calls[0]![2] as UpdateRouteCardInput;
    expect(sent.notes).toBe('Use coolant');
    expect(sent.ops).toHaveLength(1);
    expect(sent.ops[0]).toMatchObject({ operation: 'Turning', cycleTimeMin: 5, toolNo: 'T3' });
  });
});

describe('Route Card edit-approval — review fixes', () => {
  const gradedCard = { ...card, rawMaterialGradeId: 'g-1', rawMaterialGradeText: 'EN24' };
  const sameOps = [
    {
      machineId: 'm-1',
      operation: 'Turning',
      opType: 'process',
      cycleTimeMin: 5,
      toolNo: 'T3',
      qcRequired: false,
    },
  ];
  const targetOf = (c: Record<string, unknown>): Parameters<typeof entry.beforeSnapshot>[0] => ({
    doc: { ...c, routing: 'x' },
    updatedAt: null,
    docCode: 'IN-RC-00005',
    isLive: true,
  });

  it("the card's own grade id reads as its stored text — no phantom RM change, no master read", async () => {
    const target = (await entry.loadForDiff(
      fakeTx([[{ itemId: 'it-1' }], [gradedCard], [opRow()], [{ id: 'm-1', code: 'CNC-1' }]]),
      'co-1',
      'rc-1',
    ))!;
    // Only the machine-code read is queued: a grade-master read would eat it.
    const after = await entry.afterSnapshot(
      fakeTx([[{ id: 'm-1', code: 'CNC-1' }]]),
      'co-1',
      {
        ...proposal,
        rawMaterialGradeId: 'g-1',
        rawMaterialGradeText: 'EN24 (renamed)',
        ops: sameOps,
      },
      user,
      target,
    );
    expect(diffFields(entry.beforeSnapshot(target), after, entry.diffFields(target))).toEqual([]);
  });

  it('a JC proposal shows only the RM the gate-off writer would fill', async () => {
    const blankSize = { ...card, rawMaterialSizeText: null };
    const jc = {
      ...proposal,
      ops: sameOps,
      sourceCode: 'IN-JC-26-00012',
      rawMaterialGradeText: 'EN8', // the card holds EN24 → never replaced
      rawMaterialSizeText: 'DIA 40', // the card's size is blank → filled
    } as unknown as UpdateRouteCardInput;
    const rmOf = async (fillRm: boolean): Promise<string> =>
      String(
        (
          await entry.afterSnapshot(
            fakeTx([[{ id: 'm-1', code: 'CNC-1' }]]),
            'co-1',
            { ...jc, fillRm },
            user,
            targetOf(blankSize),
          )
        )['operations'],
      ).split(' | ')[1]!;
    expect(await rmOf(true)).toBe('RM: EN24 / DIA 40');
    // No right to fill → the card's own (blank) size, as gate-off.
    expect(await rmOf(false)).toBe('RM: EN24 / —');
  });

  it('no Item Code box (a re-point is refused before staging)', () => {
    const labels = entry.diffFields(targetOf(card)).map((f) => f.label);
    expect(labels).toEqual([
      'RC No.',
      'Plan Type',
      'Notes',
      'Drawing Rev',
      'Drawing File',
      'Operations',
    ]);
  });

  it('header-only approval asks the writer not to re-validate the stored routing', async () => {
    writer.calls.length = 0;
    await entry.applyEdit(
      fakeTx([[card], [opRow()]]),
      'co-1',
      'rc-1',
      entry.buildFilteredInput({ ...proposal, notes: 'Use coolant' }, new Set(['notes'])),
      'tok',
      user,
    );
    await entry.applyEdit(
      fakeTx([[card]]),
      'co-1',
      'rc-1',
      entry.buildFilteredInput(proposal, new Set(['operations'])),
      'tok',
      user,
    );
    expect(writer.calls[0]![4]).toEqual({ routingUnchanged: true });
    expect(writer.calls[1]![4]).toEqual({ routingUnchanged: false });
    expect((writer.calls[0]![2] as UpdateRouteCardInput).itemId).toBe('it-1');
  });

  it('a routing that could not be sent says why, in plain words', () => {
    expect(
      routingNotSentReason(
        'IN-RC-00005',
        'This document already has an edit waiting for approval.',
      ),
    ).toBe(
      'Route Card IN-RC-00005 already has a change waiting for approval — this routing was not ' +
        'sent; approve or reject that change, then save again.',
    );
    expect(routingNotSentReason('IN-RC-00005', 'Nothing changed to approve.')).toMatch(
      /nothing was sent/,
    );
    expect(routingNotSentReason('IN-RC-00005', null)).toMatch(/could not be sent for approval/);
  });
});
