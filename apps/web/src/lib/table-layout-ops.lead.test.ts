import { describe, expect, it } from 'vitest';

import { LEAD_COLUMN_IDS, leadColumns, lockedLeadIds } from '@/ui/data/lead-columns';

import { applyLayoutOp } from './table-layout-ops';

// Owner rule 2026-10-31 — SO No. · Internal SO No. · POL · Created On ·
// Item Code · Item Name are one fixed block at the front of every SO list.
const LEAD = [...LEAD_COLUMN_IDS];
const ORDER = [...LEAD, 'jc_no', 'qty', 'status'];
const defaults = { order: ORDER, pins: [], hidden: [] };
const state = { order: ORDER, pins: [], hidden: [] };

describe('lead block lock', () => {
  it('a lead column cannot move, hide or pin', () => {
    for (const id of LEAD) {
      expect(applyLayoutOp(state, { type: 'move', id, dir: 1 }, LEAD, defaults)).toBe(state);
      expect(applyLayoutOp(state, { type: 'hide', id }, LEAD, defaults)).toBe(state);
      expect(applyLayoutOp(state, { type: 'pin', id }, LEAD, defaults)).toBe(state);
    }
  });

  it('no column can move into the block (nothing between Item Code and Item Name)', () => {
    const next = applyLayoutOp(state, { type: 'move', id: 'jc_no', dir: -1 }, LEAD, defaults);
    expect(next).toBe(state);
    const moved = applyLayoutOp(state, { type: 'move', id: 'qty', dir: -1 }, LEAD, defaults);
    expect(moved.order.slice(0, 6)).toEqual(LEAD);
    expect(moved.order.slice(6)).toEqual(['qty', 'jc_no', 'status']);
  });

  it('a re-shown column goes back to its own slot, not the end', () => {
    const hidden = applyLayoutOp(state, { type: 'hide', id: 'jc_no' }, LEAD, defaults);
    const shown = applyLayoutOp(hidden, { type: 'show', id: 'jc_no' }, LEAD, defaults);
    expect(shown.order).toEqual(ORDER);
  });

  it('old single-column lock still works', () => {
    const next = applyLayoutOp(
      state,
      { type: 'move', id: 'so_internal_no', dir: -1 },
      'so_no',
      defaults,
    );
    expect(next.order.slice(0, 2)).toEqual(['so_no', 'so_internal_no']);
  });
});

describe('leadColumns builder', () => {
  type Row = { so: string; cr: string; code: string; rev: string | null; name: string };
  const spec = {
    soNo: (r: Row) => r.so,
    internalSoNo: () => null,
    pol: () => '10',
    createdOn: (r: Row) => r.cr,
    itemCode: (r: Row) => r.code,
    itemRev: (r: Row) => r.rev,
    itemName: (r: Row) => r.name,
  };

  it('gives the six in the fixed order, all locked', () => {
    const cols = leadColumns<Row>(spec);
    expect(cols.map((c) => c.id)).toEqual(LEAD);
    expect(cols.map((c) => c.header)).toEqual([
      'SO No.',
      'Internal SO No.',
      'POL',
      'Created On',
      'Item Code',
      'Item Name',
    ]);
    expect(cols.every((c) => c.lead)).toBe(true);
    expect(lockedLeadIds(cols, LEAD)).toEqual(LEAD);
  });

  it('own doc no. comes FIRST and is locked with the block', () => {
    const cols = leadColumns<Row>({
      ...spec,
      doc: { id: 'plan_no', header: 'Plan No.' },
      docDate: { id: 'plan_date', header: 'Plan Date' },
    });
    const ids = cols.map((c) => c.id ?? '');
    expect(ids).toEqual(['plan_no', 'plan_date', ...LEAD]);
    expect(lockedLeadIds(cols, ids)).toEqual(['plan_no', 'plan_date', ...LEAD]);
    const order = [...ids, 'qty'];
    const st = { order, pins: [], hidden: [] };
    const d = { order, pins: [], hidden: [] };
    expect(applyLayoutOp(st, { type: 'hide', id: 'plan_no' }, ids, d)).toBe(st);
    expect(applyLayoutOp(st, { type: 'move', id: 'qty', dir: -1 }, ids, d)).toBe(st);
  });

  it('JWSO list: JWSO No. and no Internal SO No. column', () => {
    const jw = { ...spec, so: 'jwso' as const, internalSoNo: undefined };
    const cols = leadColumns<Row>(jw);
    expect(cols.map((c) => c.header)).toEqual([
      'JWSO No.',
      'POL',
      'Created On',
      'Item Code',
      'Item Name',
    ]);
  });

  it('a table without lead columns locks column 0 only', () => {
    expect(lockedLeadIds([{ header: 'A' }, { header: 'B' }], ['a', 'b'])).toEqual(['a']);
  });
});
