// Pure tests for the child-row box mechanics (./line-boxes.ts) — no database.

import { describe, expect, it } from 'vitest';
import { diffFields } from '../../lib/audit-trail';
import {
  type ChildBoxSpec,
  type CurrentChild,
  approvedChildBoxes,
  childAfter,
  childBefore,
  childDiffFields,
  clipLabel,
  parseChildKey,
  rebuildChildRows,
} from './line-boxes';

const ID1 = '11111111-1111-1111-1111-111111111111';
const ID2 = '22222222-2222-2222-2222-222222222222';

const SPEC: ChildBoxSpec = {
  prefix: 'line',
  rowWord: 'Line',
  attrs: [
    { attr: 'orderQty', label: 'Order Qty' },
    { attr: 'clientPoLineNo', label: 'POL' },
  ],
};

const current: CurrentChild[] = [
  { id: ID1, no: 1, values: { orderQty: 2, clientPoLineNo: '20' }, summary: 'A-1 × 2', removeName: 'A-1' },
  { id: ID2, no: 2, values: { orderQty: 3, clientPoLineNo: '30' }, summary: 'A-2 × 3', removeName: 'A-2' },
];

describe('line-boxes', () => {
  it('keys parse back; every key fits the 64-char field limit', () => {
    expect(parseChildKey('line', `line:${ID1}:orderQty`)).toEqual({
      kind: 'attr',
      rowId: ID1,
      attr: 'orderQty',
    });
    expect(parseChildKey('line', 'line:add:2')).toEqual({ kind: 'add', n: 2 });
    expect(parseChildKey('line', `line:remove:${ID2}`)).toEqual({ kind: 'remove', rowId: ID2 });
    expect(parseChildKey('line', 'remarks')).toBeNull();
    expect(parseChildKey('ms', `line:${ID1}:orderQty`)).toBeNull();
    expect(`line:${ID1}:sourceBomMasterId`.length).toBeLessThanOrEqual(64);
  });

  it('diffs an attr change, an add and a remove into one box each', () => {
    const proposed = [
      { id: ID1, values: { orderQty: 5, clientPoLineNo: '20' }, summary: 'A-1 × 5' },
      { values: { orderQty: 7 }, summary: 'B-9 × 7 · POL 40' },
    ];
    const changes = diffFields(
      childBefore(SPEC, current),
      childAfter(SPEC, current, proposed),
      childDiffFields(SPEC, current, proposed),
    );
    expect(changes.map((c) => [c.field, c.label, c.before, c.after])).toEqual([
      [`line:${ID1}:orderQty`, 'Line 1 · Order Qty', 2, 5],
      [`line:remove:${ID2}`, 'Remove line 2 · A-2', 'A-2 × 3', null],
      ['line:add:1', 'Add line · B-9 × 7 · POL 40', null, 'B-9 × 7 · POL 40'],
    ]);
  });

  it('labels are clipped to 80 chars', () => {
    expect(clipLabel('x'.repeat(200))).toHaveLength(80);
    const long = [{ values: {}, summary: 'C'.repeat(120) }];
    for (const f of childDiffFields(SPEC, current, long)) {
      expect(f.label.length).toBeLessThanOrEqual(80);
    }
  });

  it('rebuild keeps unapproved rows at current values and drops only an approved removal', () => {
    type Row = { id?: string; orderQty: number; clientPoLineNo: string };
    const approved = approvedChildBoxes('line', [
      `line:${ID1}:clientPoLineNo`,
      `line:remove:${ID2}`,
      'line:add:1',
      'remarks',
    ]);
    const rows = rebuildChildRows<Row>(
      approved,
      [
        { id: ID1, input: { id: ID1, orderQty: 2, clientPoLineNo: '20' } },
        { id: ID2, input: { id: ID2, orderQty: 3, clientPoLineNo: '30' } },
      ],
      [
        { id: ID1, orderQty: 9, clientPoLineNo: '21' }, // qty NOT approved
        { orderQty: 7, clientPoLineNo: '40' }, // add:1 approved
        { orderQty: 8, clientPoLineNo: '50' }, // add:2 NOT approved
      ],
      (row, p, attr) => {
        (row as Record<string, unknown>)[attr] = (p as Record<string, unknown>)[attr];
      },
    );
    expect(rows).toEqual([
      { id: ID1, orderQty: 2, clientPoLineNo: '21' },
      { orderQty: 7, clientPoLineNo: '40' },
    ]);
  });

  it('no child box approved → any is false (header-only replay)', () => {
    expect(approvedChildBoxes('line', ['remarks', 'jwDate']).any).toBe(false);
  });
});
